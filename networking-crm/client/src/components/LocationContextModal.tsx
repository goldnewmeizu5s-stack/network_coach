import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type State =
  | "idle"
  | "recording"
  | "uploading"
  | "processing"
  | "generating"
  | "done"
  | "error";

const QUICK_PRESETS: { icon: string; label: string; prompt: string }[] = [
  { icon: "\u{1F97E}", label: "Хайкинг", prompt: "Я сейчас на хайкинге." },
  { icon: "\u{1F37A}", label: "Бар", prompt: "Я сейчас в баре." },
  { icon: "\u{2615}", label: "Кафе", prompt: "Я сейчас в кафе." },
  { icon: "\u{1F333}", label: "Парк", prompt: "Я сейчас в парке." },
  { icon: "\u{1F3D6}\uFE0F", label: "Пляж", prompt: "Я сейчас на пляже." },
  { icon: "\u{1F3CB}\uFE0F", label: "Зал", prompt: "Я сейчас в спортзале." },
  { icon: "\u{2708}\uFE0F", label: "Аэропорт", prompt: "Я сейчас в аэропорту." },
  { icon: "\u{1F3A4}", label: "Концерт", prompt: "Я сейчас на концерте." },
  { icon: "\u{1F4BB}", label: "Коворкинг", prompt: "Я сейчас в коворкинге." },
  { icon: "\u{1F6D2}", label: "Магазин", prompt: "Я сейчас в магазине." },
  { icon: "\u{1F3DF}\uFE0F", label: "Стадион", prompt: "Я сейчас на стадионе." },
  { icon: "\u{1F9D8}", label: "Йога", prompt: "Я сейчас на йоге." },
];

const POLL_INTERVAL = 2000;
const POLL_MAX = 45;

interface Props {
  onClose: () => void;
  onDone: () => void; // Parent refetches today
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function LocationContextModal({ onClose, onDone }: Props) {
  const [state, setState] = useState<State>("idle");
  const [text, setText] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortedRef = useRef(false);

  const cleanup = useCallback(() => {
    abortedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollRef.current) clearTimeout(pollRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const togglePreset = (prompt: string) => {
    if (activePreset === prompt) {
      setActivePreset(null);
      return;
    }
    setActivePreset(prompt);
    if (!text.trim()) setText(prompt);
    else if (!text.includes(prompt)) setText((t) => `${t} ${prompt}`.trim());
  };

  const submitText = async () => {
    const finalText = (text || activePreset || "").trim();
    if (!finalText) {
      setError("Опиши где ты — голосом, текстом или кнопкой");
      return;
    }
    setError(null);
    setState("generating");
    try {
      await api.post("/challenges/by-location", { context: finalText });
      setState("done");
      onDone();
      setTimeout(() => onClose(), 700);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      setError(msg);
      setState("idle");
    }
  };

  const pollStatus = useCallback(
    (interactionId: string, attempt: number) => {
      if (abortedRef.current) return;
      if (attempt >= POLL_MAX) {
        setError("Долгая обработка. Попробуйте ещё раз.");
        setState("error");
        return;
      }
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = setTimeout(async () => {
        if (abortedRef.current) return;
        try {
          const data = await api.get<{
            status: string;
            mode?: string;
            transcript?: string | null;
            challenge_ids?: string[];
          }>(`/voice/${interactionId}/status`);

          if (abortedRef.current) return;

          if (
            data.status === "completed" &&
            data.mode === "location_context" &&
            data.challenge_ids &&
            data.challenge_ids.length > 0
          ) {
            setState("done");
            onDone();
            setTimeout(() => onClose(), 700);
            return;
          }
          if (data.status === "failed") {
            setError("Не удалось обработать запись");
            setState("error");
            return;
          }
          pollStatus(interactionId, attempt + 1);
        } catch {
          if (abortedRef.current) return;
          setError("Ошибка проверки статуса");
          setState("error");
        }
      }, POLL_INTERVAL);
    },
    [onClose, onDone]
  );

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorder.current = recorder;
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        if (timerRef.current) clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const blob = new Blob(chunks.current, { type: mimeType });
        const fd = new FormData();
        fd.append("audio", blob, "location.webm");
        fd.append("duration_seconds", String(seconds));
        fd.append("mode", "location_context");

        setState("uploading");
        try {
          const result = await api.upload<{ id: string }>("/voice/upload", fd);
          setState("processing");
          pollStatus(result.id, 0);
        } catch {
          setError("Ошибка загрузки");
          setState("error");
        }
      };

      recorder.start(1000);
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((prev) => {
          if (prev + 1 >= 120) {
            recorder.stop();
            return prev + 1;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      setError("Нет доступа к микрофону");
    }
  };

  const stopRecording = () => mediaRecorder.current?.stop();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={() => onClose()}
    >
      <div
        className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6"
        style={{ maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />

        <h3 className="mb-1 text-lg font-semibold text-white">
          {"\u{1F4CD}"} Где ты сейчас?
        </h3>
        <p className="mb-4 text-xs text-neutral-400">
          Опиши место и контекст — получишь челленджи под реальную локацию.
        </p>

        {error && (
          <div className="mb-3 rounded-xl bg-red-900/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {state === "idle" && (
          <>
            {/* Quick presets */}
            <div className="mb-3 flex flex-wrap gap-2">
              {QUICK_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => togglePreset(p.prompt)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    activePreset === p.prompt
                      ? "bg-accent text-white"
                      : "bg-neutral-800 text-neutral-300 active:bg-neutral-700"
                  }`}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>

            {/* Free text */}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="...или опиши подробнее — где, с кем, что делаешь"
              rows={3}
              className="mb-3 w-full resize-none rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
            />

            <div className="flex gap-2">
              <button
                onClick={startRecording}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-neutral-700 py-3 text-sm font-medium text-white transition-colors active:bg-neutral-600"
              >
                <svg
                  className="h-4 w-4"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2z" />
                </svg>
                Голосом
              </button>
              <button
                onClick={submitText}
                className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-white transition-colors active:bg-accent-hover"
              >
                Сгенерировать
              </button>
            </div>
          </>
        )}

        {state === "recording" && (
          <div className="flex flex-col items-center gap-5 py-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-rec">
              <button
                onClick={stopRecording}
                aria-label="Остановить"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-rec"
              >
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            </div>
            <p className="text-xl font-mono tabular-nums text-white">
              {formatTime(seconds)}
            </p>
            <p className="text-xs text-neutral-400">
              Говори где ты и с деталями
            </p>
          </div>
        )}

        {(state === "uploading" ||
          state === "processing" ||
          state === "generating") && (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
            <p className="text-sm text-neutral-400">
              {state === "uploading" && "Загружаю запись..."}
              {state === "processing" && "Транскрибирую..."}
              {state === "generating" && "Подбираю челленджи под место..."}
            </p>
          </div>
        )}

        {state === "done" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600/20">
              <svg
                className="h-7 w-7 text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-sm text-white">Челленджи под локацию готовы</p>
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-3 py-4">
            <p className="text-center text-sm text-red-300">{error}</p>
            <button
              onClick={() => {
                setError(null);
                setState("idle");
              }}
              className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white active:bg-accent-hover"
            >
              Попробовать снова
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
