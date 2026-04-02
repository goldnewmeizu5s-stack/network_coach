import fs from "fs";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { transcribeAudio } from "./transcription";
import { extractContactData } from "./ai-extraction";
import { recalcAndAutoStatus } from "./warmth";

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
    fs.unlink(filePath, () => {});
    await prisma.audioFile.update({
      where: { interaction_id: interactionId },
      data: { file_path: "deleted" },
    });

    // d. Extract structured data
    const extracted = await extractContactData(transcript);

    // e. Not about a person — save as note, done
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

    // Check if interaction already has a contact (update flow)
    const existingInteraction = await prisma.interaction.findUnique({
      where: { id: interactionId },
      select: { contact_id: true },
    });
    let contactId: string;

    if (existingInteraction?.contact_id) {
      // Pre-linked contact — update it
      contactId = existingInteraction.contact_id;
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
          urgency_score: extracted.urgency_score,
          last_interaction_at: new Date(),
        },
      });
    } else if (extracted.is_update) {
      // g. Find existing contact by name (fuzzy match)
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
        await prisma.contact.update({
          where: { id: existing.id },
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
      } else {
        // Couldn't find — create new anyway
        const contact = await createContact(extracted);
        contactId = contact.id;
      }
    } else {
      // f. Create new contact
      const contact = await createContact(extracted);
      contactId = contact.id;
    }

    // Link interaction to contact
    await prisma.interaction.update({
      where: { id: interactionId },
      data: {
        contact_id: contactId,
        ai_summary: extracted.memory_summary,
      },
    });

    // h. Create follow-up
    if (extracted.suggested_next_steps.length > 0) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 2);

      await prisma.followUp.create({
        data: {
          contact_id: contactId,
          suggested_action: extracted.suggested_next_steps[0],
          due_date: dueDate,
          priority: extracted.urgency_score,
        },
      });
    }

    // Recalculate warmth score
    await recalcAndAutoStatus(contactId);

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

async function createContact(extracted: Awaited<ReturnType<typeof extractContactData>>) {
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
      warmth_status: "new",
      last_interaction_at: new Date(),
    },
  });
}
