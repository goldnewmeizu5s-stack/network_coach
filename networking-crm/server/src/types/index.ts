export interface FollowUpSuggestion {
  action: string;
  due_days: number;
  reason: string;
}

export interface ExtractedContact {
  full_name: string | null;
  nickname: string | null;
  where_met: string | null;
  occupation: string | null;
  company: string | null;
  city: string | null;
  country: string | null;
  met_country: string | null;
  origin_country: string | null;
  key_interests: string[];
  user_goals_for_contact: string[];
  what_impressed_me: string | null;
  potential_synergies: string | null;
  personality_notes: string | null;
  suggested_next_steps: FollowUpSuggestion[];
  urgency_score: number;
  relationship_category: string;
  memory_summary: string | null;
  memory_hook: string | null;
  met_date: string | null;
  is_update: boolean | null;
  follow_up_questions: string[];
}

export interface GoalEvent {
  kind: "satisfied" | "new" | "abandoned";
  matched_goal_id: string | null;
  description: string;
  evidence: string;
}

export interface MultiExtractionResult {
  contacts: ExtractedContact[];
  is_voice_note: boolean;
}

export interface VoiceUploadResult {
  id: string;
  status: string;
}

export interface VoiceStatusResult {
  status: string;
  contact_id?: string | null;
  contact_ids?: string[];
  transcript?: string | null;
  error?: string;
}

// --- Batch voice activity types ---

export interface ActivitySegment {
  contact_name: string;
  matched_contact_id: string | null;
  is_new_contact: boolean;
  interaction_type: "meeting" | "message" | "voice_note" | "follow_up" | "note";
  activity_summary: string;
  topics_discussed: string[];
  outcomes: string[];
  suggested_next_steps: FollowUpSuggestion[];
  urgency_score: number;
  relationship_category: string;
  warmth_change: "improved" | "stable" | "declined";
  warmth_reason: string;
  memory_hook: string | null;
  memory_notes: string[];
  goal_events: GoalEvent[];
  // For new contacts only
  contact_data: Partial<ExtractedContact> | null;
}

export interface BatchActivityResult {
  is_valid: boolean;
  segments: ActivitySegment[];
  overall_summary: string;
}

export interface BatchProcessingResult {
  segments: Array<{
    contact_name: string;
    contact_id: string;
    is_new_contact: boolean;
    interaction_type: string;
    activity_summary: string;
    follow_ups_created: number;
    warmth_change: string;
  }>;
  overall_summary: string;
  contacts_updated: number;
  contacts_created: number;
  follow_ups_created: number;
}
