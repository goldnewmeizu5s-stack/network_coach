import { z } from "zod";

export const WARMTH_STATUSES = [
  "new",
  "warming",
  "warm",
  "cooling",
  "paused",
  "archived",
] as const;

export const CHALLENGE_STATUSES = [
  "pending",
  "accepted",
  "completed",
  "skipped",
  "too_hard",
] as const;

export const FOLLOWUP_STATUSES = [
  "pending",
  "done",
  "snoozed",
  "skipped",
] as const;

export const INTERACTION_TYPES = [
  "meeting",
  "message",
  "note",
] as const;

export const createContactSchema = z.object({
  full_name: z.string().min(1).max(200),
  nickname: z.string().max(100).optional(),
  occupation: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  where_met: z.string().max(500).optional(),
  key_interests: z.array(z.string()).optional(),
  relationship_category: z.string().max(50).optional(),
  met_date: z.string().refine((s) => !isNaN(Date.parse(s)), "Invalid date").optional(),
});

export const updateContactSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  nickname: z.string().max(100).nullable().optional(),
  occupation: z.string().max(200).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  where_met: z.string().max(500).nullable().optional(),
  key_interests: z.array(z.string()).optional(),
  memory_notes: z.array(z.string().max(500)).optional(),
  personal_notes: z.string().max(5000).nullable().optional(),
  warmth_status: z.enum(WARMTH_STATUSES).optional(),
  relationship_category: z.string().max(50).nullable().optional(),
  social_links: z.record(z.string(), z.string()).nullable().optional(),
  photo_url: z.string().max(500).nullable().optional(),
});

export const createFollowUpSchema = z.object({
  contact_id: z.string().uuid(),
  suggested_action: z.string().min(1).max(1000),
  due_date: z.string().refine((s) => !isNaN(Date.parse(s)), "Invalid date"),
  priority: z.number().int().min(1).max(10).optional(),
});

export const updateFollowUpSchema = z.object({
  status: z.enum(["done", "snoozed", "skipped"]),
  snoozed_until: z
    .string()
    .refine((s) => !isNaN(Date.parse(s)), "Invalid date")
    .optional(),
});

export const updateChallengeSchema = z.object({
  status: z.enum(["accepted", "completed", "skipped", "too_hard"]),
  reflection: z.string().max(2000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

export const interactionSchema = z.object({
  type: z.enum(INTERACTION_TYPES),
  content: z.string().max(5000).optional(),
});

export const chatMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  contact_id: z.string().uuid().optional(),
});

export const batchActionSchema = z.object({
  action: z.enum(["archive", "pause"]),
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export const pinSchema = z.object({
  current_pin: z.string().min(4),
  new_pin: z.string().min(4).max(20),
});
