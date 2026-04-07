import prisma from "../lib/prisma";

const MAX_CONTEXT_CHARS = 12000;

export async function buildChatContext(): Promise<string> {
  const sections: Map<string, string> = new Map();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);

  // a. User Profile (always kept)
  const user = await prisma.user.findFirst();
  if (user) {
    const prefs = (user.preferences as Record<string, unknown>) || {};
    const navigatorPrompt = prefs.navigator_prompt as string | undefined;

    if (navigatorPrompt) {
      // Full navigator profile — use as-is
      sections.set("profile", navigatorPrompt);
    } else {
      const lines = ["## USER PROFILE"];
      if (user.goals) lines.push(`Goals: ${user.goals}`);
      if (user.fears) lines.push(`Fears: ${user.fears}`);
      if (user.strengths) lines.push(`Strengths: ${user.strengths}`);
      if (user.weaknesses) lines.push(`Weaknesses: ${user.weaknesses}`);
      if (lines.length > 1) sections.set("profile", lines.join("\n"));
    }
  }

  // b. Activity Summary (last 7 days) — trimmable
  const [newContacts, fuDone, fuSkipped, recentInteractions] =
    await Promise.all([
      prisma.contact.count({ where: { created_at: { gte: weekAgo } } }),
      prisma.followUp.count({
        where: { status: "done", completed_at: { gte: weekAgo } },
      }),
      prisma.followUp.count({
        where: { status: "skipped", created_at: { gte: weekAgo } },
      }),
      prisma.interaction.findMany({
        where: { created_at: { gte: weekAgo }, type: { not: "note" } },
        select: {
          type: true,
          contact: { select: { full_name: true } },
          created_at: true,
        },
        orderBy: { created_at: "desc" },
        take: 10,
      }),
    ]);

  const interactionNames = recentInteractions
    .filter((i) => i.contact)
    .map((i) => `${i.contact!.full_name} (${i.type})`)
    .slice(0, 8);

  sections.set(
    "activity",
    `## ACTIVITY (last 7 days)\n` +
      `New contacts: ${newContacts}\n` +
      `Follow-ups done: ${fuDone}\n` +
      `Follow-ups skipped: ${fuSkipped}\n` +
      `Interactions: ${interactionNames.join(", ") || "none"}`
  );

  // c. Urgent Follow-ups (top 5) — always kept
  const urgentFu = await prisma.followUp.findMany({
    where: { status: "pending" },
    include: { contact: { select: { full_name: true } } },
    orderBy: [{ due_date: "asc" }, { priority: "desc" }],
    take: 5,
  });

  if (urgentFu.length > 0) {
    const fuLines = urgentFu.map((f) => {
      const date = f.due_date.toLocaleDateString();
      return `- [P${f.priority}] ${f.contact.full_name}: ${f.suggested_action} (due: ${date})`;
    });
    sections.set("followups", `## URGENT FOLLOW-UPS\n${fuLines.join("\n")}`);
  }

  // d. Contact Overview — trimmable
  const [totalContacts, byStatus, coolingContacts, warmContacts] =
    await Promise.all([
      prisma.contact.count({ where: { warmth_status: { not: "archived" } } }),
      prisma.contact.groupBy({
        by: ["warmth_status"],
        _count: true,
        where: { warmth_status: { not: "archived" } },
      }),
      prisma.contact.findMany({
        where: { warmth_status: "cooling" },
        select: {
          full_name: true,
          key_interests: true,
          last_interaction_at: true,
          occupation: true,
        },
        take: 3,
      }),
      prisma.contact.findMany({
        where: { warmth_status: "warm" },
        select: { full_name: true, occupation: true, warmth_score: true },
        orderBy: { warmth_score: "desc" },
        take: 3,
      }),
    ]);

  const statusLine = byStatus
    .map((s) => `${s.warmth_status}: ${s._count}`)
    .join(", ");

  let overview = `## CONTACTS\nTotal: ${totalContacts} (${statusLine})`;

  if (coolingContacts.length > 0) {
    overview += `\n\nCooling contacts:`;
    for (const c of coolingContacts) {
      const days = c.last_interaction_at
        ? Math.round(
            (now.getTime() - c.last_interaction_at.getTime()) / 86400000
          )
        : "never";
      overview += `\n- ${c.full_name} (${c.occupation || "N/A"}), ${days} days ago, interests: ${c.key_interests.join(", ") || "N/A"}`;
    }
  }

  if (warmContacts.length > 0) {
    overview += `\n\nWarmest contacts:`;
    for (const c of warmContacts) {
      overview += `\n- ${c.full_name} (${c.occupation || "N/A"}), score: ${c.warmth_score}`;
    }
  }

  sections.set("contacts", overview);

  // e. Recent Interactions (last 10) — first to trim
  const recentInter = await prisma.interaction.findMany({
    where: { type: { not: "note" } },
    orderBy: { created_at: "desc" },
    take: 10,
    select: {
      type: true,
      content: true,
      ai_summary: true,
      contact: { select: { full_name: true } },
      created_at: true,
    },
  });

  if (recentInter.length > 0) {
    const lines = recentInter.map((i) => {
      const date = i.created_at.toLocaleDateString();
      const name = i.contact?.full_name || "Unknown";
      const text = (i.ai_summary || i.content || "").slice(0, 80);
      return `- [${date}] ${i.type} with ${name}: ${text}`;
    });
    sections.set("interactions", `## RECENT INTERACTIONS\n${lines.join("\n")}`);
  }

  // f. Progress metrics — always kept
  const [fuDone7, fuDone30] = await Promise.all([
    prisma.followUp.count({
      where: { status: "done", completed_at: { gte: weekAgo } },
    }),
    prisma.followUp.count({
      where: {
        status: "done",
        completed_at: { gte: new Date(now.getTime() - 30 * 86400000) },
      },
    }),
  ]);

  sections.set(
    "progress",
    `## PROGRESS\nFollow-ups done (7d): ${fuDone7}\nFollow-ups done (30d): ${fuDone30}`
  );

  // Assemble with size control
  const order = ["profile", "followups", "contacts", "activity", "interactions", "progress"];
  const trimOrder = ["interactions", "activity", "contacts"]; // first trimmed first

  let result = order
    .filter((k) => sections.has(k))
    .map((k) => sections.get(k)!)
    .join("\n\n");

  // Trim if too large
  for (const key of trimOrder) {
    if (result.length <= MAX_CONTEXT_CHARS) break;
    sections.delete(key);
    result = order
      .filter((k) => sections.has(k))
      .map((k) => sections.get(k)!)
      .join("\n\n");
  }

  return result;
}

export async function buildContactContext(
  contactId: string
): Promise<string | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      interactions: {
        where: { type: { not: "note" } },
        orderBy: { created_at: "desc" },
        take: 10,
        select: {
          type: true,
          content: true,
          transcript: true,
          ai_summary: true,
          created_at: true,
        },
      },
      follow_ups: {
        orderBy: { created_at: "desc" },
        take: 5,
        select: {
          suggested_action: true,
          status: true,
          due_date: true,
          completed_at: true,
        },
      },
    },
  });

  if (!contact) return null;

  const lines = [
    `## DETAILED CONTACT: ${contact.full_name}`,
    contact.nickname && `Nickname: ${contact.nickname}`,
    contact.occupation && `Occupation: ${contact.occupation}`,
    contact.company && `Company: ${contact.company}`,
    contact.city && `City: ${contact.city}`,
    contact.country && `Country: ${contact.country}`,
    contact.where_met && `Where met: ${contact.where_met}`,
    contact.met_date &&
      `Met date: ${contact.met_date.toLocaleDateString()}`,
    contact.key_interests.length > 0 &&
      `Interests: ${contact.key_interests.join(", ")}`,
    contact.what_impressed_me &&
      `What impressed me: ${contact.what_impressed_me}`,
    contact.potential_synergies &&
      `Potential synergies: ${contact.potential_synergies}`,
    contact.personality_notes &&
      `Personality notes: ${contact.personality_notes}`,
    contact.memory_summary && `AI Summary: ${contact.memory_summary}`,
    contact.memory_notes.length > 0 &&
      `Memory hooks: ${contact.memory_notes.join(" | ")}`,
    contact.personal_notes && `My notes: ${contact.personal_notes}`,
    contact.relationship_category &&
      `Category: ${contact.relationship_category}`,
    `Warmth: ${contact.warmth_status} (score: ${contact.warmth_score})`,
    `Urgency: ${contact.urgency_score}/10`,
    contact.last_interaction_at &&
      `Last interaction: ${contact.last_interaction_at.toLocaleDateString()}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Interactions (max 10, text capped at 150 chars each)
  let interactionsText = "";
  if (contact.interactions.length > 0) {
    const items = contact.interactions.map((i) => {
      const date = i.created_at.toLocaleDateString();
      const text = (i.transcript || i.ai_summary || i.content || "(empty)").slice(0, 150);
      return `[${date}] ${i.type}: ${text}`;
    });
    interactionsText = `\n\nInteractions:\n${items.join("\n")}`;
  }

  // Follow-ups (max 5)
  let fuText = "";
  if (contact.follow_ups.length > 0) {
    const items = contact.follow_ups.map((f) => {
      const date = f.due_date.toLocaleDateString();
      return `[${f.status}] ${f.suggested_action} (due: ${date})`;
    });
    fuText = `\n\nFollow-ups:\n${items.join("\n")}`;
  }

  return lines + interactionsText + fuText;
}
