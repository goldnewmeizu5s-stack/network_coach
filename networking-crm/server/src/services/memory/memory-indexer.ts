import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { upsertMemory, deleteMemoryBySource } from "./memory-service";
import { primaryContactForNote } from "../notes-service";

export async function indexInteraction(interactionId: string): Promise<void> {
  try {
    const rec = await prisma.interaction.findUnique({
      where: { id: interactionId },
      select: {
        id: true,
        type: true,
        content: true,
        transcript: true,
        ai_summary: true,
        created_at: true,
        contact_id: true,
        contact: { select: { full_name: true } },
      },
    });
    if (!rec) return;

    const body =
      rec.ai_summary || rec.transcript || rec.content || "";
    if (!body || body.trim().length < 12) return;

    const parts: string[] = [];
    if (rec.contact?.full_name) parts.push(`About: ${rec.contact.full_name}`);
    parts.push(`Type: ${rec.type}`);
    parts.push(`Date: ${rec.created_at.toISOString().slice(0, 10)}`);
    if (rec.ai_summary) parts.push(`Summary: ${rec.ai_summary}`);
    if (rec.transcript && rec.transcript !== rec.ai_summary) {
      parts.push(`Transcript: ${rec.transcript}`);
    } else if (rec.content && rec.content !== rec.ai_summary) {
      parts.push(`Content: ${rec.content}`);
    }

    await upsertMemory({
      sourceType: "interaction",
      sourceId: rec.id,
      contactId: rec.contact_id ?? null,
      text: parts.join("\n"),
      tags: [rec.type],
      metadata: {
        type: rec.type,
        contact_name: rec.contact?.full_name ?? null,
      },
    });
  } catch (err) {
    logger.error("indexInteraction failed", {
      interactionId,
      error: String(err),
    });
  }
}

export async function indexChallenge(challengeId: string): Promise<void> {
  try {
    const rec = await prisma.challenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        difficulty: true,
        tier: true,
        status: true,
        reflection: true,
        rating: true,
        created_at: true,
        completed_at: true,
      },
    });
    if (!rec) return;
    if (!rec.reflection && rec.status !== "completed" && rec.status !== "skipped") {
      return;
    }

    const parts: string[] = [
      `Challenge: ${rec.title}`,
      `Category: ${rec.category} (${rec.tier}, difficulty ${rec.difficulty})`,
      `Description: ${rec.description}`,
      `Status: ${rec.status}`,
    ];
    if (rec.rating != null) parts.push(`Rating: ${rec.rating}/5`);
    if (rec.reflection) parts.push(`Reflection: ${rec.reflection}`);

    await upsertMemory({
      sourceType: "challenge",
      sourceId: rec.id,
      text: parts.join("\n"),
      tags: [rec.category, rec.tier, rec.status],
      metadata: {
        rating: rec.rating,
        difficulty: rec.difficulty,
        category: rec.category,
      },
    });
  } catch (err) {
    logger.error("indexChallenge failed", {
      challengeId,
      error: String(err),
    });
  }
}

export async function indexChatMessage(messageId: string): Promise<void> {
  try {
    const msg = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        role: true,
        content: true,
        metadata: true,
        created_at: true,
      },
    });
    if (!msg) return;
    if (!msg.content || msg.content.trim().length < 20) return;

    const meta = (msg.metadata as Record<string, unknown> | null) || null;
    const contactId =
      meta && typeof meta.contact_id === "string" ? meta.contact_id : null;

    const sourceType = msg.role === "assistant" ? "chat_assistant" : "chat_user";
    const prefix = msg.role === "assistant" ? "Assistant replied" : "User said";
    const text = `${prefix} on ${msg.created_at.toISOString().slice(0, 10)}:\n${msg.content}`;

    await upsertMemory({
      sourceType,
      sourceId: msg.id,
      contactId,
      text,
      tags: [msg.role],
      metadata: { role: msg.role },
    });
  } catch (err) {
    logger.error("indexChatMessage failed", {
      messageId,
      error: String(err),
    });
  }
}

export async function indexContactMemory(contactId: string): Promise<void> {
  try {
    const c = await prisma.contact.findUnique({
      where: { id: contactId },
      select: {
        id: true,
        full_name: true,
        occupation: true,
        company: true,
        city: true,
        country: true,
        key_interests: true,
        what_impressed_me: true,
        potential_synergies: true,
        personality_notes: true,
        memory_summary: true,
        memory_notes: true,
        personal_notes: true,
        relationship_category: true,
        warmth_status: true,
      },
    });
    if (!c) return;

    const location = [c.city, c.country].filter(Boolean).join(", ");
    const lines: (string | false | null | undefined)[] = [
      `Person: ${c.full_name}`,
      c.occupation && `Occupation: ${c.occupation}`,
      c.company && `Company: ${c.company}`,
      location && `Location: ${location}`,
      c.relationship_category && `Category: ${c.relationship_category}`,
      c.key_interests.length > 0 && `Interests: ${c.key_interests.join(", ")}`,
      c.what_impressed_me && `What impressed me: ${c.what_impressed_me}`,
      c.potential_synergies && `Potential synergies: ${c.potential_synergies}`,
      c.personality_notes && `Personality: ${c.personality_notes}`,
      c.memory_summary && `Summary: ${c.memory_summary}`,
      c.memory_notes.length > 0 && `Memory hooks: ${c.memory_notes.join(" | ")}`,
      c.personal_notes && `My notes: ${c.personal_notes}`,
    ];

    const text = lines.filter(Boolean).join("\n");
    if (text.trim().length < 30) {
      await deleteMemoryBySource("contact_memory", contactId);
      return;
    }

    await upsertMemory({
      sourceType: "contact_memory",
      sourceId: contactId,
      contactId,
      text,
      tags: [c.warmth_status, c.relationship_category || "uncategorized"],
      metadata: {
        full_name: c.full_name,
        warmth_status: c.warmth_status,
      },
    });
  } catch (err) {
    logger.error("indexContactMemory failed", {
      contactId,
      error: String(err),
    });
  }
}

export async function indexNote(noteId: string): Promise<void> {
  try {
    const note = await prisma.note.findUnique({
      where: { id: noteId },
      select: {
        id: true,
        title: true,
        body: true,
        tags: true,
        created_at: true,
        updated_at: true,
      },
    });
    if (!note) return;
    const body = note.body?.trim() || "";
    if (body.length < 8) {
      await deleteMemoryBySource("note", noteId);
      return;
    }

    const contactId = await primaryContactForNote(noteId);
    const parts: string[] = [];
    if (note.title) parts.push(`Note: ${note.title}`);
    parts.push(`Written: ${note.created_at.toISOString().slice(0, 10)}`);
    if (note.tags.length > 0) parts.push(`Tags: ${note.tags.join(", ")}`);
    parts.push(body);

    await upsertMemory({
      sourceType: "note",
      sourceId: note.id,
      contactId,
      text: parts.join("\n"),
      tags: ["note", ...note.tags],
      metadata: {
        title: note.title ?? null,
        updated_at: note.updated_at,
      },
    });
  } catch (err) {
    logger.error("indexNote failed", { noteId, error: String(err) });
  }
}

export function indexInteractionAsync(interactionId: string): void {
  indexInteraction(interactionId).catch(() => {});
}
export function indexChallengeAsync(challengeId: string): void {
  indexChallenge(challengeId).catch(() => {});
}
export function indexChatMessageAsync(messageId: string): void {
  indexChatMessage(messageId).catch(() => {});
}
export function indexContactMemoryAsync(contactId: string): void {
  indexContactMemory(contactId).catch(() => {});
}
export function indexNoteAsync(noteId: string): void {
  indexNote(noteId).catch(() => {});
}
