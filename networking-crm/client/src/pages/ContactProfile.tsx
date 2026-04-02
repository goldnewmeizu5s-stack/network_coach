import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import {
  getWarmthColor,
  getInitials,
  timeAgo,
  WARMTH_LABELS,
} from "../lib/warmth";
import VoiceRecorder from "../components/VoiceRecorder";

interface Interaction {
  id: string;
  type: string;
  content: string | null;
  transcript: string | null;
  ai_summary: string | null;
  created_at: string;
}

interface FollowUp {
  id: string;
  suggested_action: string;
  due_date: string;
  status: string;
  priority: number;
}

interface Contact {
  id: string;
  full_name: string;
  nickname: string | null;
  photo_url: string | null;
  where_met: string | null;
  met_date: string | null;
  occupation: string | null;
  company: string | null;
  city: string | null;
  country: string | null;
  key_interests: string[];
  what_impressed_me: string | null;
  potential_synergies: string | null;
  personality_notes: string | null;
  memory_summary: string | null;
  relationship_category: string | null;
  personal_notes: string | null;
  warmth_status: string;
  warmth_score: number;
  urgency_score: number;
  last_interaction_at: string | null;
  created_at: string;
  interactions: Interaction[];
  follow_ups: FollowUp[];
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  new: ["warming", "paused", "archived"],
  warming: ["warm", "paused", "archived", "new"],
  warm: ["cooling", "paused", "archived"],
  cooling: ["warming", "paused", "archived"],
  paused: ["new", "archived"],
  archived: ["new"],
};

const TYPE_LABELS: Record<string, string> = {
  voice_note: "Голосовое",
  follow_up: "Follow-up",
  meeting: "Встреча",
  message: "Сообщение",
  note: "Заметка",
};

export default function ContactProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRecorder, setShowRecorder] = useState(false);
  const [showStatusSheet, setShowStatusSheet] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [personalNotes, setPersonalNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showHardDelete, setShowHardDelete] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await api.get<Contact>(`/contacts/${id}`);
      setContact(data);
      setPersonalNotes(data.personal_notes || "");
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchContact();
  }, [fetchContact]);

  const updateStatus = async (status: string) => {
    if (!id) return;
    try {
      await api.put(`/contacts/${id}/status`, { status });
      await fetchContact();
    } catch {
      // ignore
    }
    setShowStatusSheet(false);
  };

  const saveNotes = async () => {
    if (!id) return;
    setNotesSaving(true);
    try {
      await api.put(`/contacts/${id}`, { personal_notes: personalNotes });
      setContact((prev) =>
        prev ? { ...prev, personal_notes: personalNotes } : prev
      );
    } catch {
      // ignore
    } finally {
      setNotesSaving(false);
    }
  };

  const addNote = async () => {
    if (!id || !noteText.trim()) return;
    try {
      await api.post(`/contacts/${id}/interaction`, {
        type: "note",
        content: noteText.trim(),
      });
      setNoteText("");
      setShowNoteInput(false);
      await fetchContact();
    } catch {
      // ignore
    }
  };

  const addMeeting = async () => {
    if (!id) return;
    try {
      await api.post(`/contacts/${id}/interaction`, {
        type: "meeting",
        content: `Встреча ${new Date().toLocaleDateString("ru")}`,
      });
      await fetchContact();
    } catch {
      // ignore
    }
  };

  const archiveContact = async () => {
    if (!id) return;
    await api.del(`/contacts/${id}`);
    setShowDeleteConfirm(false);
    navigate("/people");
  };

  const hardDelete = async () => {
    if (!id) return;
    await api.del(`/contacts/${id}?hard=true`);
    setShowHardDelete(false);
    navigate("/people");
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-neutral-400">Контакт не найден</p>
      </div>
    );
  }

  const warmthColor = getWarmthColor(contact.warmth_status);
  const location = [contact.city, contact.country].filter(Boolean).join(", ");
  const allowedTransitions = VALID_TRANSITIONS[contact.warmth_status] || [];

  return (
    <div className="flex flex-1 flex-col pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 bg-bg/95 px-4 py-3 backdrop-blur-sm">
        <button
          onClick={() => navigate("/people")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-neutral-400"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="flex-1 truncate text-lg font-semibold text-white">
          {contact.full_name}
        </h1>
      </div>

      <div className="flex flex-col gap-4 px-4">
        {/* Profile header */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white"
            style={{ backgroundColor: warmthColor }}
          >
            {getInitials(contact.full_name)}
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold text-white">{contact.full_name}</h2>
            {contact.occupation && (
              <p className="text-sm text-neutral-400">
                {contact.occupation}
                {contact.company ? ` \u00B7 ${contact.company}` : ""}
              </p>
            )}
          </div>
          {/* Status badge + warmth score bar */}
          <div className="flex w-full max-w-xs flex-col items-center gap-2">
            <span
              className="rounded-full px-3 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: warmthColor }}
            >
              {WARMTH_LABELS[contact.warmth_status] || contact.warmth_status}
            </span>
            <div className="flex w-full items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-700">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${contact.warmth_score}%`,
                    backgroundColor: warmthColor,
                  }}
                />
              </div>
              <span className="text-xs tabular-nums text-neutral-400">
                {Math.round(contact.warmth_score)}
              </span>
            </div>
          </div>
        </div>

        {/* Memory summary */}
        {contact.memory_summary && (
          <div className="rounded-2xl border border-accent/30 bg-accent/10 p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
              AI-резюме
            </p>
            <p className="text-sm leading-relaxed text-neutral-200">
              {contact.memory_summary}
            </p>
          </div>
        )}

        {/* Details */}
        <Section title="Детали">
          {contact.where_met && <Detail label="Где познакомились" value={contact.where_met} />}
          {contact.met_date && (
            <Detail label="Дата" value={new Date(contact.met_date).toLocaleDateString("ru")} />
          )}
          {location && <Detail label="Город" value={location} />}
          {contact.relationship_category && (
            <Detail label="Категория" value={contact.relationship_category} />
          )}
          {contact.key_interests.length > 0 && (
            <div className="pt-1">
              <p className="mb-1.5 text-xs text-neutral-500">Интересы</p>
              <div className="flex flex-wrap gap-1.5">
                {contact.key_interests.map((interest, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-neutral-700 px-2.5 py-1 text-xs text-neutral-300"
                  >
                    {interest}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* What impressed me */}
        {contact.what_impressed_me && (
          <Section title="Что зацепило">
            <p className="text-sm text-neutral-300">{contact.what_impressed_me}</p>
          </Section>
        )}

        {/* Potential */}
        {contact.potential_synergies && (
          <Section title="Потенциал">
            <p className="text-sm text-neutral-300">{contact.potential_synergies}</p>
          </Section>
        )}

        {/* Notes */}
        <Section title="Заметки">
          {contact.personality_notes && (
            <p className="mb-3 text-sm italic text-neutral-400">
              {contact.personality_notes}
            </p>
          )}
          <textarea
            value={personalNotes}
            onChange={(e) => setPersonalNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Личные заметки..."
            rows={3}
            className="w-full resize-none rounded-xl bg-neutral-800 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
          />
          {notesSaving && (
            <p className="mt-1 text-xs text-neutral-500">Сохранение...</p>
          )}
        </Section>

        {/* Follow-ups */}
        {contact.follow_ups.length > 0 && (
          <Section title="Следующие шаги">
            <div className="flex flex-col gap-2">
              {contact.follow_ups.map((fu) => (
                <div
                  key={fu.id}
                  className="flex items-start gap-2 rounded-xl bg-neutral-800 p-3"
                >
                  <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-200">{fu.suggested_action}</p>
                    <p className="text-xs text-neutral-500">
                      {new Date(fu.due_date).toLocaleDateString("ru")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Interactions */}
        {contact.interactions.length > 0 && (
          <Section title="История взаимодействий">
            <div className="flex flex-col gap-2">
              {contact.interactions.map((inter) => (
                <div key={inter.id} className="rounded-xl bg-neutral-800 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-accent">
                      {TYPE_LABELS[inter.type] || inter.type}
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      {timeAgo(inter.created_at)}
                    </span>
                  </div>
                  {(inter.ai_summary || inter.content) && (
                    <p className="mt-1 text-sm text-neutral-300">
                      {inter.ai_summary || inter.content}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Danger zone */}
        <Section title="Управление">
          <div className="flex flex-col gap-2">
            {contact.warmth_status !== "archived" ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full rounded-xl bg-neutral-800 py-3 text-sm text-red-400 active:bg-neutral-700"
              >
                Архивировать контакт
              </button>
            ) : (
              <button
                onClick={() => setShowHardDelete(true)}
                className="w-full rounded-xl bg-red-900/30 py-3 text-sm text-red-400 active:bg-red-900/50"
              >
                Удалить навсегда
              </button>
            )}
          </div>
        </Section>
      </div>

      {/* Floating actions */}
      <div className="fixed bottom-[76px] left-1/2 z-30 flex w-full max-w-[430px] -translate-x-1/2 gap-2 px-4 py-3">
        <button
          onClick={() => setShowRecorder(true)}
          className="flex-1 rounded-xl bg-accent py-3 text-center text-sm font-medium text-white active:bg-accent-hover"
        >
          Голосовое
        </button>
        <button
          onClick={() => setShowNoteInput(true)}
          className="rounded-xl bg-card px-3 py-3 text-sm font-medium text-neutral-300 ring-1 ring-neutral-700 active:bg-neutral-800"
        >
          Заметка
        </button>
        <button
          onClick={addMeeting}
          className="rounded-xl bg-card px-3 py-3 text-sm font-medium text-neutral-300 ring-1 ring-neutral-700 active:bg-neutral-800"
        >
          Встреча
        </button>
        <button
          onClick={() => setShowStatusSheet(true)}
          className="rounded-xl bg-card px-3 py-3 text-sm font-medium text-neutral-300 ring-1 ring-neutral-700 active:bg-neutral-800"
        >
          Статус
        </button>
      </div>

      {/* Status bottom sheet */}
      {showStatusSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setShowStatusSheet(false)}>
          <div
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />
            <h3 className="mb-4 text-lg font-semibold text-white">Изменить статус</h3>
            <div className="flex flex-col gap-2">
              {allowedTransitions.map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus(s)}
                  className="flex items-center gap-3 rounded-xl bg-neutral-800 px-4 py-3 text-left text-sm text-neutral-200 active:bg-neutral-700"
                >
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: getWarmthColor(s) }}
                  />
                  {WARMTH_LABELS[s] || s}
                </button>
              ))}
              {allowedTransitions.length === 0 && (
                <p className="text-center text-sm text-neutral-500">
                  Нет доступных переходов
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add note bottom sheet */}
      {showNoteInput && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setShowNoteInput(false)}>
          <div
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />
            <h3 className="mb-4 text-lg font-semibold text-white">Добавить заметку</h3>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Что произошло?"
              rows={4}
              autoFocus
              className="mb-3 w-full resize-none rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
            />
            <button
              onClick={addNote}
              disabled={!noteText.trim()}
              className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white active:bg-accent-hover disabled:opacity-50"
            >
              Сохранить
            </button>
          </div>
        </div>
      )}

      {/* Archive confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDeleteConfirm(false)}>
          <div
            className="animate-fade-in mx-6 w-full max-w-sm rounded-2xl bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-semibold text-white">
              Архивировать контакт?
            </h3>
            <p className="mb-5 text-sm text-neutral-400">
              Контакт будет перемещён в архив. Вы сможете восстановить его позже.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-xl bg-neutral-700 py-3 text-sm font-medium text-white active:bg-neutral-600"
              >
                Отмена
              </button>
              <button
                onClick={archiveContact}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-medium text-white active:bg-red-700"
              >
                Архивировать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hard delete confirmation */}
      {showHardDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowHardDelete(false)}>
          <div
            className="animate-fade-in mx-6 w-full max-w-sm rounded-2xl bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-semibold text-red-400">
              Удалить навсегда?
            </h3>
            <p className="mb-5 text-sm text-neutral-400">
              Контакт, все записи и взаимодействия будут удалены безвозвратно. Это действие нельзя отменить.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowHardDelete(false)}
                className="flex-1 rounded-xl bg-neutral-700 py-3 text-sm font-medium text-white active:bg-neutral-600"
              >
                Отмена
              </button>
              <button
                onClick={hardDelete}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-medium text-white active:bg-red-700"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecorder && (
        <VoiceRecorder
          contactId={contact.id}
          onClose={() => {
            setShowRecorder(false);
            fetchContact();
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-sm text-neutral-200">{value}</p>
    </div>
  );
}
