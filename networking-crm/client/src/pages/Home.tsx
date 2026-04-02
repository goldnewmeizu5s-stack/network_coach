import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import VoiceRecorder from "../components/VoiceRecorder";
import FollowUpCard from "../components/FollowUpCard";
import { api } from "../lib/api";
import { FollowUpItem } from "../lib/followups";

const INSIGHT_KEY = "daily_insight_cache";

function getCachedInsight(): { text: string; date: string } | null {
  try {
    const raw = sessionStorage.getItem(INSIGHT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.date === new Date().toDateString()) return data;
  } catch {
    // ignore
  }
  return null;
}

export default function Home() {
  const navigate = useNavigate();
  const [showRecorder, setShowRecorder] = useState(false);
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [loadingFu, setLoadingFu] = useState(true);
  const [insight, setInsight] = useState<string | null>(
    () => getCachedInsight()?.text ?? null
  );
  const [insightLoading, setInsightLoading] = useState(false);

  const fetchFollowUps = useCallback(async () => {
    setLoadingFu(true);
    try {
      const data = await api.get<FollowUpItem[]>("/followups?limit=3");
      setFollowUps(data);
    } catch {
      // ignore
    } finally {
      setLoadingFu(false);
    }
  }, []);

  const fetchInsight = useCallback(async () => {
    const cached = getCachedInsight();
    if (cached) {
      setInsight(cached.text);
      return;
    }
    setInsightLoading(true);
    try {
      const data = await api.post<{ insight: string }>("/insights/daily");
      setInsight(data.insight);
      sessionStorage.setItem(
        INSIGHT_KEY,
        JSON.stringify({ text: data.insight, date: new Date().toDateString() })
      );
    } catch {
      // ignore
    } finally {
      setInsightLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFollowUps();
    fetchInsight();
  }, [fetchFollowUps, fetchInsight]);

  const handleRecorderClose = useCallback(
    async (interactionId?: string) => {
      setShowRecorder(false);
      if (!interactionId) return;

      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const data = await api.get<{
            status: string;
            contact_id?: string | null;
          }>(`/voice/${interactionId}/status`);
          if (data.contact_id) {
            navigate(`/people/${data.contact_id}`);
            return;
          }
          if (data.status === "completed" || data.status === "failed") return;
        } catch {
          return;
        }
      }
    },
    [navigate]
  );

  const handleFollowUpRemoved = (id: string) => {
    setFollowUps((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 pt-6">
      <h1 className="text-2xl font-bold text-white">Networking CRM</h1>

      {/* Quick actions */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Быстрые действия
        </h2>
        <button
          onClick={() => setShowRecorder(true)}
          className="flex w-full items-center gap-4 rounded-2xl bg-card p-4 transition-colors active:bg-neutral-800"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rec/20">
            <svg className="h-6 w-6 text-rec" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2z" />
            </svg>
          </div>
          <div className="text-left">
            <p className="font-medium text-white">Записать голосовое</p>
            <p className="text-sm text-neutral-400">Расскажите о новом контакте</p>
          </div>
        </button>
      </section>

      {/* AI Insight */}
      <section className="rounded-2xl border border-accent/20 bg-accent/5 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
          AI-инсайт дня
        </h2>
        {insightLoading ? (
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <span className="text-sm text-neutral-400">Анализирую...</span>
          </div>
        ) : insight ? (
          <p className="text-sm leading-relaxed text-neutral-200">{insight}</p>
        ) : (
          <p className="text-neutral-400">Запишите первое голосовое — и AI начнёт давать советы</p>
        )}
      </section>

      {/* Today's challenge placeholder */}
      <section className="rounded-2xl bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Сегодняшний челлендж
        </h2>
        <p className="text-neutral-400">Скоро здесь появится ежедневный вызов</p>
      </section>

      {/* Urgent follow-ups */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Срочные follow-ups
          </h2>
          {followUps.length > 0 && (
            <button
              onClick={() => navigate("/followups")}
              className="text-xs text-accent active:text-accent-hover"
            >
              Все follow-ups &rarr;
            </button>
          )}
        </div>

        {loadingFu ? (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : followUps.length === 0 ? (
          <div className="rounded-2xl bg-card p-4 text-center">
            <span className="text-2xl">{"\u{1F389}"}</span>
            <p className="mt-1 text-sm text-neutral-400">
              Всё чисто! Нет активных задач
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {followUps.map((fu) => (
              <FollowUpCard
                key={fu.id}
                item={fu}
                onRemoved={handleFollowUpRemoved}
                compact
              />
            ))}
          </div>
        )}
      </section>

      {/* Stats placeholder */}
      <section className="rounded-2xl bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Статистика
        </h2>
        <p className="text-neutral-400">Данные пока не собраны</p>
      </section>

      {showRecorder && <VoiceRecorder onClose={handleRecorderClose} />}
    </div>
  );
}
