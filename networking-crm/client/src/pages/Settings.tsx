import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { COUNTRY_NAMES, countryCodeToFlag, getCountryName } from "../lib/countries";

interface UserProfile {
  id: string;
  name: string;
  goals: string | null;
  fears: string | null;
  strengths: string | null;
  weaknesses: string | null;
  current_country: string | null;
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

interface RefreshProgress {
  running: boolean;
  total: number;
  processed: number;
  failed: number;
  growthEdgesBackfilled: number;
  startedAt: string | null;
  finishedAt: string | null;
}

interface CategoryReaction {
  category: string;
  completed: number;
  skipped: number;
  too_hard: number;
  total: number;
  avg_rating: number | null;
  completion_rate: number;
}

interface ReactionInsights {
  by_category: CategoryReaction[];
  loved: {
    title: string;
    category: string;
    rating: number;
    reflection: string | null;
    completed_at: string;
  }[];
  rejected: {
    title: string;
    category: string;
    status: string;
    date: string;
  }[];
  generated_at: string;
}

export default function Settings() {
  const { show } = useToast();

  // Profile
  const [name, setName] = useState("");
  const [goals, setGoals] = useState("");
  const [fears, setFears] = useState("");
  const [strengths, setStrengths] = useState("");
  const [weaknesses, setWeaknesses] = useState("");
  const [currentCountry, setCurrentCountry] = useState("");
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  // Methodologies
  const [methodologies, setMethodologies] = useState<MethodologyItem[]>([]);
  const [showAddMethod, setShowAddMethod] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Stats
  const [appStats, setAppStats] = useState<AppStats | null>(null);

  // Reaction insights
  const [reactions, setReactions] = useState<ReactionInsights | null>(null);
  const [reactionsLoading, setReactionsLoading] = useState(false);
  const [reactionsRefreshing, setReactionsRefreshing] = useState(false);

  // Full-network refresh
  const [refresh, setRefresh] = useState<RefreshProgress | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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
      setCurrentCountry(data.current_country || "");
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

  const fetchReactions = useCallback(async () => {
    setReactionsLoading(true);
    try {
      const data = await api.get<{ insights: ReactionInsights | null }>(
        "/user/reaction-insights",
      );
      setReactions(data.insights);
    } catch {
      /* ignore */
    } finally {
      setReactionsLoading(false);
    }
  }, []);

  const pollRefresh = useCallback(async () => {
    try {
      const data = await api.get<RefreshProgress>("/contacts/refresh");
      setRefresh(data);
      if (!data.running && refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
    } catch {
      /* ignore */
    }
  }, []);

  const startRefresh = async () => {
    try {
      const data = await api.post<RefreshProgress>("/contacts/refresh");
      setRefresh(data);
      if (!refreshTimer.current) {
        refreshTimer.current = setInterval(pollRefresh, 2000);
      }
      show("Обновление запущено — можно закрыть экран, оно идёт в фоне");
    } catch {
      show("Не удалось запустить обновление");
    }
  };

  const refreshReactions = async () => {
    setReactionsRefreshing(true);
    try {
      const data = await api.post<{ insights: ReactionInsights | null }>(
        "/user/reaction-insights/refresh",
      );
      setReactions(data.insights);
      show("Инсайты обновлены");
    } catch {
      show("Не удалось обновить");
    } finally {
      setReactionsRefreshing(false);
    }
  };

  const runWeeklyMemory = async () => {
    show("Запускаю консолидацию памяти...");
    try {
      await api.post("/cron/memory-now");
      show("Готово. Проверь контакты");
      fetchReactions();
    } catch {
      show("Не удалось запустить");
    }
  };

  useEffect(() => {
    fetchProfile();
    fetchMethodologies();
    fetchStats();
    fetchReactions();
  }, [fetchProfile, fetchMethodologies, fetchStats, fetchReactions]);

  // Pick up an in-progress refresh when the screen opens, keep polling it.
  useEffect(() => {
    let active = true;
    api
      .get<RefreshProgress>("/contacts/refresh")
      .then((data) => {
        if (!active) return;
        setRefresh(data);
        if (data.running && !refreshTimer.current) {
          refreshTimer.current = setInterval(pollRefresh, 2000);
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      active = false;
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [pollRefresh]);

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      await api.put("/user/profile", {
        name: name.trim(),
        goals: goals.trim() || null,
        fears: fears.trim() || null,
        strengths: strengths.trim() || null,
        weaknesses: weaknesses.trim() || null,
        current_country: currentCountry || null,
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
        credentials: "same-origin",
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
      const res = await fetch("/api/auth/change-pin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        show("PIN обновлён");
        setShowPinChange(false);
        setCurrentPin("");
        setNewPin("");
      } else {
        show(data.error || "Ошибка смены PIN");
      }
    } catch {
      show("Ошибка смены PIN");
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 pt-6 pb-4">
      <h1 className="text-xl font-bold text-white">Настройки</h1>

      {/* Current Location */}
      <Section title="Моя локация">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-neutral-400">
            Укажите страну, в которой вы сейчас находитесь. Контакты из этой страны будут подсвечены золотым — вы можете встретиться с ними лично!
          </p>
          <button
            onClick={() => setShowCountryPicker(true)}
            className="relative w-full overflow-hidden rounded-xl py-3 px-4 text-left transition-all"
            style={currentCountry ? {
              background: "linear-gradient(135deg, rgba(251, 191, 36, 0.12) 0%, rgba(245, 158, 11, 0.08) 100%)",
              boxShadow: "0 0 20px rgba(251, 191, 36, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(251, 191, 36, 0.25)",
            } : {
              background: "rgb(38, 38, 38)",
              border: "1px solid rgb(64, 64, 64)",
            }}
          >
            {currentCountry ? (
              <div className="flex items-center gap-3">
                <span className="text-2xl">{countryCodeToFlag(currentCountry)}</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-200">
                    {getCountryName(currentCountry)}
                  </p>
                  <p className="text-[10px] text-amber-400/60">Текущее местоположение</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/20">
                  <svg className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-700">
                  <svg className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p className="text-sm text-neutral-500">Выберите страну...</p>
              </div>
            )}
          </button>
          {currentCountry && (
            <button
              onClick={() => {
                setCurrentCountry("");
                show("Локация сброшена");
              }}
              className="self-start text-xs text-neutral-500 active:text-red-400"
            >
              Сбросить локацию
            </button>
          )}
        </div>
      </Section>

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

      {/* Reaction insights */}
      <Section title="Что зашло / что нет (30 дней)">
        {reactionsLoading && !reactions ? (
          <p className="text-sm text-neutral-500">Загружаем...</p>
        ) : !reactions || reactions.by_category.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-neutral-500">
              Пока нет данных. Когда накопятся реакции на челленджи, бот начнёт подстраивать новые под твой вкус.
            </p>
            <button
              onClick={refreshReactions}
              disabled={reactionsRefreshing}
              className="rounded-xl bg-neutral-800 py-2.5 text-sm text-neutral-300 active:bg-neutral-700 disabled:opacity-50"
            >
              {reactionsRefreshing ? "Считаем..." : "Посчитать сейчас"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              {reactions.by_category.map((c) => (
                <div key={c.category} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 text-neutral-300">{c.category}</span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-accent"
                      style={{ width: `${c.completion_rate}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs text-neutral-400">
                    {c.completion_rate}%
                    {c.avg_rating != null && ` · ${c.avg_rating.toFixed(1)}★`}
                  </span>
                </div>
              ))}
            </div>

            {reactions.loved.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] uppercase tracking-wider text-emerald-400">
                  Зашло
                </p>
                <div className="flex flex-col gap-1.5">
                  {reactions.loved.map((c, i) => (
                    <div
                      key={i}
                      className="rounded-xl bg-emerald-500/5 px-3 py-2 text-xs ring-1 ring-emerald-500/20"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-neutral-200">{c.title}</span>
                        <span className="text-emerald-400">{c.rating}★</span>
                      </div>
                      {c.reflection && (
                        <p className="mt-1 line-clamp-2 text-[11px] italic text-neutral-400">
                          “{c.reflection}”
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {reactions.rejected.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] uppercase tracking-wider text-red-400">
                  Не пошло
                </p>
                <div className="flex flex-col gap-1.5">
                  {reactions.rejected.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-xl bg-red-500/5 px-3 py-2 text-xs ring-1 ring-red-500/20"
                    >
                      <span className="text-neutral-200">{c.title}</span>
                      <span className="text-[10px] text-red-400">{c.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>
                Обновлено: {new Date(reactions.generated_at).toLocaleString("ru-RU")}
              </span>
              <button
                onClick={refreshReactions}
                disabled={reactionsRefreshing}
                className="rounded-lg bg-neutral-800 px-3 py-1.5 text-[11px] text-neutral-300 active:bg-neutral-700 disabled:opacity-50"
              >
                {reactionsRefreshing ? "..." : "Пересчитать"}
              </button>
            </div>

            <button
              onClick={runWeeklyMemory}
              className="rounded-xl bg-accent/15 py-2.5 text-sm text-accent active:bg-accent/25"
            >
              Запустить консолидацию памяти сейчас
            </button>
          </div>
        )}
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

          {/* Full-network refresh */}
          <div className="mt-1 rounded-xl bg-neutral-800/60 p-3">
            <p className="mb-2 text-xs leading-relaxed text-neutral-500">
              Проходит по всем контактам и пересчитывает производные данные
              (теплота, интерес, зона роста) из уже сохранённой истории. Полезно
              после обновлений приложения — старые контакты получат новые поля.
              Ничего не сбрасывается, только пересчитывается.
            </p>
            <button
              onClick={startRefresh}
              disabled={refresh?.running}
              className="w-full rounded-lg bg-accent/15 py-2.5 text-sm font-medium text-accent active:bg-accent/25 disabled:opacity-60"
            >
              {refresh?.running
                ? `Обновляю... ${refresh.processed}/${refresh.total || "?"}`
                : "Обновить все контакты"}
            </button>
            {refresh?.running && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-700">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{
                    width: `${
                      refresh.total > 0
                        ? Math.round((refresh.processed / refresh.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            )}
            {refresh && !refresh.running && refresh.finishedAt && (
              <p className="mt-2 text-[11px] text-neutral-500">
                Готово · обновлено {refresh.processed} из {refresh.total}
                {refresh.growthEdgesBackfilled > 0 &&
                  ` · зон роста добавлено ${refresh.growthEdgesBackfilled}`}
                {refresh.failed > 0 && ` · ошибок ${refresh.failed}`}
              </p>
            )}
          </div>
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

      {/* Country picker modal */}
      {showCountryPicker && (
        <CountryPickerModal
          selected={currentCountry}
          onSelect={(code) => {
            setCurrentCountry(code);
            setShowCountryPicker(false);
            show(`Локация: ${countryCodeToFlag(code)} ${getCountryName(code)}`);
          }}
          onClose={() => setShowCountryPicker(false)}
        />
      )}

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

function CountryPickerModal({
  selected,
  onSelect,
  onClose,
}: {
  selected: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const countries = useMemo(() => {
    const entries = Object.entries(COUNTRY_NAMES);
    if (!search.trim()) return entries;
    const q = search.trim().toLowerCase();
    return entries.filter(
      ([code, name]) =>
        name.toLowerCase().includes(q) || code.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="animate-slide-up flex w-full max-w-[430px] max-h-[80vh] flex-col rounded-t-3xl bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-3">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />
          <h3 className="mb-3 text-lg font-semibold text-white">
            Где вы сейчас?
          </h3>
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
              fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
            >
              <circle cx="11" cy="11" r="8" />
              <path strokeLinecap="round" d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="Поиск страны..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl bg-neutral-800 py-2.5 pl-9 pr-4 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-amber-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-8">
          {countries.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-neutral-500">
              Ничего не найдено
            </p>
          ) : (
            countries.map(([code, name]) => (
              <button
                key={code}
                onClick={() => onSelect(code)}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all active:bg-neutral-700 ${
                  selected === code
                    ? "bg-amber-500/10"
                    : "hover:bg-neutral-800/50"
                }`}
              >
                <span className="text-xl">{countryCodeToFlag(code)}</span>
                <span
                  className={`flex-1 text-sm ${
                    selected === code
                      ? "font-semibold text-amber-200"
                      : "text-neutral-300"
                  }`}
                >
                  {name}
                </span>
                {selected === code && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500">
                    <svg className="h-3.5 w-3.5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
