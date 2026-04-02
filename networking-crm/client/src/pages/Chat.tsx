import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";
import { useToast } from "../components/Toast";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

interface ContactOption {
  id: string;
  full_name: string;
}

const QUICK_PROMPTS = [
  "Что мне делать сегодня?",
  "С кем давно не общался?",
  "Дай мне совет по нетворкингу",
  "Подведи итоги недели",
];

export default function Chat() {
  const navigate = useNavigate();
  const { show } = useToast();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Context selector
  const [contactCtx, setContactCtx] = useState<ContactOption | null>(null);
  const [showCtxPicker, setShowCtxPicker] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);

  // Voice recording
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const streamRef = useRef<MediaStream | null>(null);

  // Contact names for linking
  const [contactNames, setContactNames] = useState<Map<string, string>>(
    new Map()
  );

  // Clear confirm
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }, []);

  // Load history
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await api.get<ChatMsg[]>("/chat/history");
      setMessages(data);
    } catch {
      /* ignore */
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Load contact names for highlighting
  const loadContactNames = useCallback(async () => {
    try {
      const data = await api.get<{
        contacts: { id: string; full_name: string }[];
      }>("/contacts?limit=100");
      const map = new Map<string, string>();
      for (const c of data.contacts) {
        map.set(c.full_name.toLowerCase(), c.id);
      }
      setContactNames(map);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadHistory().then(scrollToBottom);
    loadContactNames();
  }, [loadHistory, loadContactNames, scrollToBottom]);

  // Send text message
  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || sending) return;
    setInput("");

    // Optimistic add
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: "user",
        content: msg,
        created_at: new Date().toISOString(),
      },
    ]);
    scrollToBottom();
    setSending(true);

    try {
      const data = await api.post<{ response: string }>("/chat", {
        message: msg,
        contact_id: contactCtx?.id,
      });

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId),
        {
          id: `user-${Date.now()}`,
          role: "user",
          content: msg,
          created_at: new Date().toISOString(),
        },
        {
          id: `asst-${Date.now()}`,
          role: "assistant",
          content: data.response,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      show("Ошибка отправки сообщения");
    } finally {
      setSending(false);
      scrollToBottom();
    }
  };

  // Voice recording
  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        setRecording(false);

        const blob = new Blob(chunksRef.current, { type: mimeType });
        const fd = new FormData();
        fd.append("audio", blob, "voice.webm");
        if (contactCtx?.id) fd.append("contact_id", contactCtx.id);

        // Show typing indicator
        setSending(true);

        try {
          const data = await api.upload<{
            transcript: string;
            response: string;
          }>("/chat/voice", fd);

          setMessages((prev) => [
            ...prev,
            {
              id: `user-v-${Date.now()}`,
              role: "user",
              content: data.transcript,
              created_at: new Date().toISOString(),
            },
            {
              id: `asst-v-${Date.now()}`,
              role: "assistant",
              content: data.response,
              created_at: new Date().toISOString(),
            },
          ]);
        } catch {
          show("Ошибка обработки голосового сообщения");
        } finally {
          setSending(false);
          scrollToBottom();
        }
      };

      recorder.start(1000);
      setRecording(true);
      setRecSeconds(0);
      timerRef.current = setInterval(
        () => setRecSeconds((s) => s + 1),
        1000
      );
    } catch {
      show("Нет доступа к микрофону");
    }
  };

  const stopVoiceRecording = () => {
    mediaRecRef.current?.stop();
  };

  // Contact picker search
  const searchContacts = async (q: string) => {
    setContactSearch(q);
    if (q.length < 2) {
      setContactOptions([]);
      return;
    }
    try {
      const data = await api.get<{
        contacts: { id: string; full_name: string }[];
      }>(`/contacts?search=${encodeURIComponent(q)}&limit=10`);
      setContactOptions(
        data.contacts.map((c) => ({ id: c.id, full_name: c.full_name }))
      );
    } catch {
      /* ignore */
    }
  };

  // Clear history
  const clearHistory = async () => {
    try {
      await api.del("/chat/history");
      setMessages([]);
      setShowClearConfirm(false);
      show("История очищена");
    } catch {
      /* ignore */
    }
  };

  // Highlight contact names in AI text
  const processContent = (text: string, isAssistant: boolean): string => {
    if (!isAssistant) return escapeHtml(text);

    let html = renderMarkdown(text);

    // Highlight known contact names
    contactNames.forEach((contactId, nameLower) => {
      const regex = new RegExp(
        `\\b(${escapeRegex(nameLower)})\\b`,
        "gi"
      );
      html = html.replace(
        regex,
        `<a class="text-accent cursor-pointer underline decoration-accent/30" data-contact-id="${contactId}">$1</a>`
      );
    });

    return html;
  };

  // Handle clicks on contact links in messages
  const handleMsgClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const contactId = target.getAttribute("data-contact-id");
    if (contactId) {
      navigate(`/people/${contactId}`);
    }
  };

  // Textarea auto-resize
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 100) + "px";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold text-white">AI Advisor</h1>
        <button
          onClick={() => setShowClearConfirm(true)}
          className="text-xs text-neutral-500 active:text-red-400"
        >
          Очистить
        </button>
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-2"
        onClick={handleMsgClick}
      >
        {loadingHistory ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <div className="text-center">
              <p className="text-4xl mb-3">{"\u{1F916}"}</p>
              <p className="text-sm text-neutral-400">
                Привет! Я твой AI-советник по нетворкингу.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="rounded-xl bg-card px-3 py-2.5 text-left text-xs text-neutral-300 ring-1 ring-neutral-700 active:bg-neutral-800"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                html={processContent(msg.content, msg.role === "assistant")}
                isLast={i === messages.length - 1}
              />
            ))}
            {sending && <TypingIndicator />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Context bar */}
      <div className="border-t border-neutral-800 px-4 pt-2">
        <button
          onClick={() => setShowCtxPicker(true)}
          className="mb-2 flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-[11px] text-neutral-400 ring-1 ring-neutral-700"
        >
          <span>
            Контекст:{" "}
            <span className="text-neutral-200">
              {contactCtx ? contactCtx.full_name : "общий"}
            </span>
          </span>
          {contactCtx && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                setContactCtx(null);
              }}
              className="ml-1 text-neutral-500 active:text-white"
            >
              &times;
            </span>
          )}
        </button>

        {/* Input area */}
        <div className="flex items-end gap-2 pb-2">
          {recording ? (
            // Recording mode
            <div className="flex flex-1 items-center gap-3 rounded-xl bg-red-900/20 px-4 py-3 ring-1 ring-red-500/30">
              <div className="h-3 w-3 animate-pulse rounded-full bg-rec" />
              <span className="flex-1 font-mono text-sm text-white">
                {formatTime(recSeconds)}
              </span>
              <button
                onClick={stopVoiceRecording}
                className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-rec text-white"
              >
                <svg
                  className="h-5 w-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            </div>
          ) : (
            <>
              {/* Mic button */}
              <button
                onClick={startVoiceRecording}
                disabled={sending}
                className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full bg-card text-neutral-400 ring-1 ring-neutral-700 active:bg-neutral-800 disabled:opacity-50"
              >
                <svg
                  className="h-5 w-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2z" />
                </svg>
              </button>
              {/* Text input */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Спроси меня..."
                rows={1}
                className="max-h-[100px] min-h-[44px] flex-1 resize-none rounded-xl bg-card px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
              />
              {/* Send button */}
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || sending}
                className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-30"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 12h14M12 5l7 7-7 7"
                  />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Contact picker modal */}
      {showCtxPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={() => setShowCtxPicker(false)}
        >
          <div
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />
            <h3 className="mb-3 text-lg font-semibold text-white">
              Выбрать контекст
            </h3>
            <button
              onClick={() => {
                setContactCtx(null);
                setShowCtxPicker(false);
              }}
              className="mb-3 w-full rounded-xl bg-neutral-800 px-4 py-3 text-left text-sm text-neutral-200 active:bg-neutral-700"
            >
              Общий контекст
            </button>
            <input
              type="text"
              placeholder="Поиск контакта..."
              value={contactSearch}
              onChange={(e) => searchContacts(e.target.value)}
              autoFocus
              className="mb-3 w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
            />
            <div className="max-h-60 overflow-y-auto">
              {contactOptions.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setContactCtx(c);
                    setShowCtxPicker(false);
                    setContactSearch("");
                    setContactOptions([]);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-neutral-200 active:bg-neutral-800"
                >
                  {c.full_name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Clear confirm */}
      {showClearConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowClearConfirm(false)}
        >
          <div
            className="animate-fade-in mx-6 w-full max-w-sm rounded-2xl bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-semibold text-white">
              Очистить историю?
            </h3>
            <p className="mb-5 text-sm text-neutral-400">
              Все сообщения будут удалены. Это нельзя отменить.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 rounded-xl bg-neutral-700 py-3 text-sm font-medium text-white active:bg-neutral-600"
              >
                Отмена
              </button>
              <button
                onClick={clearHistory}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-medium text-white active:bg-red-700"
              >
                Очистить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  msg,
  html,
  isLast,
}: {
  msg: ChatMsg;
  html: string;
  isLast: boolean;
}) {
  const isUser = msg.role === "user";
  const time = new Date(msg.created_at).toLocaleTimeString("ru", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={`flex gap-2 animate-fade-in ${isUser ? "flex-row-reverse" : ""}`}
      style={isLast ? { animationDelay: "0ms" } : undefined}
    >
      {/* Avatar */}
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${
          isUser
            ? "bg-accent/20 text-accent"
            : "bg-neutral-700 text-neutral-300"
        }`}
      >
        {isUser ? "U" : "\u{1F916}"}
      </div>
      {/* Bubble */}
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
          isUser ? "bg-accent text-white" : "bg-card text-neutral-200"
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div
            className="text-sm leading-relaxed prose-invert [&_strong]:font-semibold [&_em]:italic [&_li]:text-sm [&_a]:text-accent"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        <p
          className={`mt-1 text-[10px] ${
            isUser ? "text-white/50 text-right" : "text-neutral-500"
          }`}
        >
          {time}
        </p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2 animate-fade-in">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-700 text-xs text-neutral-300">
        {"\u{1F916}"}
      </div>
      <div className="rounded-2xl bg-card px-4 py-3">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-500" style={{ animationDelay: "0ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-500" style={{ animationDelay: "150ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-500" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
