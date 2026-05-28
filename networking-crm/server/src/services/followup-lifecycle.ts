import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { generateFollowUpsForContact } from "./followup-engine";

/**
 * Follow-up lifecycle helpers — the single place that decides when stale
 * follow-ups should be cancelled and when fresh ones should be (re)created.
 *
 * Core ideas:
 * - "auto" follow-ups (AI/engine generated) are disposable: when the situation
 *   changes (new interaction, status change) they are cancelled and rebuilt.
 * - "user" follow-ups (explicitly created or kept by the user) are sacred and
 *   never auto-cancelled — except on archive, which silences everything.
 * - A contact never holds more than MAX_OPEN_FOLLOWUPS open follow-ups, and we
 *   never insert a near-duplicate of an already-open one.
 */

/** Max simultaneously-open (pending/snoozed) follow-ups per contact.
 *  Mirrors the hard cap in followup-engine.ts (generateFollowUps). */
export const MAX_OPEN_FOLLOWUPS = 3;

const OPEN_STATUSES = ["pending", "snoozed"];

/** Normalize an action string for duplicate detection. */
function normalizeAction(action: string): string {
  return action.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Cancel a contact's open (pending/snoozed) follow-ups by moving them to the
 * terminal "cancelled" status. Used when the situation has changed and the
 * existing follow-ups are stale or irrelevant.
 *
 * @param opts.onlyAuto when true (default) only auto-generated follow-ups are
 *   cancelled — user-created/kept ones (source="user") are preserved. Pass
 *   false to cancel everything (e.g. when archiving).
 * @returns number of follow-ups cancelled.
 */
export async function cancelOpenFollowUps(
  contactId: string,
  opts: { onlyAuto?: boolean } = {},
): Promise<number> {
  const onlyAuto = opts.onlyAuto ?? true;
  const result = await prisma.followUp.updateMany({
    where: {
      contact_id: contactId,
      status: { in: OPEN_STATUSES },
      ...(onlyAuto ? { source: "auto" } : {}),
    },
    data: { status: "cancelled" },
  });
  if (result.count > 0) {
    logger.info("[followup-lifecycle] Cancelled open follow-ups", {
      contactId,
      count: result.count,
      onlyAuto,
    });
  }
  return result.count;
}

/**
 * Insert follow-up drafts for a contact, skipping near-duplicates of existing
 * open follow-ups and never letting the open count exceed MAX_OPEN_FOLLOWUPS.
 * @returns the number actually inserted.
 */
export async function insertFollowUps(
  contactId: string,
  drafts: { suggested_action: string; due_date: Date; priority: number }[],
  source: "auto" | "user" = "auto",
): Promise<number> {
  if (drafts.length === 0) return 0;

  const open = await prisma.followUp.findMany({
    where: { contact_id: contactId, status: { in: OPEN_STATUSES } },
    select: { suggested_action: true },
  });

  const seen = new Set(open.map((f) => normalizeAction(f.suggested_action)));
  let slots = MAX_OPEN_FOLLOWUPS - open.length;
  if (slots <= 0) return 0;

  const toCreate: typeof drafts = [];
  for (const d of drafts) {
    if (slots <= 0) break;
    const norm = normalizeAction(d.suggested_action);
    if (!norm || seen.has(norm)) continue; // skip empty + near-duplicates
    seen.add(norm);
    toCreate.push(d);
    slots--;
  }
  if (toCreate.length === 0) return 0;

  await prisma.followUp.createMany({
    data: toCreate.map((d) => ({
      contact_id: contactId,
      suggested_action: d.suggested_action,
      due_date: d.due_date,
      priority: d.priority,
      source,
    })),
  });
  return toCreate.length;
}

/**
 * Re-evaluate a contact after a situation change: cancel stale AUTO follow-ups
 * and regenerate a fresh, status-appropriate set via the follow-up engine.
 * User-created follow-ups are preserved. Safe to call on any non-archived
 * status change. Must be called AFTER the new status has been persisted so the
 * engine sees the up-to-date state.
 */
export async function supersedeAndRegenerate(contactId: string): Promise<void> {
  await cancelOpenFollowUps(contactId, { onlyAuto: true });
  const drafts = await generateFollowUpsForContact(contactId);
  if (drafts.length > 0) {
    await insertFollowUps(contactId, drafts, "auto");
  }
}
