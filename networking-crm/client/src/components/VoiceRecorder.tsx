import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "../lib/api";

type State = "idle" | "recording" | "preview" | "uploading" | "processing" | "done" | "error";

const MAX_DURATION = 10 * 60;
const POLL_INTERVAL = 2000;
const POLL_MAX = 30;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

interface Props {
  onClose: (contactId?: string) => void;
  contactId?: string;
}

export default function VoiceRecorder({ onClose, contactId }: Props) {
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState("");
  const [resultContactId, setResultContactId] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | undefined>(undefined);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cleanup = useCallback(() => {
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
        setAudioUrl(URL.createObjectURL(blob));
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
    setAudioUrl(null);
    setSeconds(0);
    setAudioLevel(0);
    setState("idle");
  };

  const pollStatus = useCallback(
    (interactionId: string, attempt: number) => {
      if (attempt >= POLL_MAX) {
        setDoneMessage("Обработка занимает больше времени. Проверьте позже.");
        setState("done");
        return;
      }

      pollRef.current = setTimeout(async () => {
        try {
          const data = await api.get<{
            status: string;
            contact_id?: string | null;
          }>(`/voice/${interactionId}/status`);

          if (data.status === "completed") {
            if (data.contact_id) {
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
          setError("Ошибка проверки статуса");
          setState("error");
        }
      }, POLL_INTERVAL);
    },
    []
  );

  const upload = async () => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => onClose()}>
      <div
        className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6"
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
            <button
              onClick={startRecording}
              aria-label="Начать запись"
              className="flex h-24 w-24 items-center justify-center rounded-full bg-rec text-white transition-transform active:scale-95"
            >
              <svg className="h-10 w-10" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2z" />
              </svg>
            </button>
            <p className="text-neutral-400">Нажмите для записи</p>
          </div>
        )}

        {/* RECORDING */}
        {state === "recording" && (
          <div className="animate-fade-in flex flex-col items-center gap-6">
            <div className="relative flex items-center justify-center">
              <div
                className="animate-pulse-rec absolute h-28 w-28 rounded-full bg-rec/20"
                style={{ transform: `scale(${circleScale})` }}
              />
              <button
                onClick={stopRecording}
                aria-label="Остановить запись"
                className="relative z-10 flex h-24 w-24 items-center justify-center rounded-full bg-rec text-white"
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
              Транскрипция и анализ контакта
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

        {/* DONE */}
        {state === "done" && (
          <div className="animate-fade-in flex flex-col items-center gap-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600/20">
              <svg className="h-8 w-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-center text-white">{doneMessage}</p>
            {resultContactId ? (
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
