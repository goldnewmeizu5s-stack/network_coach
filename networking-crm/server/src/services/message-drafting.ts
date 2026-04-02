import Anthropic from "@anthropic-ai/sdk";
import prisma from "../lib/prisma";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function draftFollowUpMessage(
  contactId: string,
  action: string
): Promise<string[]> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      interactions: {
        orderBy: { created_at: "desc" },
        take: 10,
        select: {
          type: true,
          content: true,
          ai_summary: true,
          created_at: true,
        },
      },
    },
  });

  if (!contact) throw new Error("Contact not found");

  const contactInfo = [
    `Name: ${contact.full_name}`,
    contact.nickname && `Nickname: ${contact.nickname}`,
    contact.occupation && `Occupation: ${contact.occupation}`,
    contact.company && `Company: ${contact.company}`,
    contact.city && `City: ${contact.city}`,
    contact.where_met && `Where we met: ${contact.where_met}`,
    contact.key_interests.length > 0 &&
      `Interests: ${contact.key_interests.join(", ")}`,
    contact.what_impressed_me &&
      `What impressed me: ${contact.what_impressed_me}`,
    contact.potential_synergies &&
      `Potential synergies: ${contact.potential_synergies}`,
    contact.personality_notes &&
      `Personality notes: ${contact.personality_notes}`,
    contact.memory_summary && `Summary: ${contact.memory_summary}`,
    contact.personal_notes && `Personal notes: ${contact.personal_notes}`,
  ]
    .filter(Boolean)
    .join("\n");

  const interactionsText = contact.interactions
    .map((i) => {
      const date = new Date(i.created_at).toLocaleDateString();
      const text = i.ai_summary || i.content || "(no content)";
      return `[${date}] ${i.type}: ${text}`;
    })
    .join("\n");

  const prompt = `You are helping the user write a follow-up message to someone they know.

Contact info:
${contactInfo}

Interaction history:
${interactionsText || "(no interactions yet)"}

Requested action: ${action}
Current warmth level: ${contact.warmth_status}

Generate 3 short message options (2-4 sentences each) that are:
- Natural and human, not robotic or generic
- Reference something specific from the notes about this person
- Appropriate for the current warmth level (casual if warm, more formal if new)
- Written in the same language as the user's notes about this person

Return as JSON array of 3 strings: ["message1", "message2", "message3"]`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "[]";

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 3).map(String);
    }
  } catch {
    // If JSON parse fails, return the raw text as a single option
  }

  return [text];
}
