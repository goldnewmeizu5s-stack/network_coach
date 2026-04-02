import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";

interface UserProfile {
  id: string;
  name: string;
  goals: string | null;
  fears: string | null;
  strengths: string | null;
  weaknesses: string | null;
  preferences: Record<string, unknown> | null;
}

interface MethodologyItem {
  id: string;
  source: string;
  title: string;
  core_principle: string;
  tags: string[];
}

interface AppStats {
  contacts: number;
  interactions: number;
  methodologies: number;
}

export default function Settings() {
  const { show } = useToast();

  // Profile
  const [name, setName] = useState("");
  const [goals, setGoals] = useState("");
  const [fears, setFears] = useState("");
  const [strengths, setStrengths] = useState("");
  const [weaknesses, setWeaknesses] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  // Methodologies
  const [methodologies, setMethodologies] = useState<MethodologyItem[]>([]);
  const [showAddMethod, setShowAddMethod] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Stats
  const [appStats, setAppStats] = useState<AppStats | null>(null);

  // PIN
  const [showPinChange, setShowPinChange] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");

  const fetchProfile = useCallback(async () => {
    try {
      const data = await api.get<UserProfile>("/user/profile");
      setName(data.name || "");
      setGoals(data.goals || "");
      setFears(data.fears || "");
      setStrengths(data.strengths || "");
      setWeaknesses(data.weaknesses || "");
    } catch {
      /* ignore */
    }
  }, []);

  const fetchMethodologies = useCallback(async () => {
    try {
      const data = await api.get<{ methodologies: MethodologyItem[] }>(
        "/methodologies"
      );
      setMethodologies(data.methodologies);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const [contacts, methods] = await Promise.all([
        api.get<{ total: number }>("/stats"),
        api.get<{ total: number }>("/methodologies"),
      ]);
      setAppStats({
        contacts: (contacts as Record<string, number>).total_contacts || 0,
        interactions: 0,
        methodologies: methods.total,
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    fetchMethodologies();
    fetchStats();
  }, [fetchProfile, fetchMethodologies, fetchStats]);

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      await api.put("/user/profile", {
        name: name.trim(),
        goals: goals.trim() || null,
        fears: fears.trim() || null,
        strengths: strengths.trim() || null,
        weaknesses: weaknesses.trim() || null,
      });
      show("Профиль сохранён");
    } catch {
      show("Ошибка сохранения");
    } finally {
      setProfileSaving(false);
    }
  };

  const deleteMethodology = async (id: string) => {
    try {
      await api.del(`/methodologies/${id}`);
      setMethodologies((prev) => prev.filter((m) => m.id !== id));
      show("Методология удалена");
    } catch {
      /* ignore */
    }
  };

  const handleJsonImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : data.methodologies;
      if (!Array.isArray(arr)) {
        show("Неверный формат JSON");
        return;
      }
      const result = await api.post<{ imported: number; errors: string[] }>(
        "/methodologies/bulk",
        { methodologies: arr }
      );
      show(`Импортировано: ${result.imported}`);
      fetchMethodologies();
    } catch {
      show("Ошибка импорта");
    }
    e.target.value = "";
  };

  const downloadExport = async (path: string, filename: string) => {
    try {
      const res = await fetch(`/api${path}`, {
        headers: { "x-auth-pin": sessionStorage.getItem("pin") || "" },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      show("Файл скачан");
    } catch {
      show("Ошибка экспорта");
    }
  };

  const runCron = async () => {
    try {
      await api.post("/cron/run-now");
      show("Follow-ups обновлены");
    } catch {
      show("Ошибка запуска");
    }
  };

  const changePin = async () => {
    if (!currentPin || !newPin || newPin.length < 4) {
      show("PIN должен быть минимум 4 символа");
      return;
    }
    try {
      await fetch("/api/auth/change-pin", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-pin": currentPin,
        },
        body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
      });
      show("PIN обновлён");
      setShowPinChange(false);
      setCurrentPin("");
      setNewPin("");
    } catch {
      show("Ошибка смены PIN");
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 pt-6 pb-4">
      <h1 className="text-xl font-bold text-white">Настройки</h1>

      {/* Profile */}
      <Section title="Мой профиль">
        <div className="flex flex-col gap-3">
          <Field label="Имя" value={name} onChange={setName} />
          <Field
            label="Цели в нетворкинге"
            value={goals}
            onChange={setGoals}
            multiline
            placeholder="Зачем мне нетворкинг?"
          />
          <Field
            label="Что мне сложно / страхи"
            value={fears}
            onChange={setFears}
            multiline
            placeholder="Чего я боюсь в общении?"
          />
          <Field
            label="Мои сильные стороны"
            value={strengths}
            onChange={setStrengths}
            multiline
            placeholder="В чём я хорош?"
          />
          <Field
            label="Мои слабые стороны"
            value={weaknesses}
            onChange={setWeaknesses}
            multiline
            placeholder="Что хочу улучшить?"
          />
          <button
            onClick={saveProfile}
            disabled={profileSaving}
            className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white active:bg-accent-hover disabled:opacity-50"
          >
            {profileSaving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </Section>

      {/* Methodologies */}
      <Section title={`Методологии (${methodologies.length})`}>
        <div className="flex flex-col gap-2 mb-3">
          {methodologies.length === 0 ? (
            <p className="text-sm text-neutral-500">Нет загруженных методологий</p>
          ) : (
            methodologies.map((m) => (
              <MethodologyRow
                key={m.id}
                item={m}
                onDelete={() => deleteMethodology(m.id)}
              />
            ))
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAddMethod(true)}
            className="flex-1 rounded-xl bg-neutral-800 py-2.5 text-sm text-neutral-300 active:bg-neutral-700"
          >
            + Добавить
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 rounded-xl bg-neutral-800 py-2.5 text-sm text-neutral-300 active:bg-neutral-700"
          >
            Импорт JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleJsonImport}
            className="hidden"
          />
        </div>
      </Section>

      {/* Data */}
      <Section title="Данные">
        <div className="flex flex-col gap-2">
          <button
            onClick={() => downloadExport("/export/contacts", "contacts.json")}
            className="w-full rounded-xl bg-neutral-800 py-3 text-left px-4 text-sm text-neutral-300 active:bg-neutral-700"
          >
            Экспорт контактов (JSON)
          </button>
          <button
            onClick={() => downloadExport("/export/all", "crm-export.json")}
            className="w-full rounded-xl bg-neutral-800 py-3 text-left px-4 text-sm text-neutral-300 active:bg-neutral-700"
          >
            Экспорт всех данных
          </button>
          <button
            onClick={runCron}
            className="w-full rounded-xl bg-neutral-800 py-3 text-left px-4 text-sm text-neutral-400 active:bg-neutral-700"
          >
            Обновить follow-ups (cron)
          </button>
        </div>
      </Section>

      {/* About */}
      <Section title="О приложении">
        <div className="flex flex-col gap-2 text-sm text-neutral-400">
          <p>Networking CRM v1.0.0</p>
          {appStats && (
            <>
              <p>Контакты: {appStats.contacts}</p>
              <p>Методологии: {appStats.methodologies}</p>
            </>
          )}
          <button
            onClick={() => setShowPinChange(true)}
            className="mt-2 self-start text-accent active:text-accent-hover"
          >
            Сменить PIN
          </button>
        </div>
      </Section>

      {/* Add methodology modal */}
      {showAddMethod && (
        <AddMethodologyModal
          onClose={() => setShowAddMethod(false)}
          onCreated={() => {
            setShowAddMethod(false);
            fetchMethodologies();
            show("Методология добавлена");
          }}
        />
      )}

      {/* Change PIN modal */}
      {showPinChange && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowPinChange(false)}
        >
          <div
            className="animate-fade-in mx-6 w-full max-w-sm rounded-2xl bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-semibold text-white">
              Сменить PIN
            </h3>
            <input
              type="password"
              placeholder="Текущий PIN"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value)}
              className="mb-3 w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
            />
            <input
              type="password"
              placeholder="Новый PIN (мин. 4 символа)"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              className="mb-4 w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
            />
            <button
              onClick={changePin}
              disabled={!currentPin || newPin.length < 4}
              className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white active:bg-accent-hover disabled:opacity-50"
            >
              Сменить
            </button>
          </div>
        </div>
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

function Field({
  label,
  value,
  onChange,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const cls =
    "w-full rounded-xl bg-neutral-800 px-4 py-2.5 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent";
  return (
    <div>
      <label className="mb-1 block text-xs text-neutral-500">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={`${cls} resize-none`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cls}
        />
      )}
    </div>
  );
}

function MethodologyRow({
  item,
  onDelete,
}: {
  item: MethodologyItem;
  onDelete: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const direction = useRef<"none" | "horizontal" | "vertical">("none");

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div className="absolute right-0 top-0 flex h-full items-stretch">
        <button
          onClick={onDelete}
          className="flex w-[70px] items-center justify-center bg-red-600 text-xs font-medium text-white"
        >
          Удалить
        </button>
      </div>
      <div
        className="relative bg-neutral-800 px-3 py-2.5 transition-transform"
        style={{ transform: `translateX(${offset}px)`, touchAction: "pan-y" }}
        onTouchStart={(e) => {
          startX.current = e.touches[0].clientX;
          startY.current = e.touches[0].clientY;
          direction.current = "none";
        }}
        onTouchMove={(e) => {
          const dx = e.touches[0].clientX - startX.current;
          const dy = e.touches[0].clientY - startY.current;
          if (direction.current === "none" && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
            direction.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
          }
          if (direction.current === "horizontal" && dx < -10) {
            setOffset(Math.max(dx, -70));
          }
        }}
        onTouchEnd={() => {
          direction.current = "none";
          setOffset(offset < -35 ? -70 : 0);
        }}
      >
        <p className="text-sm font-medium text-neutral-200 truncate">
          {item.title}
        </p>
        <p className="text-xs text-neutral-500 truncate">{item.source}</p>
      </div>
    </div>
  );
}

function AddMethodologyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [principle, setPrinciple] = useState("");
  const [fullText, setFullText] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!source.trim() || !title.trim()) return;
    setSaving(true);
    try {
      await api.post("/methodologies", {
        source: source.trim(),
        title: title.trim(),
        core_principle: principle.trim(),
        full_text: fullText.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onCreated();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="animate-slide-up w-full max-w-[430px] max-h-[85vh] overflow-y-auto rounded-t-3xl bg-card px-6 pb-8 pt-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />
        <h3 className="mb-4 text-lg font-semibold text-white">
          Новая методология
        </h3>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Источник (автор, книга) *"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
            autoFocus
          />
          <input
            type="text"
            placeholder="Название *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
          />
          <textarea
            placeholder="Принцип"
            value={principle}
            onChange={(e) => setPrinciple(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
          />
          <textarea
            placeholder="Полное описание"
            value={fullText}
            onChange={(e) => setFullText(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
          />
          <input
            type="text"
            placeholder="Теги (через запятую)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={saving || !source.trim() || !title.trim()}
            className="mt-2 w-full rounded-xl bg-accent py-3 text-sm font-medium text-white active:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Сохранение..." : "Создать"}
          </button>
        </form>
      </div>
    </div>
  );
}
