import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "../lib/api";

type State = "idle" | "recording" | "preview" | "uploading" | "processing" | "done" | "error";
type Mode = "default" | "batch_activity";

const MAX_DURATION = 10 * 60;
const POLL_INTERVAL = 2000;
const POLL_MAX = 60; // More attempts for batch — processing is longer

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

interface BatchSegment {
  contact_name: string;
  contact_id: string;
  is_new_contact: boolean;
  interaction_type: string;
  activity_summary: string;
  follow_ups_created: number;
  warmth_change: string;
}

interface BatchResult {
  segments: BatchSegment[];
  overall_summary: string;
  contacts_updated: number;
  contacts_created: number;
  follow_ups_created: number;
}

interface Props {
  onClose: (contactId?: string) => void;
  contactId?: string;
}

const INTERACTION_TYPE_LABELS: Record<string, string> = {
  meeting: "Встреча",
  message: "Сообщение",
  follow_up: "Фоллоу-ап",
  voice_note: "Голосовое",
  note: "Заметка",
};

const WARMTH_LABELS: Record<string, { text: string; color: string }> = {
  improved: { text: "↑", color: "text-green-400" },
  stable: { text: "→", color: "text-neutral-400" },
  declined: { text: "↓", color: "text-red-400" },
};

export default function VoiceRecorder({ onClose, contactId }: Props) {
  const [state, setState] = useState<State>("idle");
  const [mode, setMode] = useState<Mode>(contactId ? "default" : "batch_activity");
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState("");
  const [resultContactId, setResultContactId] = useState<string | null>(null);
  const [resultContactIds, setResultContactIds] = useState<string[]>([]);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | undefined>(undefined);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const audioUrlRef = useRef<string | null>(null);
  const abortedRef = useRef(false);

  const cleanup = useCallback(() => {
    abortedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (pollRef.current) clearTimeout(pollRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const updateLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    setAudioLevel(Math.min(rms * 4, 1));
    animFrameRef.current = requestAnimationFrame(updateLevel);
  }, []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorder.current = recorder;
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        setAudioUrl(url);
        setState("preview");
        if (timerRef.current) clearInterval(timerRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        analyserRef.current = null;
      };

      recorder.start(1000);
      setState("recording");
      setSeconds(0);

      timerRef.current = setInterval(() => {
        setSeconds((prev) => {
          if (prev + 1 >= MAX_DURATION) {
            recorder.stop();
            return prev + 1;
          }
          return prev + 1;
        });
      }, 1000);

      updateLevel();
    } catch {
      setError("Нет доступа к микрофону. Разрешите доступ в настройках браузера.");
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
  };

  const discard = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrlRef.current = null;
    setAudioUrl(null);
    setSeconds(0);
    setAudioLevel(0);
    setState("idle");
  };

  const pollStatus = useCallback(
    (interactionId: string, attempt: number) => {
      if (abortedRef.current) return;
      if (attempt >= POLL_MAX) {
        if (abortedRef.current) return;
        setDoneMessage("Обработка занимает больше времени. Проверьте позже.");
        setState("done");
        return;
      }

      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = setTimeout(async () => {
        if (abortedRef.current) return;
        try {
          const data = await api.get<{
            status: string;
            mode?: string;
            contact_id?: string | null;
            contact_ids?: string[];
            batch_result?: BatchResult;
          }>(`/voice/${interactionId}/status`);

          if (abortedRef.current) return;

          if (data.status === "completed") {
            // Batch activity mode
            if (data.mode === "batch_activity" && data.batch_result) {
              setBatchResult(data.batch_result);
              const ids = data.contact_ids || [];
              setResultContactIds(ids);
              if (ids.length > 0) setResultContactId(ids[0]);
              const { contacts_updated, contacts_created, follow_ups_created } = data.batch_result;
              const parts: string[] = [];
              if (contacts_updated > 0) parts.push(`${contacts_updated} обновлено`);
              if (contacts_created > 0) parts.push(`${contacts_created} создано`);
              if (follow_ups_created > 0) parts.push(`${follow_ups_created} фоллоу-апов`);
              setDoneMessage(parts.join(" · ") || "Обработано");
              setState("done");
              return;
            }

            // Default mode
            const ids = data.contact_ids || [];
            if (ids.length > 1) {
              setResultContactIds(ids);
              setResultContactId(ids[0]);
              setDoneMessage(`Создано ${ids.length} контактов!`);
            } else if (data.contact_id) {
              setResultContactId(data.contact_id);
              setDoneMessage("Контакт создан!");
            } else {
              setDoneMessage("Запись сохранена");
            }
            setState("done");
            return;
          }

          if (data.status === "failed") {
            setError("Не удалось обработать запись");
            setState("error");
            return;
          }

          // Still processing — poll again
          pollStatus(interactionId, attempt + 1);
        } catch {
          if (abortedRef.current) return;
          setError("Ошибка проверки статуса");
          setState("error");
        }
      }, POLL_INTERVAL);
    },
    []
  );

  const upload = async () => {
    if (state !== "preview") return;
    if (!chunks.current.length) return;
    setState("uploading");
    setError(null);
    try {
      const mimeType = mediaRecorder.current?.mimeType || "audio/webm";
      const blob = new Blob(chunks.current, { type: mimeType });
      const fd = new FormData();
      fd.append("audio", blob, "voice.webm");
      fd.append("duration_seconds", String(seconds));
      if (contactId) fd.append("contact_id", contactId);
      if (mode === "batch_activity") fd.append("mode", "batch_activity");
      const result = await api.upload<{ id: string }>("/voice/upload", fd);

      // Switch to processing state + start polling
      setState("processing");
      pollStatus(result.id, 0);
    } catch {
      setError("Ошибка загрузки. Попробуйте ещё раз.");
      setState("preview");
    }
  };

  const retry = () => {
    setError(null);
    setState("preview");
  };

  const circleScale = 1 + audioLevel * 0.3;
  const isBatch = mode === "batch_activity";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => onClose()}>
      <div
        className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6"
        style={state === "done" && batchResult ? { maxHeight: "85vh", overflowY: "auto" } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-6 h-1 w-10 rounded-full bg-neutral-600" />

        {error && state !== "error" && (
          <div className="mb-4 rounded-xl bg-red-900/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* IDLE */}
        {state === "idle" && (
          <div className="animate-fade-in flex flex-col items-center gap-6">
            {/* Mode toggle — only show when no pre-set contactId */}
            {!contactId && (
              <div className="flex w-full rounded-xl bg-neutral-800 p-1">
                <button
                  onClick={() => setMode("default")}
                  className={`flex-1 rounded-lg py-2 text-xs font-medium transition-colors ${
                    mode === "default"
                      ? "bg-neutral-600 text-white"
                      : "text-neutral-400"
                  }`}
                >
                  Новый контакт
                </button>
                <button
                  onClick={() => setMode("batch_activity")}
                  className={`flex-1 rounded-lg py-2 text-xs font-medium transition-colors ${
                    mode === "batch_activity"
                      ? "bg-accent text-white"
                      : "text-neutral-400"
                  }`}
                >
                  Обзор активности
                </button>
              </div>
            )}

            <button
              onClick={startRecording}
              aria-label="Начать запись"
              className={`flex h-24 w-24 items-center justify-center rounded-full text-white transition-transform active:scale-95 ${
                isBatch ? "bg-accent" : "bg-rec"
              }`}
            >
              <svg className="h-10 w-10" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2z" />
              </svg>
            </button>
            <p className="text-center text-neutral-400">
              {isBatch
                ? "Расскажите обо всех контактах за неделю"
                : "Нажмите для записи"}
            </p>
            {isBatch && (
              <p className="text-center text-xs text-neutral-500 -mt-3">
                До 10 минут — система разберёт по контактам
              </p>
            )}
          </div>
        )}

        {/* RECORDING */}
        {state === "recording" && (
          <div className="animate-fade-in flex flex-col items-center gap-6">
            {isBatch && (
              <div className="rounded-lg bg-accent/10 px-3 py-1.5 text-xs text-accent">
                Обзор активности
              </div>
            )}
            <div className="relative flex items-center justify-center">
              <div
                className={`animate-pulse-rec absolute h-28 w-28 rounded-full ${
                  isBatch ? "bg-accent/20" : "bg-rec/20"
                }`}
                style={{ transform: `scale(${circleScale})` }}
              />
              <button
                onClick={stopRecording}
                aria-label="Остановить запись"
                className={`relative z-10 flex h-24 w-24 items-center justify-center rounded-full text-white ${
                  isBatch ? "bg-accent" : "bg-rec"
                }`}
              >
                <svg className="h-8 w-8" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            </div>
            <p className="text-2xl font-mono tabular-nums text-white">
              {formatTime(seconds)}
            </p>
            <p className="text-sm text-neutral-400">Запись... Нажмите для остановки</p>
          </div>
        )}

        {/* PREVIEW */}
        {state === "preview" && audioUrl && (
          <div className="animate-fade-in flex flex-col items-center gap-5">
            {isBatch && (
              <div className="rounded-lg bg-accent/10 px-3 py-1.5 text-xs text-accent">
                Обзор активности
              </div>
            )}
            <p className="text-sm text-neutral-400">
              Длительность: {formatTime(seconds)}
            </p>
            <audio controls src={audioUrl} className="w-full" />
            <div className="flex w-full gap-3">
              <button
                onClick={discard}
                className="flex-1 rounded-xl bg-neutral-700 py-3 text-sm font-medium text-white transition-colors active:bg-neutral-600"
              >
                Удалить
              </button>
              <button
                onClick={upload}
                className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-white transition-colors active:bg-accent-hover"
              >
                Отправить
              </button>
            </div>
          </div>
        )}

        {/* UPLOADING */}
        {state === "uploading" && (
          <div className="animate-fade-in flex flex-col items-center gap-4 py-4">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
            <p className="text-neutral-400">Загрузка...</p>
          </div>
        )}

        {/* PROCESSING (server-side) */}
        {state === "processing" && (
          <div className="animate-fade-in flex flex-col items-center gap-4 py-4">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
            <p className="text-neutral-400">
              Обрабатываю запись
              <span className="inline-flex w-6">
                <span className="animate-pulse">...</span>
              </span>
            </p>
            <p className="text-xs text-neutral-500">
              {isBatch
                ? "Транскрипция, распознавание контактов и создание фоллоу-апов"
                : "Транскрипция и анализ контактов"}
            </p>
          </div>
        )}

        {/* ERROR (failed processing) */}
        {state === "error" && (
          <div className="animate-fade-in flex flex-col items-center gap-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600/20">
              <svg className="h-8 w-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-center text-sm text-red-300">
              {error || "Не удалось обработать запись"}
            </p>
            <button
              onClick={retry}
              className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white transition-colors active:bg-accent-hover"
            >
              Попробовать снова
            </button>
          </div>
        )}

        {/* DONE — Batch Activity Results */}
        {state === "done" && batchResult && (
          <div className="animate-fade-in flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-green-600/20">
                <svg className="h-6 w-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">{doneMessage}</p>
                <p className="text-xs text-neutral-400">{batchResult.overall_summary}</p>
              </div>
            </div>

            {/* Contact segments */}
            <div className="flex flex-col gap-2">
              {batchResult.segments.map((seg, i) => {
                const warmth = WARMTH_LABELS[seg.warmth_change] || WARMTH_LABELS.stable;
                const typeLabel = INTERACTION_TYPE_LABELS[seg.interaction_type] || seg.interaction_type;
                return (
                  <button
                    key={i}
                    onClick={() => onClose(seg.contact_id)}
                    className="flex flex-col gap-1.5 rounded-xl bg-neutral-800/60 px-4 py-3 text-left transition-colors active:bg-neutral-700/60"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">
                          {seg.contact_name}
                        </span>
                        {seg.is_new_contact && (
                          <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">
                            новый
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-neutral-500">
                          {typeLabel}
                        </span>
                        <span className={`text-sm ${warmth.color}`}>
                          {warmth.text}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-neutral-400 line-clamp-2">
                      {seg.activity_summary}
                    </p>
                    {seg.follow_ups_created > 0 && (
                      <p className="text-[10px] text-neutral-500">
                        +{seg.follow_ups_created} фоллоу-ап{seg.follow_ups_created === 1 ? "" : seg.follow_ups_created < 5 ? "а" : "ов"}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Close button */}
            <button
              onClick={() => onClose()}
              className="mt-1 w-full rounded-xl bg-neutral-700 py-3 text-sm font-medium text-white transition-colors active:bg-neutral-600"
            >
              Закрыть
            </button>
          </div>
        )}

        {/* DONE — Default mode (single/multi contact) */}
        {state === "done" && !batchResult && (
          <div className="animate-fade-in flex flex-col items-center gap-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600/20">
              <svg className="h-8 w-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-center text-white">{doneMessage}</p>
            {resultContactIds.length > 1 ? (
              <div className="flex w-full flex-col gap-2">
                <button
                  onClick={() => onClose(resultContactIds[0])}
                  className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white transition-colors active:bg-accent-hover"
                >
                  Посмотреть контакты
                </button>
                <button
                  onClick={() => onClose()}
                  className="w-full rounded-xl bg-neutral-700 py-3 text-sm font-medium text-white transition-colors active:bg-neutral-600"
                >
                  Закрыть
                </button>
              </div>
            ) : resultContactId ? (
              <button
                onClick={() => onClose(resultContactId)}
                className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white transition-colors active:bg-accent-hover"
              >
                Посмотреть контакт
              </button>
            ) : (
              <button
                onClick={() => onClose()}
                className="w-full rounded-xl bg-neutral-700 py-3 text-sm font-medium text-white transition-colors active:bg-neutral-600"
              >
                Закрыть
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
