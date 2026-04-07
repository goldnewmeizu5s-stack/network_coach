import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import {
  getWarmthColor,
  getInitials,
  timeAgo,
  WARMTH_LABELS,
} from "../lib/warmth";
import { countryCodeToFlag, getCountryName } from "../lib/countries";
import { FollowUpItem } from "../lib/followups";
import VoiceRecorder from "../components/VoiceRecorder";
import FollowUpCard from "../components/FollowUpCard";
import { useToast } from "../components/Toast";
import { Skeleton } from "../components/Skeleton";

interface AISuggestion {
  action: string;
  reasoning: string;
  urgency: "low" | "medium" | "high";
  timeframe: string;
}

interface Interaction {
  id: string;
  type: string;
  content: string | null;
  transcript: string | null;
  ai_summary: string | null;
  created_at: string;
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
  met_country: string | null;
  origin_country: string | null;
  key_interests: string[];
  what_impressed_me: string | null;
  potential_synergies: string | null;
  personality_notes: string | null;
  memory_summary: string | null;
  memory_notes: string[];
  relationship_category: string | null;
  personal_notes: string | null;
  social_links: Record<string, string> | null;
  warmth_status: string;
  warmth_score: number;
  urgency_score: number;
  last_interaction_at: string | null;
  created_at: string;
  interactions: Interaction[];
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
  const { show } = useToast();
  const [contact, setContact] = useState<Contact | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRecorder, setShowRecorder] = useState(false);
  const [showStatusSheet, setShowStatusSheet] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [personalNotes, setPersonalNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showHardDelete, setShowHardDelete] = useState(false);
  const [showCreateFu, setShowCreateFu] = useState(false);
  const [fuText, setFuText] = useState("");
  const [fuDate, setFuDate] = useState("");
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [expandedSuggestion, setExpandedSuggestion] = useState<number | null>(null);
  const [showSocialLinks, setShowSocialLinks] = useState(false);
  const [slTelegram, setSlTelegram] = useState("");
  const [slLinkedin, setSlLinkedin] = useState("");
  const [slInstagram, setSlInstagram] = useState("");
  const [slSaving, setSlSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const resizeImage = (file: File, maxSize: number): Promise<Blob> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.85);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    });

  const uploadPhoto = async (file: File) => {
    if (!id) return;
    setPhotoUploading(true);
    try {
      // Resize to max 400px (avatars don't need more) to reduce upload size and lag
      const resized = await resizeImage(file, 400);
      const formData = new FormData();
      formData.append("photo", resized, file.name);
      const res = await fetch(`/api/contacts/${id}/photo`, {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      // Add cache-busting timestamp so browser fetches the new image
      const bustUrl = `${data.photo_url}?t=${Date.now()}`;
      setContact((prev) => prev ? { ...prev, photo_url: bustUrl } : prev);
      setImgFailed(false);
      show("Фото обновлено");
    } catch {
      show("Не удалось загрузить фото");
    } finally {
      setPhotoUploading(false);
    }
  };

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

  const fetchFollowUps = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<FollowUpItem[]>(
        `/followups?contact_id=${id}`
      );
      setFollowUps(data);
    } catch {
      // ignore
    }
  }, [id]);

  useEffect(() => {
    fetchContact();
    fetchFollowUps();
  }, [fetchContact, fetchFollowUps]);

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
    if (!id || !noteText.trim() || actionBusy) return;
    setActionBusy(true);
    try {
      await api.post(`/contacts/${id}/interaction`, {
        type: "note",
        content: noteText.trim(),
      });
      setNoteText("");
      setShowNoteInput(false);
      await fetchContact();
      show("Заметка добавлена");
    } catch {
      // ignore
    } finally {
      setActionBusy(false);
    }
  };

  const addMeeting = async () => {
    if (!id || actionBusy) return;
    setActionBusy(true);
    try {
      await api.post(`/contacts/${id}/interaction`, {
        type: "meeting",
        content: `Встреча ${new Date().toLocaleDateString("ru")}`,
      });
      await fetchContact();
      show("Встреча отмечена");
    } catch {
      // ignore
    } finally {
      setActionBusy(false);
    }
  };

  const createFollowUp = async () => {
    if (!id || !fuText.trim() || !fuDate) return;
    try {
      await api.post("/followups", {
        contact_id: id,
        suggested_action: fuText.trim(),
        due_date: fuDate,
      });
      setShowCreateFu(false);
      setFuText("");
      setFuDate("");
      await fetchFollowUps();
      show("Follow-up создан");
    } catch {
      // ignore
    }
  };

  const fetchSuggestions = async () => {
    if (!id) return;
    setSuggestionsLoading(true);
    try {
      const data = await api.post<{ suggestions: AISuggestion[] }>(
        `/contacts/${id}/suggest-actions`
      );
      setSuggestions(data.suggestions);
    } catch {
      // ignore
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const openSocialLinks = () => {
    const links = contact?.social_links || {};
    setSlTelegram(links.telegram || "");
    setSlLinkedin(links.linkedin || "");
    setSlInstagram(links.instagram || "");
    setShowSocialLinks(true);
  };

  const saveSocialLinks = async () => {
    if (!id) return;
    setSlSaving(true);
    try {
      const social_links: Record<string, string> = {};
      if (slTelegram.trim()) social_links.telegram = slTelegram.trim();
      if (slLinkedin.trim()) social_links.linkedin = slLinkedin.trim();
      if (slInstagram.trim()) social_links.instagram = slInstagram.trim();
      await api.put(`/contacts/${id}`, {
        social_links: Object.keys(social_links).length > 0 ? social_links : null,
      });
      setContact((prev) =>
        prev
          ? { ...prev, social_links: Object.keys(social_links).length > 0 ? social_links : null }
          : prev
      );
      setShowSocialLinks(false);
      show("Соцсети сохранены");
    } catch {
      // ignore
    } finally {
      setSlSaving(false);
    }
  };

  const createFuFromSuggestion = async (action: string) => {
    if (!id) return;
    const dueDate = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];
    try {
      await api.post("/followups", {
        contact_id: id,
        suggested_action: action,
        due_date: dueDate,
      });
      await fetchFollowUps();
      show("Follow-up создан из рекомендации");
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

  const handleFollowUpRemoved = (fuId: string) => {
    setFollowUps((prev) => prev.filter((f) => f.id !== fuId));
    // Refresh contact to get updated warmth
    fetchContact();
  };

  if (loading) {
    return (
      <div className="flex flex-1 flex-col pb-24">
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-bg/95 px-4 py-3 backdrop-blur-sm">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex flex-col items-center gap-3 px-4 pt-2">
          <Skeleton className="h-20 w-20 rounded-full" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex flex-col gap-4 px-4 pt-4">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
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
            className="relative flex h-20 w-20 cursor-pointer items-center justify-center rounded-full text-2xl font-bold text-white overflow-hidden"
            style={{ backgroundColor: warmthColor }}
            onClick={() => photoInputRef.current?.click()}
          >
            {contact.photo_url && !imgFailed ? (
              <img
                src={contact.photo_url}
                alt={contact.full_name}
                className="h-full w-full object-cover"
                decoding="async"
                onError={() => setImgFailed(true)}
              />
            ) : (
              getInitials(contact.full_name)
            )}
            {photoUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              </div>
            )}
            <div className="absolute -right-0.5 -top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-card text-sm shadow-lg ring-2 ring-bg">
              ✏️
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadPhoto(file);
                e.target.value = "";
              }}
            />
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

        {/* Memory notes — personal hooks */}
        {contact.memory_notes && contact.memory_notes.length > 0 && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-400">
              Запомни о нём
            </p>
            <ul className="flex flex-col gap-1.5">
              {contact.memory_notes.map((note, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-neutral-200"
                >
                  <span className="mt-0.5 text-amber-400">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Follow-ups */}
        <Section title="Следующие шаги">
          {followUps.length > 0 ? (
            <div className="flex flex-col gap-2">
              {followUps.map((fu) => (
                <FollowUpCard
                  key={fu.id}
                  item={fu}
                  onRemoved={handleFollowUpRemoved}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">
              Нет активных follow-ups
            </p>
          )}
          <button
            onClick={() => {
              setFuDate(
                new Date(Date.now() + 2 * 86400000)
                  .toISOString()
                  .split("T")[0]
              );
              setShowCreateFu(true);
            }}
            className="mt-3 w-full rounded-xl bg-neutral-800 py-2.5 text-sm text-neutral-300 active:bg-neutral-700"
          >
            + Создать follow-up
          </button>
        </Section>

        {/* AI Suggestions */}
        <Section title="AI рекомендации">
          {suggestions.length > 0 ? (
            <div className="flex flex-col gap-2">
              {suggestions.map((s, i) => {
                const urgencyIcon =
                  s.urgency === "high"
                    ? "\u{1F534}"
                    : s.urgency === "medium"
                      ? "\u{1F7E1}"
                      : "\u{1F7E2}";
                return (
                  <div key={i} className="rounded-xl bg-neutral-800 p-3">
                    <div
                      className="flex items-start gap-2 cursor-pointer"
                      onClick={() =>
                        setExpandedSuggestion(expandedSuggestion === i ? null : i)
                      }
                    >
                      <span className="mt-0.5 text-sm">{urgencyIcon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-neutral-200">{s.action}</p>
                        <p className="text-xs text-neutral-500">{s.timeframe}</p>
                      </div>
                    </div>
                    {expandedSuggestion === i && (
                      <div className="mt-2 animate-fade-in">
                        <p className="mb-2 text-xs italic text-neutral-400">
                          {s.reasoning}
                        </p>
                        <button
                          onClick={() => createFuFromSuggestion(s.action)}
                          className="text-xs font-medium text-accent active:text-accent-hover"
                        >
                          Создать follow-up из этого
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <button
              onClick={fetchSuggestions}
              disabled={suggestionsLoading}
              className="w-full rounded-xl bg-neutral-800 py-3 text-sm text-accent active:bg-neutral-700 disabled:opacity-50"
            >
              {suggestionsLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  Анализирую...
                </span>
              ) : (
                "Что делать дальше?"
              )}
            </button>
          )}
        </Section>

        {/* Details */}
        <Section title="Детали">
          {contact.where_met && <Detail label="Где познакомились" value={contact.where_met} />}
          {contact.met_date && (
            <Detail label="Дата" value={new Date(contact.met_date).toLocaleDateString("ru")} />
          )}
          {location && <Detail label="Город" value={location} />}
          {contact.met_country && (
            <Detail
              label="Где встретились"
              value={`${countryCodeToFlag(contact.met_country)} ${getCountryName(contact.met_country)}`}
            />
          )}
          {contact.origin_country && (
            <Detail
              label="Откуда родом"
              value={`${countryCodeToFlag(contact.origin_country)} ${getCountryName(contact.origin_country)}`}
            />
          )}
          {contact.social_links && Object.keys(contact.social_links).length > 0 && (
            <div className="mb-2">
              <p className="text-xs text-neutral-500">Соцсети</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {contact.social_links.telegram && (
                  <span className="rounded-full bg-neutral-700 px-2.5 py-1 text-xs text-neutral-300">
                    TG: {contact.social_links.telegram}
                  </span>
                )}
                {contact.social_links.linkedin && (
                  <span className="rounded-full bg-neutral-700 px-2.5 py-1 text-xs text-neutral-300">
                    LI: {contact.social_links.linkedin}
                  </span>
                )}
                {contact.social_links.instagram && (
                  <span className="rounded-full bg-neutral-700 px-2.5 py-1 text-xs text-neutral-300">
                    IG: {contact.social_links.instagram}
                  </span>
                )}
              </div>
            </div>
          )}
          <button
            onClick={openSocialLinks}
            className="mb-2 text-xs text-accent active:text-accent-hover"
          >
            {contact.social_links && Object.keys(contact.social_links).length > 0
              ? "Изменить соцсети"
              : "Добавить соцсети"}
          </button>
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

        {contact.what_impressed_me && (
          <Section title="Что зацепило">
            <p className="text-sm text-neutral-300">{contact.what_impressed_me}</p>
          </Section>
        )}

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
          disabled={actionBusy}
          className="rounded-xl bg-card px-3 py-3 text-sm font-medium text-neutral-300 ring-1 ring-neutral-700 active:bg-neutral-800 disabled:opacity-50"
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

      {/* Create follow-up bottom sheet */}
      {showCreateFu && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setShowCreateFu(false)}>
          <div
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />
            <h3 className="mb-4 text-lg font-semibold text-white">Новый follow-up</h3>
            <textarea
              value={fuText}
              onChange={(e) => setFuText(e.target.value)}
              placeholder="Что нужно сделать?"
              rows={3}
              autoFocus
              className="mb-3 w-full resize-none rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
            />
            <input
              type="date"
              value={fuDate}
              onChange={(e) => setFuDate(e.target.value)}
              className="mb-3 w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white outline-none ring-1 ring-neutral-700 focus:ring-accent"
            />
            <button
              onClick={createFollowUp}
              disabled={!fuText.trim() || !fuDate}
              className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white active:bg-accent-hover disabled:opacity-50"
            >
              Создать
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

      {/* Social links bottom sheet */}
      {showSocialLinks && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setShowSocialLinks(false)}>
          <div
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />
            <h3 className="mb-4 text-lg font-semibold text-white">Соцсети</h3>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Telegram (username)"
                value={slTelegram}
                onChange={(e) => setSlTelegram(e.target.value)}
                className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
              />
              <input
                type="text"
                placeholder="LinkedIn (URL или username)"
                value={slLinkedin}
                onChange={(e) => setSlLinkedin(e.target.value)}
                className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
              />
              <input
                type="text"
                placeholder="Instagram (username)"
                value={slInstagram}
                onChange={(e) => setSlInstagram(e.target.value)}
                className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
              />
              <button
                onClick={saveSocialLinks}
                disabled={slSaving}
                className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white active:bg-accent-hover disabled:opacity-50"
              >
                {slSaving ? "Сохранение..." : "Сохранить"}
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
