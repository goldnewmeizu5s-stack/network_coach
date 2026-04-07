import fs from "fs/promises";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { transcribeAudio } from "./transcription";
import { extractContactData, extractMultipleContacts } from "./ai-extraction";
import { recalcAndAutoStatus } from "./warmth";
import { notifyNewContact } from "../bot/notifications";

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
        await prisma.interaction.create({
          data: {
            contact_id: contactIds[i],
            type: "voice_note",
            transcript,
            ai_summary: result.contacts[i].memory_summary,
          },
        });
      }
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
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      ...(extracted.occupation && { occupation: extracted.occupation }),
      ...(extracted.company && { company: extracted.company }),
      ...(extracted.city && { city: extracted.city }),
      ...(extracted.country && { country: extracted.country }),
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
      key_interests: extracted.key_interests,
      what_impressed_me: extracted.what_impressed_me,
      potential_synergies: extracted.potential_synergies,
      personality_notes: extracted.personality_notes,
      memory_summary: extracted.memory_summary,
      relationship_category: extracted.relationship_category,
      urgency_score: extracted.urgency_score,
      met_date: new Date(),
      warmth_status: "new",
      last_interaction_at: new Date(),
    },
  });
}
