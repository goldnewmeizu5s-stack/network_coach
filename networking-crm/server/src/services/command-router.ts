import prisma from "../lib/prisma";
import { anthropic } from "../lib/ai";
import { config } from "../config";
import { logger } from "../lib/logger";
import { buildChatContext, buildContactContext } from "./context-builder";
import {
  recalcAndAutoStatus,
  isValidTransition,
  applyManualStatusChange,
} from "./warmth";
import { suggestActions } from "./message-drafting";
import { draftFollowUpMessage } from "./message-drafting";
import {
  getRelevantMethodologies,
  formatMethodologiesForPrompt,
} from "./methodology-retrieval";
import type Anthropic from "@anthropic-ai/sdk";

// ── Tool definitions for Claude ────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_contacts",
    description:
      "Search for contacts by name or keywords. Returns matching contacts with basic info.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Name or keyword to search for",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_contact_details",
    description:
      "Get full details about a specific contact including interactions, follow-ups, social links, memory summary.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_name: {
          type: "string",
          description: "Full or partial name of the contact",
        },
      },
      required: ["contact_name"],
    },
  },
  {
    name: "add_note",
    description: "Add a text note to a contact's interaction history.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_name: {
          type: "string",
          description: "Name of the contact",
        },
        note: {
          type: "string",
          description: "The note text to save",
        },
      },
      required: ["contact_name", "note"],
    },
  },
  {
    name: "list_followups",
    description:
      "List pending follow-ups, optionally filtered by contact name. Shows action, due date, priority.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_name: {
          type: "string",
          description:
            "Optional: filter follow-ups for a specific contact",
        },
        limit: {
          type: "number",
          description: "Max number of follow-ups to return (default 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "complete_followup",
    description:
      "Mark a follow-up as completed. Finds by contact name and action keyword match.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_name: {
          type: "string",
          description: "Name of the contact the follow-up belongs to",
        },
        action_keyword: {
          type: "string",
          description:
            "Keyword or partial text from the follow-up action to identify which one",
        },
      },
      required: ["contact_name"],
    },
  },
  {
    name: "snooze_followup",
    description: "Snooze (postpone) a follow-up by a number of days.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_name: {
          type: "string",
          description: "Name of the contact",
        },
        action_keyword: {
          type: "string",
          description: "Keyword from the follow-up action",
        },
        days: {
          type: "number",
          description: "Number of days to snooze (default 2)",
        },
      },
      required: ["contact_name"],
    },
  },
  {
    name: "create_followup",
    description: "Create a new follow-up task for a contact.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_name: {
          type: "string",
          description: "Name of the contact",
        },
        action: {
          type: "string",
          description: "What needs to be done",
        },
        due_days: {
          type: "number",
          description: "Days from now until due (default 2)",
        },
        priority: {
          type: "number",
          description: "Priority 1-10 (default 5)",
        },
      },
      required: ["contact_name", "action"],
    },
  },
  {
    name: "change_contact_status",
    description:
      "Change a contact's warmth status. Valid statuses: new, warming, warm, cooling, paused, archived.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_name: {
          type: "string",
          description: "Name of the contact",
        },
        new_status: {
          type: "string",
          enum: ["new", "warming", "warm", "cooling", "paused", "archived"],
          description: "The new warmth status",
        },
      },
      required: ["contact_name", "new_status"],
    },
  },
  {
    name: "draft_message",
    description:
      "Generate message drafts for a contact, optionally for a specific follow-up action.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_name: {
          type: "string",
          description: "Name of the contact",
        },
        context: {
          type: "string",
          description:
            "Optional: specific context or purpose for the message (e.g. 'congratulate on new job')",
        },
      },
      required: ["contact_name"],
    },
  },
  {
    name: "get_today_challenge",
    description:
      "Get today's networking challenge with title, description, difficulty, and status.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "accept_challenge",
    description: "Accept today's pending challenge.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "complete_challenge",
    description: "Mark today's accepted challenge as completed.",
    input_schema: {
      type: "object" as const,
      properties: {
        rating: {
          type: "number",
          description: "Rating 1-5 (optional)",
        },
        reflection: {
          type: "string",
          description: "Brief reflection on the challenge (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_stats",
    description:
      "Get networking statistics: contacts count by status, follow-ups done, challenge streak, warmth scores.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "suggest_actions",
    description:
      "Get AI-powered action suggestions for a specific contact (what to do next, message ideas, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_name: {
          type: "string",
          description: "Name of the contact",
        },
      },
      required: ["contact_name"],
    },
  },
  {
    name: "update_profile",
    description: "Update a user profile field (goals, fears, strengths, weaknesses, name).",
    input_schema: {
      type: "object" as const,
      properties: {
        field: {
          type: "string",
          enum: ["name", "goals", "fears", "strengths", "weaknesses"],
          description: "Which profile field to update",
        },
        value: {
          type: "string",
          description: "The new value",
        },
      },
      required: ["field", "value"],
    },
  },
  {
    name: "create_contact",
    description:
      "Create a new contact in the CRM. Use this when the user describes a person they met or wants to add.",
    input_schema: {
      type: "object" as const,
      properties: {
        full_name: {
          type: "string",
          description: "Full name of the contact",
        },
        nickname: {
          type: "string",
          description: "Nickname or short name (optional)",
        },
        occupation: {
          type: "string",
          description: "Job title or occupation (optional)",
        },
        company: {
          type: "string",
          description: "Company or organization (optional)",
        },
        city: {
          type: "string",
          description: "City (optional)",
        },
        country: {
          type: "string",
          description: "Country (optional)",
        },
        where_met: {
          type: "string",
          description: "Where/how they met (optional)",
        },
        key_interests: {
          type: "array",
          items: { type: "string" },
          description: "List of interests or topics (optional)",
        },
        what_impressed_me: {
          type: "string",
          description: "What impressed the user about this person (optional)",
        },
        potential_synergies: {
          type: "string",
          description: "Potential collaboration or mutual benefit (optional)",
        },
        personality_notes: {
          type: "string",
          description: "Personality observations (optional)",
        },
        personal_notes: {
          type: "string",
          description: "Any other notes about the contact (optional)",
        },
        met_date: {
          type: "string",
          description: "Date when they met, in ISO 8601 format YYYY-MM-DD. If user says a relative time like '2 months ago', calculate the actual date. (optional)",
        },
      },
      required: ["full_name"],
    },
  },
  {
    name: "edit_contact",
    description:
      "Edit/update an existing contact's fields. Use this when the user wants to correct or change any contact information (name, occupation, company, city, interests, notes, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_name: {
          type: "string",
          description:
            "Current name (or partial name) of the contact to find and edit",
        },
        full_name: {
          type: "string",
          description: "New full name (if renaming the contact)",
        },
        nickname: {
          type: "string",
          description: "New nickname",
        },
        occupation: {
          type: "string",
          description: "New job title or occupation",
        },
        company: {
          type: "string",
          description: "New company or organization",
        },
        city: {
          type: "string",
          description: "New city",
        },
        country: {
          type: "string",
          description: "New country",
        },
        met_country: {
          type: "string",
          description: "Country where they met",
        },
        origin_country: {
          type: "string",
          description: "Contact's origin country",
        },
        where_met: {
          type: "string",
          description: "Where/how they met",
        },
        key_interests: {
          type: "array",
          items: { type: "string" },
          description: "Updated list of interests/topics",
        },
        what_impressed_me: {
          type: "string",
          description: "What impressed the user about this person",
        },
        potential_synergies: {
          type: "string",
          description: "Potential collaboration or mutual benefit",
        },
        personality_notes: {
          type: "string",
          description: "Personality observations",
        },
        memory_summary: {
          type: "string",
          description: "Short portrait/summary of the person",
        },
        personal_notes: {
          type: "string",
          description: "Personal notes about the contact",
        },
        relationship_category: {
          type: "string",
          description:
            "Relationship category (e.g. business, friendship, mentor)",
        },
      },
      required: ["contact_name"],
    },
  },
  {
    name: "list_contacts",
    description:
      "List contacts, optionally filtered by warmth status. Returns names, status, occupation, last interaction.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["all", "new", "warming", "warm", "cooling", "paused"],
          description: "Filter by warmth status (default: all)",
        },
        limit: {
          type: "number",
          description: "Max contacts to return (default 10)",
        },
      },
      required: [],
    },
  },
];

// ── System prompt ──────────────────────────────────────────

const ROUTER_SYSTEM_PROMPT = `You are the AI brain of a networking CRM Telegram bot. The user sends you natural language messages (text or transcribed voice). Your job is to understand their intent and execute the appropriate actions using the available tools.

RULES:
- ALWAYS respond in the same language the user writes in (usually Russian)
- Use tools to fulfill the user's request. You may call multiple tools if needed.
- After calling tools, provide a concise, friendly summary of what was done or found
- If the user's request is conversational (greeting, general question about networking), respond directly without tools
- If the user mentions a person's name, try to find them in contacts first
- If the user corrects or updates any contact info (name, occupation, city, etc.), use edit_contact to apply the change directly
- Be proactive: if user says "I met with Alex today", search for Alex and add a note about the meeting
- When unsure which contact the user means, search first and pick the best match
- Keep responses SHORT and actionable — this is a Telegram chat, not an essay
- Use the CRM context below to make informed decisions

{crm_context}

IMPORTANT: You have access to ALL bot functions. The user can ask you anything — searching contacts, managing follow-ups, challenges, drafting messages, getting advice, etc. Figure out the intent and act on it.`;

// ── Tool execution ─────────────────────────────────────────

async function findContactByName(
  name: string,
): Promise<{ id: string; full_name: string } | null> {
  // Try exact match first
  let contact = await prisma.contact.findFirst({
    where: {
      full_name: { contains: name, mode: "insensitive" },
      warmth_status: { not: "archived" },
    },
    select: { id: true, full_name: true },
  });
  if (contact) return contact;

  // Try each word separately
  const words = name.trim().split(/\s+/);
  for (const word of words) {
    if (word.length < 2) continue;
    contact = await prisma.contact.findFirst({
      where: {
        full_name: { contains: word, mode: "insensitive" },
        warmth_status: { not: "archived" },
      },
      select: { id: true, full_name: true },
    });
    if (contact) return contact;
  }

  return null;
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  createdContactIds: string[],
): Promise<string> {
  try {
    switch (name) {
      case "search_contacts": {
        const query = input.query as string;
        const contacts = await prisma.contact.findMany({
          where: {
            full_name: { contains: query, mode: "insensitive" },
            warmth_status: { not: "archived" },
          },
          select: {
            id: true,
            full_name: true,
            occupation: true,
            company: true,
            warmth_status: true,
            warmth_score: true,
            last_interaction_at: true,
          },
          take: 10,
          orderBy: { last_interaction_at: { sort: "desc", nulls: "last" } },
        });

        if (contacts.length === 0) return `No contacts found matching "${query}".`;

        return contacts
          .map((c: any) => {
            const job = [c.occupation, c.company].filter(Boolean).join(" @ ");
            const days = c.last_interaction_at
              ? Math.floor(
                  (Date.now() - c.last_interaction_at.getTime()) / 86400000,
                )
              : null;
            return `- ${c.full_name} | ${c.warmth_status} (${Math.round(c.warmth_score)}/100) | ${job || "N/A"} | last: ${days !== null ? days + "d ago" : "never"}`;
          })
          .join("\n");
      }

      case "get_contact_details": {
        const contact = await findContactByName(input.contact_name as string);
        if (!contact) return `Contact "${input.contact_name}" not found.`;

        const detail = await buildContactContext(contact.id);
        return detail || `Contact ${contact.full_name} found but no details available.`;
      }

      case "add_note": {
        const contact = await findContactByName(input.contact_name as string);
        if (!contact) return `Contact "${input.contact_name}" not found.`;

        await prisma.interaction.create({
          data: {
            contact_id: contact.id,
            type: "note",
            content: input.note as string,
          },
        });
        await recalcAndAutoStatus(contact.id);
        return `Note added to ${contact.full_name}: "${input.note}"`;
      }

      case "list_followups": {
        const now = new Date();
        const limit = (input.limit as number) || 10;

        let whereClause: Record<string, unknown> = {
          OR: [
            { status: "pending" },
            { status: "snoozed", snoozed_until: { lte: now } },
          ],
        };

        if (input.contact_name) {
          const contact = await findContactByName(input.contact_name as string);
          if (!contact) return `Contact "${input.contact_name}" not found.`;
          whereClause = { ...whereClause, contact_id: contact.id };
        }

        const followups = await prisma.followUp.findMany({
          where: whereClause,
          include: {
            contact: { select: { full_name: true } },
          },
          orderBy: [{ due_date: "asc" }],
          take: limit,
        });

        if (followups.length === 0) return "No pending follow-ups.";

        return followups
          .map((f: any) => {
            const days = Math.floor(
              (f.due_date.getTime() - Date.now()) / 86400000,
            );
            const urgency =
              days < 0
                ? `OVERDUE by ${Math.abs(days)}d`
                : days === 0
                  ? "TODAY"
                  : `in ${days}d`;
            return `- [P${f.priority}] ${f.contact.full_name}: ${f.suggested_action} (${urgency})`;
          })
          .join("\n");
      }

      case "complete_followup": {
        const contact = await findContactByName(input.contact_name as string);
        if (!contact) return `Contact "${input.contact_name}" not found.`;

        const keyword = input.action_keyword as string | undefined;
        const now = new Date();

        const followups = await prisma.followUp.findMany({
          where: {
            contact_id: contact.id,
            OR: [
              { status: "pending" },
              { status: "snoozed", snoozed_until: { lte: now } },
            ],
          },
          orderBy: { due_date: "asc" },
        });

        if (followups.length === 0)
          return `No pending follow-ups for ${contact.full_name}.`;

        // Find best match
        let fu = followups[0];
        if (keyword) {
          const match = followups.find((f: any) =>
            f.suggested_action.toLowerCase().includes(keyword.toLowerCase()),
          );
          if (match) fu = match;
        }

        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: "done", completed_at: new Date() },
        });

        await prisma.interaction.create({
          data: {
            contact_id: contact.id,
            type: "follow_up",
            content: `Follow-up completed: ${fu.suggested_action}`,
          },
        });

        await prisma.contact.update({
          where: { id: contact.id },
          data: { last_interaction_at: new Date() },
        });

        await recalcAndAutoStatus(contact.id);

        return `Completed follow-up for ${contact.full_name}: "${fu.suggested_action}"`;
      }

      case "snooze_followup": {
        const contact = await findContactByName(input.contact_name as string);
        if (!contact) return `Contact "${input.contact_name}" not found.`;

        const keyword = input.action_keyword as string | undefined;
        const days = (input.days as number) || 2;
        const now = new Date();

        const followups = await prisma.followUp.findMany({
          where: {
            contact_id: contact.id,
            OR: [
              { status: "pending" },
              { status: "snoozed", snoozed_until: { lte: now } },
            ],
          },
          orderBy: { due_date: "asc" },
        });

        if (followups.length === 0)
          return `No pending follow-ups for ${contact.full_name}.`;

        let fu = followups[0];
        if (keyword) {
          const match = followups.find((f: any) =>
            f.suggested_action.toLowerCase().includes(keyword.toLowerCase()),
          );
          if (match) fu = match;
        }

        const snoozedUntil = new Date();
        snoozedUntil.setDate(snoozedUntil.getDate() + days);

        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: "snoozed", snoozed_until: snoozedUntil },
        });

        return `Snoozed follow-up for ${contact.full_name} by ${days} days: "${fu.suggested_action}"`;
      }

      case "create_followup": {
        const contact = await findContactByName(input.contact_name as string);
        if (!contact) return `Contact "${input.contact_name}" not found.`;

        const dueDays = (input.due_days as number) || 2;
        const priority = (input.priority as number) || 5;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + dueDays);

        await prisma.followUp.create({
          data: {
            contact_id: contact.id,
            suggested_action: input.action as string,
            due_date: dueDate,
            priority,
          },
        });

        return `Created follow-up for ${contact.full_name}: "${input.action}" (due in ${dueDays} days, P${priority})`;
      }

      case "change_contact_status": {
        const contact = await findContactByName(input.contact_name as string);
        if (!contact) return `Contact "${input.contact_name}" not found.`;

        const newStatus = input.new_status as string;
        const current = await prisma.contact.findUnique({
          where: { id: contact.id },
          select: { warmth_status: true },
        });

        if (!current) return "Contact not found.";

        if (!isValidTransition(current.warmth_status, newStatus)) {
          return `Cannot change status from ${current.warmth_status} to ${newStatus}. Invalid transition.`;
        }

        await prisma.interaction.create({
          data: {
            contact_id: contact.id,
            type: "note",
            content: `Status changed: ${current.warmth_status} → ${newStatus}`,
          },
        });

        await applyManualStatusChange(contact.id, newStatus);

        return `Changed ${contact.full_name} status: ${current.warmth_status} → ${newStatus}`;
      }

      case "draft_message": {
        const contact = await findContactByName(input.contact_name as string);
        if (!contact) return `Contact "${input.contact_name}" not found.`;

        const context =
          (input.context as string) || "follow up and strengthen the connection";

        const drafts = await draftFollowUpMessage(contact.id, context);
        return `Message drafts for ${contact.full_name}:\n\n${drafts.map((d, i) => `${i + 1}. ${d}`).join("\n\n")}`;
      }

      case "get_today_challenge": {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + 86400000);

        const challenge = await prisma.challenge.findFirst({
          where: { date: { gte: start, lt: end } },
          include: {
            methodology: { select: { title: true, source: true } },
          },
          orderBy: { created_at: "asc" },
        });

        if (!challenge) {
          const { generateDailyChallenge } = await import(
            "./challenge-engine"
          );
          const ch = await generateDailyChallenge();
          const full = await prisma.challenge.findUnique({
            where: { id: ch.id },
            include: {
              methodology: { select: { title: true, source: true } },
            },
          });
          if (!full) return "Failed to generate challenge.";
          return `Today's challenge: "${full.title}" (${full.category}, difficulty ${full.difficulty}/10)\n${full.description}\nStatus: ${full.status}${full.methodology ? `\nMethod: ${full.methodology.title}` : ""}`;
        }

        return `Today's challenge: "${challenge.title}" (${challenge.category}, difficulty ${challenge.difficulty}/10)\n${challenge.description}\nStatus: ${challenge.status}${challenge.methodology ? `\nMethod: ${challenge.methodology.title}` : ""}`;
      }

      case "accept_challenge": {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + 86400000);

        const challenge = await prisma.challenge.findFirst({
          where: { date: { gte: start, lt: end }, status: "pending" },
          orderBy: { created_at: "asc" },
        });

        if (!challenge) return "No pending challenge to accept today.";

        await prisma.challenge.update({
          where: { id: challenge.id },
          data: { status: "accepted" },
        });

        return `Accepted challenge: "${challenge.title}"`;
      }

      case "complete_challenge": {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + 86400000);

        const challenge = await prisma.challenge.findFirst({
          where: { date: { gte: start, lt: end }, status: "accepted" },
          orderBy: { created_at: "asc" },
        });

        if (!challenge) return "No accepted challenge to complete today.";

        const rating = (input.rating as number) || 0;
        const reflection = (input.reflection as string) || null;

        await prisma.challenge.update({
          where: { id: challenge.id },
          data: {
            status: "completed",
            completed_at: new Date(),
            ...(rating > 0 && {
              rating: Math.max(1, Math.min(5, rating)),
            }),
            ...(reflection && { reflection }),
          },
        });

        return `Completed challenge: "${challenge.title}"${rating ? ` (rated ${rating}/5)` : ""}${reflection ? ` — "${reflection}"` : ""}`;
      }

      case "get_stats": {
        const weekAgo = new Date(Date.now() - 7 * 86400000);
        const now = new Date();

        const [
          totalContacts,
          byStatus,
          fuDoneWeek,
          pendingFu,
          avgWarmth,
          weekChallenges,
        ] = await Promise.all([
          prisma.contact.count({
            where: { warmth_status: { not: "archived" } },
          }),
          prisma.contact.groupBy({
            by: ["warmth_status"],
            _count: true,
            where: { warmth_status: { not: "archived" } },
          }),
          prisma.followUp.count({
            where: { status: "done", completed_at: { gte: weekAgo } },
          }),
          prisma.followUp.count({ where: { status: "pending" } }),
          prisma.contact.aggregate({
            _avg: { warmth_score: true },
            where: { warmth_status: { not: "archived" } },
          }),
          prisma.challenge.findMany({
            where: { date: { gte: weekAgo } },
            select: { status: true },
          }),
        ]);

        const statusLine = byStatus
          .map((s: any) => `${s.warmth_status}: ${s._count}`)
          .join(", ");
        const challengesDone = weekChallenges.filter(
          (c: any) => c.status === "completed",
        ).length;
        const avg = Math.round(avgWarmth._avg?.warmth_score ?? 0);

        return [
          `Total contacts: ${totalContacts} (${statusLine})`,
          `Follow-ups done (7d): ${fuDoneWeek}, pending: ${pendingFu}`,
          `Challenges (7d): ${challengesDone}/${weekChallenges.length}`,
          `Average warmth: ${avg}/100`,
        ].join("\n");
      }

      case "suggest_actions": {
        const contact = await findContactByName(input.contact_name as string);
        if (!contact) return `Contact "${input.contact_name}" not found.`;

        const suggestions = await suggestActions(contact.id);
        if (suggestions.length === 0)
          return `No suggestions available for ${contact.full_name}.`;

        return suggestions
          .map(
            (s) =>
              `[${s.urgency}] ${s.action}${s.timeframe ? ` (${s.timeframe})` : ""}${s.reasoning ? ` — ${s.reasoning}` : ""}`,
          )
          .join("\n");
      }

      case "update_profile": {
        const field = input.field as string;
        const value = input.value as string;
        const dbFieldMap: Record<string, string> = {
          name: "name",
          goals: "goals",
          fears: "fears",
          strengths: "strengths",
          weaknesses: "weaknesses",
        };
        const dbField = dbFieldMap[field];
        if (!dbField) return `Unknown profile field: ${field}`;

        const user = await prisma.user.findFirst();
        if (!user) return "User profile not found.";

        await prisma.user.update({
          where: { id: user.id },
          data: { [dbField]: value },
        });

        return `Updated profile ${field} to: "${value}"`;
      }

      case "create_contact": {
        const fullName = input.full_name as string;
        // Check if contact already exists
        const existing = await findContactByName(fullName);
        if (existing) {
          return `Contact "${existing.full_name}" already exists. Use add_note to update their info.`;
        }

        const contact = await prisma.contact.create({
          data: {
            full_name: fullName,
            nickname: (input.nickname as string) || null,
            occupation: (input.occupation as string) || null,
            company: (input.company as string) || null,
            city: (input.city as string) || null,
            country: (input.country as string) || null,
            where_met: (input.where_met as string) || null,
            key_interests: (input.key_interests as string[]) || [],
            what_impressed_me: (input.what_impressed_me as string) || null,
            potential_synergies: (input.potential_synergies as string) || null,
            personality_notes: (input.personality_notes as string) || null,
            personal_notes: (input.personal_notes as string) || null,
            warmth_status: "new",
            warmth_score: 0,
            met_date: input.met_date ? new Date(input.met_date as string) : new Date(),
            last_interaction_at: new Date(),
          },
        });

        createdContactIds.push(contact.id);
        return `Created new contact: ${contact.full_name} (id: ${contact.id}, status: new). You can now add notes, create follow-ups, and more.`;
      }

      case "edit_contact": {
        const contact = await findContactByName(input.contact_name as string);
        if (!contact) return `Contact "${input.contact_name}" not found.`;

        // Build update data from provided fields (skip contact_name — it's the search key)
        const editableFields = [
          "full_name", "nickname", "occupation", "company",
          "city", "country", "met_country", "origin_country",
          "where_met", "what_impressed_me", "potential_synergies",
          "personality_notes", "memory_summary", "personal_notes",
          "relationship_category",
        ];

        const updateData: Record<string, unknown> = {};
        for (const field of editableFields) {
          if (input[field] !== undefined) {
            updateData[field] = input[field] as string;
          }
        }
        if (input.key_interests !== undefined) {
          updateData.key_interests = input.key_interests as string[];
        }

        if (Object.keys(updateData).length === 0) {
          return `No fields to update for ${contact.full_name}. Specify what to change.`;
        }

        const oldName = contact.full_name;
        await prisma.contact.update({
          where: { id: contact.id },
          data: updateData,
        });

        // Log the edit as an interaction
        const changedFields = Object.keys(updateData).join(", ");
        await prisma.interaction.create({
          data: {
            contact_id: contact.id,
            type: "note",
            content: `Contact edited: updated ${changedFields}`,
          },
        });

        const newName = (updateData.full_name as string) || oldName;
        return `Updated ${oldName}${updateData.full_name ? ` → ${newName}` : ""}: changed ${changedFields}`;
      }

      case "list_contacts": {
        const status = (input.status as string) || "all";
        const limit = (input.limit as number) || 10;

        const where =
          status === "all"
            ? { warmth_status: { not: "archived" } }
            : { warmth_status: status };

        const contacts = await prisma.contact.findMany({
          where,
          select: {
            full_name: true,
            occupation: true,
            company: true,
            warmth_status: true,
            warmth_score: true,
            last_interaction_at: true,
          },
          orderBy: {
            last_interaction_at: { sort: "desc", nulls: "last" },
          },
          take: limit,
        });

        if (contacts.length === 0) return "No contacts found.";

        return contacts
          .map((c: any) => {
            const job = [c.occupation, c.company].filter(Boolean).join(" @ ");
            const days = c.last_interaction_at
              ? Math.floor(
                  (Date.now() - c.last_interaction_at.getTime()) / 86400000,
                )
              : null;
            return `- ${c.full_name} | ${c.warmth_status} (${Math.round(c.warmth_score)}/100) | ${job || "—"} | ${days !== null ? days + "d ago" : "never"}`;
          })
          .join("\n");
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    logger.error(`Tool execution error: ${name}`, { error: String(err) });
    return `Error executing ${name}: ${String(err)}`;
  }
}

// ── Main router ────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Route a free-form user message through Claude with tool_use.
 * Returns the final text response to show the user.
 */
export interface RouteResult {
  text: string;
  createdContactIds: string[];
}

export async function routeCommand(message: string): Promise<RouteResult> {
  // Build CRM context
  const crmContext = await buildChatContext();

  const todayStr = new Date().toISOString().slice(0, 10);
  const systemPrompt = ROUTER_SYSTEM_PROMPT.replace(
    "{crm_context}",
    crmContext,
  ) + `\n\nToday's date is ${todayStr}. When the user mentions relative times like "2 месяца назад", "вчера", "на прошлой неделе", calculate the actual date for the met_date field.`;

  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: message },
  ];

  // Load recent chat history for context (last 6 messages)
  const history = await prisma.chatMessage.findMany({
    orderBy: { created_at: "desc" },
    take: 6,
    select: { role: true, content: true },
  });
  history.reverse();

  if (history.length > 0) {
    const historyMessages: Anthropic.MessageParam[] = [];
    for (const h of history) {
      const role = h.role === "assistant" ? "assistant" : "user";
      // Ensure alternating roles
      if (
        historyMessages.length > 0 &&
        historyMessages[historyMessages.length - 1].role === role
      ) {
        const last = historyMessages[historyMessages.length - 1];
        historyMessages[historyMessages.length - 1] = {
          role,
          content: last.content + "\n\n" + h.content,
        };
      } else {
        historyMessages.push({ role, content: h.content });
      }
    }
    // Ensure first message is from user
    while (
      historyMessages.length > 0 &&
      historyMessages[0].role === "assistant"
    ) {
      historyMessages.shift();
    }
    // Merge with last user message if consecutive (prevents 400 from Claude API)
    if (
      historyMessages.length > 0 &&
      historyMessages[historyMessages.length - 1].role === "user"
    ) {
      historyMessages[historyMessages.length - 1] = {
        role: "user",
        content:
          historyMessages[historyMessages.length - 1].content + "\n\n" + message,
      };
    } else {
      historyMessages.push({ role: "user", content: message });
    }
    messages = historyMessages;
  }

  const MAX_TOOL_ROUNDS = 5;
  let finalText = "";
  const createdContactIds: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: Anthropic.Message;

    const backoff = [2000, 5000];
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        response = await anthropic.messages.create({
          model: config.claudeModel,
          max_tokens: 2000,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        });
        break;
      } catch (err) {
        if (attempt < 2) {
          logger.warn(
            `Command router Claude attempt ${attempt + 1} failed, retrying`,
            { error: err instanceof Error ? err.message : String(err) },
          );
          await sleep(backoff[attempt]);
        } else {
          throw err;
        }
      }
    }

    // Collect text and tool_use blocks
    const textParts: string[] = [];
    const toolUses: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }> = [];

    for (const block of response!.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    if (textParts.length > 0) {
      finalText = textParts.join("\n");
    }

    // If no tool calls, we're done
    if (toolUses.length === 0 || response!.stop_reason === "end_turn") {
      break;
    }

    // Execute tools and build tool results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      logger.info(`Command router: executing tool ${tu.name}`, {
        input: JSON.stringify(tu.input).slice(0, 200),
      });
      const result = await executeTool(tu.name, tu.input, createdContactIds);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: result,
      });
    }

    // Add assistant message and tool results to conversation
    messages.push({ role: "assistant", content: response!.content });
    messages.push({ role: "user", content: toolResults });
  }

  // Save to chat history
  const responseText = finalText || "Готово!";
  await prisma.chatMessage.create({
    data: { role: "user", content: message },
  });
  await prisma.chatMessage.create({
    data: { role: "assistant", content: responseText },
  });

  return { text: responseText, createdContactIds };
}
