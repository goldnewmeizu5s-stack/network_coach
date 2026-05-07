import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import {
  getWarmthColor,
  getInitials,
  timeAgo,
  WARMTH_LABELS,
} from "../lib/warmth";
import { countryCodeToFlag, getCountryName } from "../lib/countries";
import { FollowUpItem } from "../lib/followups";
import { Note, NotesListResponse, formatNoteDate } from "../lib/notes";
import VoiceRecorder from "../components/VoiceRecorder";
import WarmthBar from "../components/WarmthBar";
import FollowUpCard from "../components/FollowUpCard";
import { useToast } from "../components/Toast";
import { Skeleton } from "../components/Skeleton";

const fade = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
};

const CAT_LABELS: Record<string, string> = {
  business: "бизнес",
  friendship: "дружба",
  mentor: "ментор",
  connector: "коннектор",
  investor: "инвестор",
  creative: "креатив",
  other: "другое",
};

const SOCIAL_META: Record<
  string,
  { label: string; prefix: string; bg: string; text: string }
> = {
  telegram: {
    label: "TG",
    prefix: "@",
    bg: "bg-sky-500/10 border-sky-500/20",
    text: "text-sky-300",
  },
  linkedin: {
    label: "LI",
    prefix: "",
    bg: "bg-blue-500/10 border-blue-500/20",
    text: "text-blue-300",
  },
  instagram: {
    label: "IG",
    prefix: "@",
    bg: "bg-pink-500/10 border-pink-500/20",
    text: "text-pink-300",
  },
};

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

interface InterestGoal {
  id: string;
  contact_id: string;
  description: string;
  status: "open" | "satisfied" | "abandoned";
  source: string;
  created_at: string;
  satisfied_at: string | null;
  last_mentioned_at: string;
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
  interest_tier: "active" | "maintenance" | "dormant";
  interest_score: number;
  tier_locked: boolean;
  last_interaction_at: string | null;
  created_at: string;
  interactions: Interaction[];
  interest_goals: InterestGoal[];
}

const TIER_LABELS: Record<Contact["interest_tier"], string> = {
  active: "active · weekly",
  maintenance: "maintenance · monthly",
  dormant: "dormant · quarterly",
};

const TIER_BADGE: Record<Contact["interest_tier"], string> = {
  active: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  maintenance: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  dormant: "border-neutral-500/30 bg-neutral-500/10 text-neutral-300",
};

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
  const [relatedNotes, setRelatedNotes] = useState<Note[]>([]);
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

  // Reset imgFailed when photo URL changes so updated/re-fetched photos display correctly
  useEffect(() => {
    setImgFailed(false);
  }, [contact?.photo_url]);

  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

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
      // photo_url is now a data URL — no cache busting needed
      setContact((prev) => prev ? { ...prev, photo_url: data.photo_url } : prev);
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

  const fetchRelatedNotes = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<NotesListResponse>(
        `/notes?contact_id=${id}&limit=10`
      );
      setRelatedNotes(data.notes);
    } catch {
      // ignore
    }
  }, [id]);

  useEffect(() => {
    fetchContact();
    fetchFollowUps();
    fetchRelatedNotes();
  }, [fetchContact, fetchFollowUps, fetchRelatedNotes]);

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

  const startEditingName = () => {
    if (!contact) return;
    setEditName(contact.full_name);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const saveName = async () => {
    if (!id || !editName.trim()) {
      setEditingName(false);
      return;
    }
    if (editName.trim() === contact?.full_name) {
      setEditingName(false);
      return;
    }
    setNameSaving(true);
    try {
      await api.put(`/contacts/${id}`, { full_name: editName.trim() });
      setContact((prev) =>
        prev ? { ...prev, full_name: editName.trim() } : prev
      );
      show("Имя обновлено");
    } catch {
      show("Не удалось сохранить имя");
    } finally {
      setNameSaving(false);
      setEditingName(false);
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
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/5 bg-bg/85 px-4 py-3 backdrop-blur-md">
        <button
          onClick={() => navigate("/people")}
          aria-label="Назад"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-card text-neutral-400 transition-colors active:bg-card-hover"
        >
          <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="flex-1 truncate text-[16px] font-semibold text-white">
          {contact.full_name}
        </h1>
        <button
          onClick={startEditingName}
          aria-label="Редактировать имя"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-card text-neutral-400 transition-colors active:bg-card-hover"
          title="Редактировать имя"
        >
          <svg className="h-[16px] w-[16px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zM19.5 14.25v4.75A2.25 2.25 0 0117.25 21H5.25A2.25 2.25 0 013 18.75V6.75A2.25 2.25 0 015.25 4.5h4.75" />
          </svg>
        </button>
      </div>

      <motion.div
        className="flex flex-col gap-4 px-4 pt-4"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
      >
        {/* ── Profile Hero ── */}
        <motion.section
          className="relative overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-br from-card via-card to-[#141414] px-6 pb-6 pt-7"
          variants={fade}
        >
          {/* Ambient glows */}
          <div
            className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full blur-3xl"
            style={{ backgroundColor: warmthColor + "26" }}
          />
          <div
            className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full blur-3xl"
            style={{ backgroundColor: warmthColor + "12" }}
          />

          <div className="relative flex flex-col items-center">
            {/* Avatar */}
            <button
              onClick={() => photoInputRef.current?.click()}
              className="group relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full text-[26px] font-bold text-white transition-transform active:scale-95"
              style={{
                backgroundColor: warmthColor + "33",
                color: warmthColor,
                boxShadow: `0 0 0 3px ${warmthColor}, 0 0 24px ${warmthColor}33`,
              }}
              aria-label="Изменить фото"
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
              <span className="absolute inset-x-0 bottom-0 flex h-7 items-center justify-center bg-gradient-to-t from-black/70 to-transparent text-[11px] font-medium text-white opacity-0 transition-opacity group-active:opacity-100">
                Изменить
              </span>
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
            </button>

            {/* Name + occupation */}
            <div className="mt-4 text-center">
            {editingName ? (
              <div className="flex items-center justify-center gap-2">
                <input
                  ref={nameInputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="w-56 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center text-xl font-bold text-white outline-none focus:border-accent/50"
                  disabled={nameSaving}
                />
                <button
                  onClick={saveName}
                  disabled={nameSaving}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white active:bg-accent-hover disabled:opacity-50"
                >
                  {nameSaving ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    "✓"
                  )}
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/5 bg-card text-neutral-300 active:bg-card-hover"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={startEditingName}
                className="group inline-flex items-center gap-1.5 text-center"
                title="Редактировать имя"
              >
                <h2 className="text-[22px] font-bold leading-tight text-white">
                  {contact.full_name}
                </h2>
                <svg
                  className="h-3.5 w-3.5 text-neutral-600 opacity-0 transition-opacity group-hover:opacity-100"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
                  />
                </svg>
              </button>
            )}
            {(contact.occupation || contact.company) && (
              <p className="mt-1 text-[13px] text-neutral-400">
                {[contact.occupation, contact.company].filter(Boolean).join(" · ")}
              </p>
            )}
            {(contact.met_country || contact.origin_country) && (
              <div className="mt-2 inline-flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-neutral-500">
                {contact.met_country && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/5 bg-white/5 px-2 py-0.5">
                    <span className="text-sm leading-none">
                      {countryCodeToFlag(contact.met_country)}
                    </span>
                    <span>встретились</span>
                  </span>
                )}
                {contact.origin_country &&
                  contact.origin_country !== contact.met_country && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/5 bg-white/5 px-2 py-0.5">
                      <span className="text-sm leading-none">
                        {countryCodeToFlag(contact.origin_country)}
                      </span>
                      <span>родом</span>
                    </span>
                  )}
              </div>
            )}
          </div>

          {/* Warmth bar */}
          <div className="mt-5 w-full">
            <WarmthBar
              score={contact.warmth_score}
              status={contact.warmth_status}
              size="md"
            />
          </div>

          {/* Last interaction */}
          {contact.last_interaction_at && (
            <p className="mt-3 text-[11px] text-neutral-500">
              Последний контакт: {timeAgo(contact.last_interaction_at)}
            </p>
          )}
        </div>
        </motion.section>

        {/* Memory summary */}
        {contact.memory_summary && (
          <motion.div
            variants={fade}
            className="relative overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent p-4"
          >
            <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent/10 blur-3xl" />
            <div className="relative flex items-start gap-2">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-[11px]">
                ✨
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-accent">
                  AI-резюме
                </p>
                <p className="text-sm leading-relaxed text-neutral-200">
                  {contact.memory_summary}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Memory notes — personal hooks */}
        {contact.memory_notes && contact.memory_notes.length > 0 && (
          <motion.div
            variants={fade}
            className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-4"
          >
            <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-amber-500/10 blur-3xl" />
            <div className="relative">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500/20 text-[11px]">
                  🔖
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400">
                  Запомни о нём
                </p>
              </div>
              <ul className="flex flex-col gap-1.5">
                {contact.memory_notes.map((note, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm leading-relaxed text-neutral-200"
                  >
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}

        {/* Follow-ups */}
        <motion.div variants={fade}>
          <Section title="Следующие шаги" icon="🎯">
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
              <p className="rounded-xl border border-dashed border-white/5 bg-white/[0.02] px-4 py-6 text-center text-sm text-neutral-500">
                Пока ничего не запланировано
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
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/5 py-2.5 text-sm font-medium text-accent transition-colors active:bg-white/10"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
              Создать follow-up
            </button>
          </Section>
        </motion.div>

        {/* Related Notes */}
        <motion.div variants={fade}>
          <Section title="Связанные заметки" icon="📝">
            {relatedNotes.length > 0 ? (
              <div className="flex flex-col gap-2">
                {relatedNotes.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => navigate(`/notes?id=${n.id}`)}
                    className="flex flex-col gap-1 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-left transition-colors active:bg-white/[0.06]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-white">
                        {n.title || "(без заголовка)"}
                      </span>
                      <span className="shrink-0 text-[10px] text-neutral-500">
                        {formatNoteDate(n.updated_at)}
                      </span>
                    </div>
                    <span className="line-clamp-2 text-xs leading-relaxed text-neutral-400">
                      {n.body.replace(/\s+/g, " ").slice(0, 160)}
                    </span>
                    {n.tags.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {n.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-500"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-white/5 bg-white/[0.02] px-4 py-5 text-center text-sm leading-relaxed text-neutral-500">
                Нет заметок. Напиши{" "}
                <code className="rounded bg-accent/10 px-1 py-0.5 text-accent">
                  [[{contact.full_name}]]
                </code>{" "}
                в любой заметке — и она появится здесь.
              </p>
            )}
            <button
              onClick={() => navigate("/notes")}
              className="mt-3 w-full rounded-xl border border-white/5 bg-white/5 py-2.5 text-sm font-medium text-neutral-300 transition-colors active:bg-white/10"
            >
              Все заметки
            </button>
          </Section>
        </motion.div>

        {/* AI Suggestions */}
        <motion.div variants={fade}>
          <Section title="AI рекомендации" icon="🤖">
            {suggestions.length > 0 ? (
              <div className="flex flex-col gap-2">
                {suggestions.map((s, i) => {
                  const urgencyIcon =
                    s.urgency === "high"
                      ? "\u{1F534}"
                      : s.urgency === "medium"
                        ? "\u{1F7E1}"
                        : "\u{1F7E2}";
                  const expanded = expandedSuggestion === i;
                  return (
                    <div
                      key={i}
                      className={`rounded-xl border border-white/5 bg-white/[0.03] p-3 transition-colors ${
                        expanded ? "bg-white/[0.06]" : ""
                      }`}
                    >
                      <div
                        className="flex cursor-pointer items-start gap-2"
                        onClick={() =>
                          setExpandedSuggestion(expanded ? null : i)
                        }
                      >
                        <span className="mt-0.5 text-sm">{urgencyIcon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-snug text-neutral-200">
                            {s.action}
                          </p>
                          <p className="mt-0.5 text-[11px] text-neutral-500">
                            {s.timeframe}
                          </p>
                        </div>
                        <svg
                          className={`h-4 w-4 shrink-0 text-neutral-500 transition-transform ${expanded ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                        </svg>
                      </div>
                      {expanded && (
                        <div className="animate-fade-in mt-3 border-t border-white/5 pt-3">
                          <p className="mb-2 text-xs italic leading-relaxed text-neutral-400">
                            {s.reasoning}
                          </p>
                          <button
                            onClick={() => createFuFromSuggestion(s.action)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent active:bg-accent/25"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                            </svg>
                            Создать follow-up
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
                className="relative w-full overflow-hidden rounded-xl border border-accent/25 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent py-3.5 text-sm font-semibold text-accent transition-all active:scale-[0.98] disabled:opacity-50"
              >
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-accent/10 to-transparent opacity-60" />
                {suggestionsLoading ? (
                  <span className="relative flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    Анализирую...
                  </span>
                ) : (
                  <span className="relative inline-flex items-center gap-1.5">
                    <span>✨</span>
                    <span>Что делать дальше?</span>
                  </span>
                )}
              </button>
            )}
          </Section>
        </motion.div>

        {/* Details */}
        <motion.div variants={fade}>
          <Section title="Детали" icon="📌">
            <div className="flex flex-col divide-y divide-white/5">
              {contact.where_met && (
                <DetailRow label="Где познакомились" value={contact.where_met} />
              )}
              {contact.met_date && (
                <DetailRow
                  label="Дата"
                  value={new Date(contact.met_date).toLocaleDateString("ru")}
                />
              )}
              {location && <DetailRow label="Город" value={location} />}
              {contact.met_country && (
                <DetailRow
                  label="Где встретились"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-base leading-none">
                        {countryCodeToFlag(contact.met_country)}
                      </span>
                      <span>{getCountryName(contact.met_country)}</span>
                    </span>
                  }
                />
              )}
              {contact.origin_country && (
                <DetailRow
                  label="Откуда родом"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-base leading-none">
                        {countryCodeToFlag(contact.origin_country)}
                      </span>
                      <span>{getCountryName(contact.origin_country)}</span>
                    </span>
                  }
                />
              )}
              {contact.relationship_category && (
                <DetailRow
                  label="Категория"
                  value={
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-neutral-200">
                      {CAT_LABELS[contact.relationship_category] ||
                        contact.relationship_category}
                    </span>
                  }
                />
              )}
            </div>

            {/* Social links */}
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-widest text-neutral-500">
                  Соцсети
                </p>
                <button
                  onClick={openSocialLinks}
                  className="text-[11px] font-medium text-accent transition-colors active:text-accent-hover"
                >
                  {contact.social_links && Object.keys(contact.social_links).length > 0
                    ? "Изменить"
                    : "+ Добавить"}
                </button>
              </div>
              {contact.social_links && Object.keys(contact.social_links).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(SOCIAL_META) as (keyof typeof SOCIAL_META)[]).map(
                    (k) => {
                      const v = contact.social_links?.[k];
                      if (!v) return null;
                      const meta = SOCIAL_META[k];
                      return (
                        <span
                          key={k}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.bg} ${meta.text}`}
                        >
                          <span className="opacity-80">{meta.label}:</span>
                          <span>{meta.prefix}{v}</span>
                        </span>
                      );
                    }
                  )}
                </div>
              ) : (
                <p className="text-xs italic text-neutral-600">не указаны</p>
              )}
            </div>

            {/* Interests */}
            {contact.key_interests.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-neutral-500">
                  Интересы
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {contact.key_interests.map((interest, i) => (
                    <span
                      key={i}
                      className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-xs text-accent/90"
                    >
                      {interest}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Section>
        </motion.div>

        {/* Interest goals + tier */}
        <motion.div variants={fade}>
          <InterestSection
            contact={contact}
            onChanged={fetchContact}
          />
        </motion.div>

        {contact.what_impressed_me && (
          <motion.div variants={fade}>
            <Callout
              accent="emerald"
              title="Что зацепило"
              icon="💡"
              text={contact.what_impressed_me}
            />
          </motion.div>
        )}

        {contact.potential_synergies && (
          <motion.div variants={fade}>
            <Callout
              accent="purple"
              title="Потенциал"
              icon="🚀"
              text={contact.potential_synergies}
            />
          </motion.div>
        )}

        {/* Notes */}
        <motion.div variants={fade}>
          <Section title="Заметки" icon="✍️">
            {contact.personality_notes && (
              <div className="mb-3 rounded-xl border-l-2 border-accent/40 bg-white/[0.03] px-3 py-2 text-sm italic leading-relaxed text-neutral-300">
                {contact.personality_notes}
              </div>
            )}
            <textarea
              value={personalNotes}
              onChange={(e) => setPersonalNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Личные заметки..."
              rows={3}
              className="w-full resize-none rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-accent/40"
            />
            {notesSaving && (
              <p className="mt-1 text-xs text-neutral-500">Сохранение...</p>
            )}
          </Section>
        </motion.div>

        {/* Interactions */}
        {contact.interactions.length > 0 && (
          <motion.div variants={fade}>
            <Section title="История" icon="🕐">
              <div className="flex flex-col gap-2">
                {contact.interactions.map((inter) => (
                  <div
                    key={inter.id}
                    className="rounded-xl border border-white/5 bg-white/[0.03] p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        {TYPE_LABELS[inter.type] || inter.type}
                      </span>
                      <span className="text-[10px] text-neutral-500">
                        {timeAgo(inter.created_at)}
                      </span>
                    </div>
                    {(inter.ai_summary || inter.content) && (
                      <p className="mt-2 text-sm leading-relaxed text-neutral-300">
                        {inter.ai_summary || inter.content}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          </motion.div>
        )}

        {/* Danger zone */}
        <motion.div variants={fade}>
          <Section title="Управление" icon="⚙️">
            <div className="flex flex-col gap-2">
              {contact.warmth_status !== "archived" ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full rounded-xl border border-white/5 bg-white/[0.03] py-3 text-sm font-medium text-red-400 transition-colors active:bg-red-500/10"
                >
                  Архивировать контакт
                </button>
              ) : (
                <button
                  onClick={() => setShowHardDelete(true)}
                  className="w-full rounded-xl border border-red-500/20 bg-red-500/10 py-3 text-sm font-medium text-red-400 transition-colors active:bg-red-500/20"
                >
                  Удалить навсегда
                </button>
              )}
            </div>
          </Section>
        </motion.div>
      </motion.div>

      {/* Floating actions */}
      <div className="fixed bottom-[76px] left-1/2 z-30 flex w-full max-w-[430px] -translate-x-1/2 gap-2 px-4 py-3">
        <button
          onClick={() => setShowRecorder(true)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-accent to-[#4f46e5] py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition-transform active:scale-[0.97]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
          </svg>
          Голосовое
        </button>
        <button
          onClick={() => setShowNoteInput(true)}
          className="rounded-xl border border-white/5 bg-card px-3 py-3 text-sm font-medium text-neutral-300 transition-colors active:bg-card-hover"
        >
          Заметка
        </button>
        <button
          onClick={addMeeting}
          disabled={actionBusy}
          className="rounded-xl border border-white/5 bg-card px-3 py-3 text-sm font-medium text-neutral-300 transition-colors active:bg-card-hover disabled:opacity-50"
        >
          Встреча
        </button>
        <button
          onClick={() => setShowStatusSheet(true)}
          className="rounded-xl border border-white/5 bg-card px-3 py-3 text-sm font-medium text-neutral-300 transition-colors active:bg-card-hover"
        >
          Статус
        </button>
      </div>

      {/* Status bottom sheet */}
      {showStatusSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={() => setShowStatusSheet(false)}>
          <div
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl border-t border-white/5 bg-card px-6 pb-8 pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-neutral-700" />
            <h3 className="mb-4 text-lg font-semibold text-white">Изменить статус</h3>
            <div className="flex flex-col gap-2">
              {allowedTransitions.map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus(s)}
                  className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3 text-left text-sm text-neutral-200 transition-colors active:bg-white/[0.06]"
                >
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: getWarmthColor(s),
                      boxShadow: `0 0 8px ${getWarmthColor(s)}`,
                    }}
                  />
                  <span className="font-medium">{WARMTH_LABELS[s] || s}</span>
                </button>
              ))}
              {allowedTransitions.length === 0 && (
                <p className="py-4 text-center text-sm text-neutral-500">
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
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl border-t border-white/5 bg-card px-6 pb-8 pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-neutral-700" />
            <h3 className="mb-4 text-lg font-semibold text-white">Добавить заметку</h3>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Что произошло?"
              rows={4}
              autoFocus
              className="mb-3 w-full resize-none rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-accent/40"
            />
            <button
              onClick={addNote}
              disabled={!noteText.trim()}
              className="w-full rounded-xl bg-gradient-to-br from-accent to-[#4f46e5] py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
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
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl border-t border-white/5 bg-card px-6 pb-8 pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-neutral-700" />
            <h3 className="mb-4 text-lg font-semibold text-white">Новый follow-up</h3>
            <textarea
              value={fuText}
              onChange={(e) => setFuText(e.target.value)}
              placeholder="Что нужно сделать?"
              rows={3}
              autoFocus
              className="mb-3 w-full resize-none rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-accent/40"
            />
            <input
              type="date"
              value={fuDate}
              onChange={(e) => setFuDate(e.target.value)}
              className="mb-3 w-full rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent/40"
            />
            <button
              onClick={createFollowUp}
              disabled={!fuText.trim() || !fuDate}
              className="w-full rounded-xl bg-gradient-to-br from-accent to-[#4f46e5] py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
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
            className="animate-fade-in mx-6 w-full max-w-sm rounded-2xl border border-white/10 bg-card p-6 shadow-2xl"
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
                className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-medium text-white transition-colors active:bg-white/10"
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
            className="animate-fade-in mx-6 w-full max-w-sm rounded-2xl border border-white/10 bg-card p-6 shadow-2xl"
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
                className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-medium text-white transition-colors active:bg-white/10"
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
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl border-t border-white/5 bg-card px-6 pb-8 pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-neutral-700" />
            <h3 className="mb-4 text-lg font-semibold text-white">Соцсети</h3>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Telegram (username)"
                value={slTelegram}
                onChange={(e) => setSlTelegram(e.target.value)}
                className="w-full rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-accent/40"
              />
              <input
                type="text"
                placeholder="LinkedIn (URL или username)"
                value={slLinkedin}
                onChange={(e) => setSlLinkedin(e.target.value)}
                className="w-full rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-accent/40"
              />
              <input
                type="text"
                placeholder="Instagram (username)"
                value={slInstagram}
                onChange={(e) => setSlInstagram(e.target.value)}
                className="w-full rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-accent/40"
              />
              <button
                onClick={saveSocialLinks}
                disabled={slSaving}
                className="w-full rounded-xl bg-gradient-to-br from-accent to-[#4f46e5] py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
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
  icon,
  children,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/5 bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon && (
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/5 text-[11px] leading-none">
            {icon}
          </span>
        )}
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="truncate text-right text-sm text-neutral-200">
        {value}
      </span>
    </div>
  );
}

function Callout({
  accent,
  title,
  icon,
  text,
}: {
  accent: "emerald" | "purple";
  title: string;
  icon: string;
  text: string;
}) {
  const styles =
    accent === "emerald"
      ? {
          border: "border-emerald-500/25",
          bg: "from-emerald-500/10 via-emerald-500/5 to-transparent",
          glow: "bg-emerald-500/10",
          iconBg: "bg-emerald-500/20",
          label: "text-emerald-400",
        }
      : {
          border: "border-purple-500/25",
          bg: "from-purple-500/10 via-purple-500/5 to-transparent",
          glow: "bg-purple-500/10",
          iconBg: "bg-purple-500/20",
          label: "text-purple-300",
        };
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border ${styles.border} bg-gradient-to-br ${styles.bg} p-4`}
    >
      <div
        className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-3xl ${styles.glow}`}
      />
      <div className="relative flex items-start gap-2.5">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm ${styles.iconBg}`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`mb-1 text-[10px] font-semibold uppercase tracking-widest ${styles.label}`}
          >
            {title}
          </p>
          <p className="text-sm leading-relaxed text-neutral-200">{text}</p>
        </div>
      </div>
    </div>
  );
}

function InterestSection({
  contact,
  onChanged,
}: {
  contact: Contact;
  onChanged: () => Promise<void> | void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const tier = contact.interest_tier ?? "active";
  const score = Math.round(contact.interest_score ?? 50);

  const openGoals = (contact.interest_goals ?? []).filter(
    (g) => g.status === "open",
  );
  const closedGoals = (contact.interest_goals ?? []).filter(
    (g) => g.status !== "open",
  );

  const setTier = async (next: Contact["interest_tier"]) => {
    if (next === tier && contact.tier_locked) return;
    setBusy(true);
    try {
      await fetch(`/api/contacts/${contact.id}/interest-tier`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: next, lock: true }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    setBusy(true);
    try {
      await fetch(`/api/contacts/${contact.id}/interest-tier`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, lock: false }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const addGoal = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      await fetch(`/api/contacts/${contact.id}/goals`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text }),
      });
      setDraft("");
      setAdding(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const setGoalStatus = async (
    goalId: string,
    status: "satisfied" | "abandoned" | "open",
  ) => {
    setBusy(true);
    try {
      await fetch(`/api/goals/${goalId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Что я хочу от этого контакта" icon="🎯">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${TIER_BADGE[tier]}`}
        >
          {TIER_LABELS[tier]}
        </span>
        <span className="text-[11px] text-neutral-500">
          score {score}
          {contact.tier_locked ? " · locked" : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {(["active", "maintenance", "dormant"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              disabled={busy}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                t === tier
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-white/10 bg-white/[0.03] text-neutral-400 hover:border-white/20"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {contact.tier_locked && (
        <button
          type="button"
          onClick={unlock}
          className="mb-3 text-[11px] text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
        >
          Снять блокировку — пусть система сама управляет режимом
        </button>
      )}

      {openGoals.length === 0 && closedGoals.length === 0 && !adding && (
        <p className="mb-3 text-xs italic text-neutral-600">
          Целей пока нет. Они появляются автоматически из голосовых заметок («хочу
          узнать у него…», «обещал интро к…»), либо ты можешь добавить вручную.
        </p>
      )}

      {openGoals.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1.5">
          {openGoals.map((g) => (
            <li
              key={g.id}
              className="flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2"
            >
              <button
                type="button"
                onClick={() => setGoalStatus(g.id, "satisfied")}
                disabled={busy}
                title="Получил"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border border-neutral-500 hover:border-emerald-400"
              />
              <span className="flex-1 text-sm leading-snug text-neutral-200">
                {g.description}
              </span>
              <button
                type="button"
                onClick={() => setGoalStatus(g.id, "abandoned")}
                disabled={busy}
                title="Не актуально"
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {closedGoals.length > 0 && (
        <details className="mb-2">
          <summary className="cursor-pointer text-[11px] text-neutral-500">
            Закрытые цели ({closedGoals.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {closedGoals.map((g) => (
              <li
                key={g.id}
                className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-1.5 text-xs text-neutral-400"
              >
                <span className="line-through">{g.description}</span>
                <span className="ml-auto text-[10px] text-neutral-600">
                  {g.status === "satisfied" ? "получил" : "забыл"}
                </span>
                <button
                  type="button"
                  onClick={() => setGoalStatus(g.id, "open")}
                  disabled={busy}
                  className="text-[10px] text-neutral-500 hover:text-neutral-300"
                >
                  вернуть
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {adding ? (
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addGoal();
              if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            placeholder="что хочу узнать / получить..."
            autoFocus
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:border-accent/40"
          />
          <button
            type="button"
            onClick={addGoal}
            disabled={busy || !draft.trim()}
            className="rounded-xl bg-accent/20 px-3 py-2 text-sm text-accent disabled:opacity-50"
          >
            +
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-xs text-accent/80 hover:text-accent"
        >
          + добавить цель
        </button>
      )}
    </Section>
  );
}
