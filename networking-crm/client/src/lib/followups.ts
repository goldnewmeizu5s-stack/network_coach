export interface FollowUpItem {
  id: string;
  contact_id: string;
  suggested_action: string;
  due_date: string;
  status: string;
  priority: number;
  snoozed_until: string | null;
  completed_at: string | null;
  created_at: string;
  contact: {
    full_name: string;
    warmth_status: string;
    photo_url: string | null;
  };
}

export function getDueDateInfo(dueDate: string): {
  text: string;
  color: string;
  urgency: "overdue" | "today" | "upcoming" | "later";
} {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      text: `просрочено на ${Math.abs(diffDays)} дн.`,
      color: "#ef4444",
      urgency: "overdue",
    };
  }
  if (diffDays === 0) {
    return { text: "сегодня", color: "#eab308", urgency: "today" };
  }
  if (diffDays <= 7) {
    return {
      text: `через ${diffDays} дн.`,
      color: "#22c55e",
      urgency: "upcoming",
    };
  }
  return {
    text: `через ${diffDays} дн.`,
    color: "#6b7280",
    urgency: "later",
  };
}

export const SNOOZE_OPTIONS = [
  { label: "Через 2 дня", days: 2 },
  { label: "Через неделю", days: 7 },
  { label: "Через 2 недели", days: 14 },
];
