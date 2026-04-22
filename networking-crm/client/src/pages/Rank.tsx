import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import RankBadge from "../components/RankBadge";
import { api } from "../lib/api";
import { RankDef, RankPayload } from "../lib/rank";
import { countryCodeToFlag, getCountryName } from "../lib/countries";

const CONTINENT_LABEL: Record<string, string> = {
  EU: "Европа",
  AS: "Азия",
  AF: "Африка",
  NA: "Сев. Америка",
  SA: "Юж. Америка",
  OC: "Океания",
};

const item = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
};

export default function RankPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<RankPayload | null>(null);
  const [ladder, setLadder] = useState<RankDef[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const [r, l] = await Promise.all([
          api.get<RankPayload>("/rank", { signal: ac.signal }),
          api.get<{ ranks: RankDef[] }>("/rank/ladder", { signal: ac.signal }),
        ]);
        setData(r);
        setLadder(l.ranks);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!data || !ladder) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-neutral-400">Не удалось загрузить ранг</p>
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-accent"
        >
          Назад
        </button>
      </div>
    );
  }

  return (
    <motion.div
      className="flex flex-1 flex-col gap-6 px-4 pt-6 pb-10"
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
    >
      {/* ── Header ── */}
      <motion.div
        className="flex items-center justify-between"
        variants={item}
      >
        <button
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-card text-neutral-400 active:bg-card-hover"
          aria-label="Назад"
        >
          <svg
            className="h-[18px] w-[18px]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5L8.25 12l7.5-7.5"
            />
          </svg>
        </button>
        <h1 className="text-[18px] font-semibold text-white">Погоны</h1>
        <div className="w-10" />
      </motion.div>

      {/* ── Hero ── */}
      <motion.section
        className="relative overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-br from-card via-card to-[#141414] p-6"
        variants={item}
      >
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-12 bottom-0 h-44 w-44 rounded-full bg-yellow-500/10 blur-3xl" />

        <div className="relative flex flex-col items-center">
          <RankBadge rank={data.rank} size={200} shine />
          <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.24em] text-accent/70">
            Ранг нетворкера
          </p>
          <h2 className="mt-1 text-center text-2xl font-bold text-white">
            {data.rank.title}
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            {data.total_xp.toLocaleString("ru-RU")} XP
          </p>

          {/* Progress bar */}
          <div className="mt-5 w-full">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-accent to-yellow-400"
                initial={{ width: 0 }}
                animate={{ width: `${data.rank.progress_pct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
              <span>{data.rank.short}</span>
              <span>
                {data.next_rank
                  ? `${data.rank.progress_pct}% → ${data.next_rank.short}`
                  : "Высший ранг"}
              </span>
            </div>
            {data.rank.xp_to_next !== null && (
              <p className="mt-1 text-center text-[11px] text-neutral-500">
                до повышения ещё{" "}
                <span className="text-white">
                  {data.rank.xp_to_next.toLocaleString("ru-RU")}
                </span>{" "}
                XP
              </p>
            )}
          </div>
        </div>
      </motion.section>

      {/* ── XP categories ── */}
      <motion.section variants={item}>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Откуда берётся XP
        </h3>
        <div className="flex flex-col gap-3">
          {data.categories.map((cat) => {
            const pct = data.total_xp > 0 ? (cat.xp / data.total_xp) * 100 : 0;
            return (
              <div
                key={cat.id}
                className="rounded-2xl border border-white/5 bg-card p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl leading-none">{cat.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {cat.title}
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        {cat.description}
                      </p>
                    </div>
                  </div>
                  <p className="shrink-0 pl-3 text-sm font-bold text-accent">
                    {cat.xp.toLocaleString("ru-RU")}
                  </p>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-accent/70 to-yellow-400/70"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(pct, 100)}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {cat.breakdown.map((b) => (
                    <div
                      key={b.label}
                      className="flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5"
                    >
                      <span className="truncate pr-2 text-[11px] text-neutral-400">
                        {b.label}
                      </span>
                      <span className="shrink-0 text-[12px] font-semibold text-white">
                        {typeof b.value === "number"
                          ? b.value.toLocaleString("ru-RU")
                          : b.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </motion.section>

      {/* ── Six degrees (world) ── */}
      <motion.section variants={item}>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Шесть рукопожатий
        </h3>
        <div className="rounded-2xl border border-white/5 bg-card p-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white/5 p-3 text-center">
              <p className="text-xl font-bold text-white">
                {data.handshake_world.countries}
              </p>
              <p className="mt-0.5 text-[10px] text-neutral-500">стран</p>
            </div>
            <div className="rounded-xl bg-white/5 p-3 text-center">
              <p className="text-xl font-bold text-white">
                {data.handshake_world.continents}/6
              </p>
              <p className="mt-0.5 text-[10px] text-neutral-500">континентов</p>
            </div>
            <div className="rounded-xl bg-white/5 p-3 text-center">
              <p className="text-xl font-bold text-white">
                {data.handshake_world.cities}
              </p>
              <p className="mt-0.5 text-[10px] text-neutral-500">городов</p>
            </div>
          </div>

          {data.handshake_world.country_codes.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">
                Флаги твоего мира
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.handshake_world.country_codes.map((cc) => (
                  <span
                    key={cc}
                    title={getCountryName(cc)}
                    className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-xs"
                  >
                    <span className="text-base leading-none">
                      {countryCodeToFlag(cc)}
                    </span>
                    <span className="text-neutral-400">{cc}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.handshake_world.continent_codes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.handshake_world.continent_codes.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent"
                >
                  {CONTINENT_LABEL[c] ?? c}
                </span>
              ))}
            </div>
          )}

          {data.handshake_world.top_cities.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">
                Города
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.handshake_world.top_cities.map((c) => (
                  <span
                    key={c.name}
                    className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-[11px] text-neutral-300"
                  >
                    {c.name}
                    {c.count > 1 && (
                      <span className="text-neutral-500">·{c.count}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.handshake_world.top_categories.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">
                Касты
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.handshake_world.top_categories.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[11px] text-purple-300"
                  >
                    {c.label}
                    <span className="text-purple-400/70">·{c.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.handshake_world.top_industries.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">
                Индустрии
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.handshake_world.top_industries.map((i) => (
                  <span
                    key={i.id}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300"
                  >
                    {i.label}
                    <span className="text-emerald-400/70">·{i.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.section>

      {/* ── Totals ── */}
      <motion.section variants={item}>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Сводка
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Контактов", value: data.totals.contacts },
            { label: "Взаимодействий", value: data.totals.interactions },
            {
              label: "Челленджей",
              value: data.totals.completed_challenges,
            },
            {
              label: "Follow-up закрыто",
              value: data.totals.completed_followups,
            },
            {
              label: "Тёплых / близких",
              value: data.totals.warm_or_close_contacts,
            },
            { label: "Серия дней", value: data.totals.streak_days },
          ].map((t) => (
            <div
              key={t.label}
              className="rounded-xl border border-white/5 bg-card p-3"
            >
              <p className="text-lg font-bold text-white">{t.value}</p>
              <p className="mt-0.5 text-[11px] text-neutral-500">{t.label}</p>
            </div>
          ))}
        </div>
      </motion.section>

      {/* ── Ladder ── */}
      <motion.section variants={item}>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Лестница званий
        </h3>
        <div className="flex flex-col gap-2">
          {ladder.map((r) => {
            const isCurrent = r.index === data.rank.index;
            const isReached = data.total_xp >= r.xp_min;
            return (
              <div
                key={r.index}
                className={`flex items-center gap-3 rounded-xl border p-2.5 ${
                  isCurrent
                    ? "border-accent/50 bg-accent/10"
                    : isReached
                      ? "border-white/5 bg-card"
                      : "border-white/5 bg-card/40 opacity-60"
                }`}
              >
                <div
                  className={`flex h-14 shrink-0 items-center justify-center ${
                    isReached ? "" : "grayscale"
                  }`}
                >
                  <RankBadge rank={r} size={60} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {r.title}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    {r.xp_min.toLocaleString("ru-RU")} XP
                  </p>
                </div>
                {isCurrent && (
                  <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent">
                    Сейчас
                  </span>
                )}
                {isReached && !isCurrent && (
                  <span className="shrink-0 text-xs text-green-400">✓</span>
                )}
              </div>
            );
          })}
        </div>
      </motion.section>
    </motion.div>
  );
}
