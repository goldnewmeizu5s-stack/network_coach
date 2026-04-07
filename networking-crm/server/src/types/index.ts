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
  key_interests: string[];
  what_impressed_me: string | null;
  potential_synergies: string | null;
  personality_notes: string | null;
  suggested_next_steps: FollowUpSuggestion[];
  urgency_score: number;
  relationship_category: string;
  memory_summary: string | null;
  memory_hook: string | null;
  is_update: boolean | null;
  follow_up_questions: string[];
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
