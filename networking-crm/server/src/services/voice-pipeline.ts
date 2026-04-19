import fs from "fs/promises";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { transcribeAudio } from "./transcription";
import { extractContactData, extractMultipleContacts, extractBatchActivity, ContactForMatching } from "./ai-extraction";
import { recalcAndAutoStatus } from "./warmth";
import { notifyNewContact } from "../bot/notifications";
import { BatchProcessingResult } from "../types";
import {
  indexInteractionAsync,
  indexContactMemoryAsync,
} from "./memory/memory-indexer";
import { generateLocationChallenges } from "./location-challenge-engine";

export async function processVoiceNote(
  interactionId: string,
  filePath: string
): Promise<void> {
  try {
    // a. Mark as processing
    await prisma.audioFile.update({
      where: { interaction_id: interactionId },
      data: { transcription_status: "processing" },
    });

    // b. Transcribe
    const transcript = await transcribeAudio(filePath);

    // c. Save transcript + delete audio file
    await prisma.interaction.update({
      where: { id: interactionId },
      data: { transcript },
    });
    await fs.unlink(filePath).catch(() => {});
    await prisma.audioFile.update({
      where: { interaction_id: interactionId },
      data: { file_path: "deleted" },
    });

    // d. Extract structured data (multi-person aware)
    // Check if interaction already has a pre-linked contact
    const existingInteraction = await prisma.interaction.findUnique({
      where: { id: interactionId },
      select: { contact_id: true },
    });

    // If pre-linked to a specific contact, use single extraction for that contact
    if (existingInteraction?.contact_id) {
      const extracted = await extractContactData(transcript);
      if (extracted.is_update === null) {
        await prisma.interaction.update({
          where: { id: interactionId },
          data: { ai_summary: "Voice note (no contact detected)" },
        });
        await prisma.audioFile.update({
          where: { interaction_id: interactionId },
          data: { transcription_status: "completed" },
        });
        return;
      }

      const contactId = existingInteraction.contact_id;
      await updateExistingContact(contactId, extracted);
      await prisma.interaction.update({
        where: { id: interactionId },
        data: { contact_id: contactId, ai_summary: extracted.memory_summary },
      });
      await createFollowUps(contactId, extracted);
      await recalcAndAutoStatus(contactId);
      indexInteractionAsync(interactionId);
      indexContactMemoryAsync(contactId);
      notifyNewContact({
        id: contactId,
        full_name: extracted.full_name || "Unknown",
        occupation: extracted.occupation,
        company: extracted.company,
        city: extracted.city,
      }).catch(() => {});
    } else {
      // Use multi-person extraction
      const result = await extractMultipleContacts(transcript);

      // e. Not about any person — save as note, done
      if (result.is_voice_note || result.contacts.length === 0) {
        await prisma.interaction.update({
          where: { id: interactionId },
          data: { ai_summary: "Voice note (no contact detected)" },
        });
        await prisma.audioFile.update({
          where: { interaction_id: interactionId },
          data: { transcription_status: "completed" },
        });
        return;
      }

      const contactIds: string[] = [];

      for (const extracted of result.contacts) {
        let contactId: string;

        if (extracted.is_update) {
          // Find existing contact by name (fuzzy match)
          const existing = extracted.full_name
            ? await prisma.contact.findFirst({
                where: {
                  full_name: {
                    contains: extracted.full_name,
                    mode: "insensitive",
                  },
                },
              })
            : null;

          if (existing) {
            contactId = existing.id;
            await updateExistingContact(contactId, extracted);
          } else {
            const contact = await createContact(extracted);
            contactId = contact.id;
          }
        } else {
          const contact = await createContact(extracted);
          contactId = contact.id;
        }

        contactIds.push(contactId);

        // Create follow-ups for this contact
        await createFollowUps(contactId, extracted);

        // Recalculate warmth score
        await recalcAndAutoStatus(contactId);

        // Notify via Telegram (fire-and-forget)
        notifyNewContact({
          id: contactId,
          full_name: extracted.full_name || "Unknown",
          occupation: extracted.occupation,
          company: extracted.company,
          city: extracted.city,
        }).catch(() => {});
      }

      // Link interaction to the first contact
      const primaryContactId = contactIds[0];
      const summaries = result.contacts
        .map((c) => c.memory_summary)
        .filter(Boolean)
        .join(" | ");

      await prisma.interaction.update({
        where: { id: interactionId },
        data: {
          contact_id: primaryContactId,
          ai_summary: summaries || null,
          // Store all contact IDs in content field for multi-person results
          ...(contactIds.length > 1 && {
            content: JSON.stringify({ contact_ids: contactIds }),
          }),
        },
      });

      // Create additional interaction records for non-primary contacts
      // so each contact has a linked voice_note interaction
      for (let i = 1; i < contactIds.length; i++) {
        const extra = await prisma.interaction.create({
          data: {
            contact_id: contactIds[i],
            type: "voice_note",
            transcript,
            ai_summary: result.contacts[i].memory_summary,
          },
        });
        indexInteractionAsync(extra.id);
      }

      indexInteractionAsync(interactionId);
      for (const cid of contactIds) indexContactMemoryAsync(cid);
    }

    // i. Mark as completed
    await prisma.audioFile.update({
      where: { interaction_id: interactionId },
      data: { transcription_status: "completed" },
    });
  } catch (err) {
    // j. Mark as failed
    logger.error("Voice pipeline failed", { interactionId, error: String(err) });
    try {
      await prisma.audioFile.update({
        where: { interaction_id: interactionId },
        data: { transcription_status: "failed" },
      });
    } catch {
      // ignore if update itself fails
    }
  }
}

async function updateExistingContact(
  contactId: string,
  extracted: Awaited<ReturnType<typeof extractContactData>>
) {
  // If there's a new memory_hook, append it to existing memory_notes (avoid duplicates)
  let memoryNotesUpdate = {};
  if (extracted.memory_hook) {
    const existing = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { memory_notes: true },
    });
    const currentNotes = existing?.memory_notes || [];
    // Avoid duplicates (case-insensitive check)
    const hookLower = extracted.memory_hook.toLowerCase();
    const isDuplicate = currentNotes.some(
      (n) => n.toLowerCase() === hookLower
    );
    if (!isDuplicate) {
      memoryNotesUpdate = { memory_notes: [...currentNotes, extracted.memory_hook] };
    }
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      ...(extracted.occupation && { occupation: extracted.occupation }),
      ...(extracted.company && { company: extracted.company }),
      ...(extracted.city && { city: extracted.city }),
      ...(extracted.country && { country: extracted.country }),
      ...(extracted.met_country && { met_country: extracted.met_country }),
      ...(extracted.origin_country && { origin_country: extracted.origin_country }),
      ...(extracted.key_interests.length && {
        key_interests: extracted.key_interests,
      }),
      ...(extracted.what_impressed_me && {
        what_impressed_me: extracted.what_impressed_me,
      }),
      ...(extracted.potential_synergies && {
        potential_synergies: extracted.potential_synergies,
      }),
      ...(extracted.personality_notes && {
        personality_notes: extracted.personality_notes,
      }),
      ...(extracted.memory_summary && {
        memory_summary: extracted.memory_summary,
      }),
      ...(extracted.relationship_category && {
        relationship_category: extracted.relationship_category,
      }),
      ...memoryNotesUpdate,
      urgency_score: extracted.urgency_score,
      last_interaction_at: new Date(),
    },
  });
}

async function createFollowUps(
  contactId: string,
  extracted: Awaited<ReturnType<typeof extractContactData>>
) {
  for (const step of extracted.suggested_next_steps) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + step.due_days);
    await prisma.followUp.create({
      data: {
        contact_id: contactId,
        suggested_action: step.action,
        due_date: dueDate,
        priority: extracted.urgency_score,
      },
    });
  }
}

export async function createContact(extracted: Awaited<ReturnType<typeof extractContactData>>) {
  return prisma.contact.create({
    data: {
      full_name: extracted.full_name || "Unknown",
      nickname: extracted.nickname,
      where_met: extracted.where_met,
      occupation: extracted.occupation,
      company: extracted.company,
      city: extracted.city,
      country: extracted.country,
      met_country: extracted.met_country,
      origin_country: extracted.origin_country,
      key_interests: extracted.key_interests,
      what_impressed_me: extracted.what_impressed_me,
      potential_synergies: extracted.potential_synergies,
      personality_notes: extracted.personality_notes,
      memory_summary: extracted.memory_summary,
      memory_notes: extracted.memory_hook ? [extracted.memory_hook] : [],
      relationship_category: extracted.relationship_category,
      urgency_score: extracted.urgency_score,
      met_date: extracted.met_date ? new Date(extracted.met_date) : new Date(),
      warmth_status: "new",
      last_interaction_at: new Date(),
    },
  });
}

// --- Batch Voice Activity Processing ---

export async function processBatchVoiceActivity(
  interactionId: string,
  filePath: string
): Promise<void> {
  try {
    // a. Mark as processing
    await prisma.audioFile.update({
      where: { interaction_id: interactionId },
      data: { transcription_status: "processing" },
    });

    // b. Transcribe
    const transcript = await transcribeAudio(filePath);

    // c. Save transcript + delete audio file
    await prisma.interaction.update({
      where: { id: interactionId },
      data: { transcript },
    });
    await fs.unlink(filePath).catch(() => {});
    await prisma.audioFile.update({
      where: { interaction_id: interactionId },
      data: { file_path: "deleted" },
    });

    // d. Load existing contacts for AI matching context
    const existingContacts: ContactForMatching[] = await prisma.contact.findMany(
      {
        where: { warmth_status: { not: "archived" } },
        select: {
          id: true,
          full_name: true,
          nickname: true,
          occupation: true,
          company: true,
          city: true,
          warmth_status: true,
        },
        orderBy: { last_interaction_at: "desc" },
        take: 200,
      }
    );

    // e. Extract batch activity data
    const result = await extractBatchActivity(transcript, existingContacts);

    if (!result.is_valid || result.segments.length === 0) {
      await prisma.interaction.update({
        where: { id: interactionId },
        data: { ai_summary: "Голосовое сообщение (активность не распознана)" },
      });
      await prisma.audioFile.update({
        where: { interaction_id: interactionId },
        data: { transcription_status: "completed" },
      });
      return;
    }

    // f. Process each activity segment
    const contactIds: string[] = [];
    const processingResults: BatchProcessingResult["segments"] = [];
    let totalFollowUpsCreated = 0;
    let contactsCreated = 0;
    let contactsUpdated = 0;

    for (const segment of result.segments) {
      let contactId: string;
      let isNew = false;

      if (segment.is_new_contact && segment.contact_data) {
        // Create new contact
        const newContact = await createContact({
          full_name: segment.contact_data.full_name ?? segment.contact_name,
          nickname: segment.contact_data.nickname ?? null,
          where_met: segment.contact_data.where_met ?? null,
          occupation: segment.contact_data.occupation ?? null,
          company: segment.contact_data.company ?? null,
          city: segment.contact_data.city ?? null,
          country: segment.contact_data.country ?? null,
          met_country: segment.contact_data.met_country ?? null,
          origin_country: segment.contact_data.origin_country ?? null,
          key_interests: segment.contact_data.key_interests ?? [],
          what_impressed_me: segment.contact_data.what_impressed_me ?? null,
          potential_synergies: segment.contact_data.potential_synergies ?? null,
          personality_notes: segment.contact_data.personality_notes ?? null,
          memory_summary: segment.contact_data.memory_summary ?? null,
          memory_hook: segment.contact_data.memory_hook ?? null,
          met_date: segment.contact_data.met_date ?? null,
          relationship_category:
            segment.contact_data.relationship_category ?? "other",
          urgency_score: segment.contact_data.urgency_score ?? 5,
          suggested_next_steps: [],
          is_update: false,
          follow_up_questions: [],
        });
        contactId = newContact.id;
        isNew = true;
        contactsCreated++;

        notifyNewContact({
          id: contactId,
          full_name: segment.contact_name,
          occupation: segment.contact_data.occupation ?? undefined,
          company: segment.contact_data.company ?? undefined,
          city: segment.contact_data.city ?? undefined,
        }).catch(() => {});
      } else if (segment.matched_contact_id) {
        // Matched to existing contact — update
        contactId = segment.matched_contact_id;
        await updateContactFromActivity(contactId, segment);
        contactsUpdated++;
      } else {
        // Not matched, not marked as new — try fuzzy match by name
        const fuzzyMatch = await prisma.contact.findFirst({
          where: {
            full_name: { contains: segment.contact_name, mode: "insensitive" },
            warmth_status: { not: "archived" },
          },
        });

        if (fuzzyMatch) {
          contactId = fuzzyMatch.id;
          await updateContactFromActivity(contactId, segment);
          contactsUpdated++;
        } else {
          // Create as new contact with minimal data
          const newContact = await prisma.contact.create({
            data: {
              full_name: segment.contact_name,
              relationship_category: segment.relationship_category,
              urgency_score: segment.urgency_score,
              memory_summary: segment.activity_summary,
              memory_notes: segment.memory_notes,
              warmth_status: "new",
              last_interaction_at: new Date(),
            },
          });
          contactId = newContact.id;
          isNew = true;
          contactsCreated++;
        }
      }

      contactIds.push(contactId);

      // Create interaction record for this contact
      await prisma.interaction.create({
        data: {
          contact_id: contactId,
          type: segment.interaction_type,
          content: segment.activity_summary,
          ai_summary: segment.activity_summary,
        },
      });

      // Create follow-ups
      let followUpsCreated = 0;
      for (const step of segment.suggested_next_steps) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + step.due_days);
        await prisma.followUp.create({
          data: {
            contact_id: contactId,
            suggested_action: step.action,
            due_date: dueDate,
            priority: segment.urgency_score,
          },
        });
        followUpsCreated++;
      }
      totalFollowUpsCreated += followUpsCreated;

      // Recalculate warmth
      await recalcAndAutoStatus(contactId);

      processingResults.push({
        contact_name: segment.contact_name,
        contact_id: contactId,
        is_new_contact: isNew,
        interaction_type: segment.interaction_type,
        activity_summary: segment.activity_summary,
        follow_ups_created: followUpsCreated,
        warmth_change: segment.warmth_change,
      });
    }

    // g. Update the original interaction with batch results
    const batchResult: BatchProcessingResult = {
      segments: processingResults,
      overall_summary: result.overall_summary,
      contacts_updated: contactsUpdated,
      contacts_created: contactsCreated,
      follow_ups_created: totalFollowUpsCreated,
    };

    await prisma.interaction.update({
      where: { id: interactionId },
      data: {
        contact_id: contactIds[0] || null,
        ai_summary: result.overall_summary,
        content: JSON.stringify({
          mode: "batch_activity",
          contact_ids: contactIds,
          result: batchResult,
        }),
      },
    });

    // h. Mark as completed
    await prisma.audioFile.update({
      where: { interaction_id: interactionId },
      data: { transcription_status: "completed" },
    });
  } catch (err) {
    logger.error("Batch voice activity pipeline failed", {
      interactionId,
      error: String(err),
    });
    try {
      await prisma.audioFile.update({
        where: { interaction_id: interactionId },
        data: { transcription_status: "failed" },
      });
    } catch {
      // ignore if update itself fails
    }
  }
}

// --- Location Context Voice Processing ---
// User records "I'm at X doing Y" → transcribe → generate location-aware challenges.
// Does NOT create contacts or follow-ups. The resulting challenges are written
// to the Challenge table; the interaction is kept as a log entry.

export async function processLocationContextVoice(
  interactionId: string,
  filePath: string
): Promise<void> {
  try {
    await prisma.audioFile.update({
      where: { interaction_id: interactionId },
      data: { transcription_status: "processing" },
    });

    const transcript = await transcribeAudio(filePath);

    await prisma.interaction.update({
      where: { id: interactionId },
      data: { transcript, ai_summary: "Location context for challenges" },
    });
    await fs.unlink(filePath).catch(() => {});
    await prisma.audioFile.update({
      where: { interaction_id: interactionId },
      data: { file_path: "deleted" },
    });

    const trimmed = transcript.trim();
    if (!trimmed) {
      await prisma.interaction.update({
        where: { id: interactionId },
        data: {
          content: JSON.stringify({
            mode: "location_context",
            error: "empty_transcript",
          }),
        },
      });
      await prisma.audioFile.update({
        where: { interaction_id: interactionId },
        data: { transcription_status: "completed" },
      });
      return;
    }

    const created = await generateLocationChallenges({
      context: trimmed,
      transcriptSource: "voice",
    });

    await prisma.interaction.update({
      where: { id: interactionId },
      data: {
        content: JSON.stringify({
          mode: "location_context",
          challenge_ids: created.map((c) => c.id),
        }),
      },
    });

    await prisma.audioFile.update({
      where: { interaction_id: interactionId },
      data: { transcription_status: "completed" },
    });
  } catch (err) {
    logger.error("Location context voice pipeline failed", {
      interactionId,
      error: String(err),
    });
    try {
      await prisma.audioFile.update({
        where: { interaction_id: interactionId },
        data: { transcription_status: "failed" },
      });
    } catch {
      // ignore
    }
  }
}

async function updateContactFromActivity(
  contactId: string,
  segment: {
    activity_summary: string;
    memory_hook: string | null;
    memory_notes: string[];
    urgency_score: number;
    relationship_category: string;
  }
): Promise<void> {
  const existing = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { memory_notes: true },
  });

  // Merge new memory notes, avoiding duplicates
  const currentNotes = existing?.memory_notes || [];
  const newNotes = [...segment.memory_notes];
  if (segment.memory_hook) {
    newNotes.push(segment.memory_hook);
  }

  const mergedNotes = [...currentNotes];
  for (const note of newNotes) {
    const noteLower = note.toLowerCase();
    const isDuplicate = mergedNotes.some(
      (n) => n.toLowerCase() === noteLower
    );
    if (!isDuplicate) {
      mergedNotes.push(note);
    }
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      memory_notes: mergedNotes,
      urgency_score: segment.urgency_score,
      last_interaction_at: new Date(),
    },
  });
}
