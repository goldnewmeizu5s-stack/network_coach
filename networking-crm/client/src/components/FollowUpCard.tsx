import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { getWarmthColor, getInitials } from "../lib/warmth";
import { FollowUpItem, getDueDateInfo, SNOOZE_OPTIONS } from "../lib/followups";
import { events, EVENTS } from "../lib/events";
import { useToast } from "./Toast";

interface Props {
  item: FollowUpItem;
  onRemoved: (id: string) => void;
  compact?: boolean;
}

export default function FollowUpCard({ item, onRemoved, compact }: Props) {
  const navigate = useNavigate();
  const { show } = useToast();
  const [removing, setRemoving] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);

  const dateInfo = getDueDateInfo(item.due_date);

  const handleDone = async () => {
    setRemoving(true);
    try {
      await api.put(`/followups/${item.id}`, { status: "done" });
      setTimeout(() => onRemoved(item.id), 300);
      show("Follow-up отмечен! \u{1F4AA}");
      events.emit(EVENTS.FOLLOWUP_CHANGED);
    } catch {
      setRemoving(false);
    }
  };

  const handleSnooze = async (days: number) => {
    setRemoving(true);
    const date = new Date();
    date.setDate(date.getDate() + days);
    try {
      await api.put(`/followups/${item.id}`, {
        status: "snoozed",
        snoozed_until: date.toISOString(),
      });
      setTimeout(() => onRemoved(item.id), 300);
      show(`Отложено до ${date.toLocaleDateString("ru")}`);
    } catch {
      setRemoving(false);
    }
    setShowSnooze(false);
  };

  const handleSkip = async () => {
    setRemoving(true);
    try {
      await api.put(`/followups/${item.id}`, { status: "skipped" });
      setTimeout(() => onRemoved(item.id), 300);
      show("Пропущено");
    } catch {
      setRemoving(false);
    }
  };

  const handleDraft = async () => {
    setDrafting(true);
    try {
      const data = await api.post<{ messages: string[] }>(
        `/followups/${item.id}/draft`
      );
      setDrafts(data.messages);
      setShowDraft(true);
    } catch {
      show("Ошибка генерации сообщения");
    } finally {
      setDrafting(false);
    }
  };

  const [imgFailed, setImgFailed] = useState(false);

  // Reset imgFailed when photo URL changes so updated photos display correctly
  useEffect(() => {
    setImgFailed(false);
  }, [item.contact.photo_url]);

  const lastCopied = { current: "" };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      lastCopied.current = text;
      show("Скопировано!");
    } catch {
      show("Не удалось скопировать");
    }
  };

  const handleDoneAfterDraft = async () => {
    // Log the copied message as an interaction
    if (lastCopied.current) {
      try {
        await api.post(`/contacts/${item.contact_id}/interaction`, {
          type: "message",
          content: lastCopied.current,
        });
      } catch {
        // ignore
      }
    }
    setShowDraft(false);
    handleDone();
  };

  return (
    <>
      <div
        className={`rounded-2xl bg-card border border-white/[0.04] p-3.5 transition-all duration-300 ${
          removing ? "max-h-0 scale-95 opacity-0" : "max-h-96 opacity-100"
        }`}
      >
        {/* Top row: avatar + contact name + due date */}
        <div
          className="flex items-center gap-3 mb-2.5 cursor-pointer"
          onClick={() => navigate(`/people/${item.contact_id}`)}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white overflow-hidden"
            style={{
              backgroundColor: getWarmthColor(item.contact.warmth_status) + "33",
              color: getWarmthColor(item.contact.warmth_status),
              boxShadow: `0 0 0 2px ${getWarmthColor(item.contact.warmth_status)}, 0 0 10px ${getWarmthColor(item.contact.warmth_status)}20`,
            }}
          >
            {item.contact.photo_url && !imgFailed ? (
              <img
                src={item.contact.photo_url}
                alt={item.contact.full_name}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                onError={() => setImgFailed(true)}
              />
            ) : (
              getInitials(item.contact.full_name)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-white leading-tight">
              {item.contact.full_name}
            </p>
          </div>
          <span
            className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold"
            style={{
              color: dateInfo.color,
              backgroundColor: dateInfo.color + "18",
            }}
          >
            {dateInfo.text}
          </span>
        </div>

        {/* Action text */}
        <p className={`text-sm text-neutral-300 leading-relaxed ${compact ? "line-clamp-2" : ""} mb-3`}>
          {item.suggested_action}
        </p>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleDone}
            disabled={removing}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-xl bg-green-600/20 text-green-400 active:bg-green-600/30 disabled:opacity-40"
            title="Done"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <div className="relative">
            <button
              onClick={() => setShowSnooze(!showSnooze)}
              disabled={removing}
              className="flex h-[44px] w-[44px] items-center justify-center rounded-xl bg-yellow-600/20 text-yellow-400 active:bg-yellow-600/30 disabled:opacity-40"
              title="Snooze"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showSnooze && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-44 rounded-xl bg-neutral-800 py-1 shadow-lg ring-1 ring-neutral-700">
                {SNOOZE_OPTIONS.map((o) => (
                  <button
                    key={o.days}
                    onClick={() => handleSnooze(o.days)}
                    className="w-full px-3 py-2 text-left text-sm text-neutral-300 active:bg-neutral-700"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleSkip}
            disabled={removing}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-xl bg-neutral-600/20 text-neutral-400 active:bg-neutral-600/30 disabled:opacity-40"
            title="Skip"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={handleDraft}
            disabled={drafting}
            className="flex h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent/20 text-sm text-accent active:bg-accent/30 disabled:opacity-50"
            title="Draft message"
          >
            {drafting ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span>Написать</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Draft bottom sheet */}
      {showDraft && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={() => setShowDraft(false)}
        >
          <div
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />
            <h3 className="mb-4 text-lg font-semibold text-white">
              Варианты сообщения
            </h3>
            <div className="flex flex-col gap-3">
              {drafts.map((msg, i) => (
                <div key={i} className="rounded-xl bg-neutral-800 p-3">
                  <p className="mb-2 text-sm text-neutral-200">{msg}</p>
                  <button
                    onClick={() => copyText(msg)}
                    className="text-xs font-medium text-accent active:text-accent-hover"
                  >
                    Копировать
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={handleDoneAfterDraft}
              className="mt-4 w-full rounded-xl bg-accent py-3 text-sm font-medium text-white active:bg-accent-hover"
            >
              Отметить follow-up как выполненный
            </button>
          </div>
        </div>
      )}
    </>
  );
}
