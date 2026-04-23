import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import RankBadge from "../components/RankBadge";
import { api } from "../lib/api";
import {
  NetworkReach,
  NetworkReachCluster,
  RankDef,
  RankPayload,
} from "../lib/rank";
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

      {/* ── Network reach (small-world model) ── */}
      <motion.section variants={item}>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Потенциал сети
        </h3>
        <NetworkReachCard reach={data.network_reach} />
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

// ── Network reach (Six-degrees calculator) ──────────────────────
// Visualises a small-world projection of the user's network:
// direct contacts → degrees 2..6, plus per-caste / per-industry
// clusters with homophily affinity. Pure presentational component —
// all numbers come from the server `computeNetworkReach`.

function formatCount(n: number): string {
  if (n < 1000) return n.toLocaleString("ru-RU");
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  if (n < 1_000_000) return Math.round(n / 1000) + "K";
  if (n < 10_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n < 1_000_000_000) return Math.round(n / 1_000_000) + "M";
  return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
}

const DEGREE_LABEL: Record<number, string> = {
  1: "Прямые контакты",
  2: "Через 1 рукопожатие",
  3: "Через 2 рукопожатия",
  4: "Через 3 рукопожатия",
  5: "Через 4 рукопожатия",
  6: "Через 5 рукопожатий",
};

const CLUSTER_COLORS = [
  "#6366f1", // indigo / accent
  "#ec4899", // pink
  "#22c55e", // green
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#a855f7", // purple
  "#ef4444", // red
  "#14b8a6", // teal
  "#eab308", // yellow
  "#f97316", // orange
  "#84cc16", // lime
  "#8b5cf6", // violet
];

function colorForIndex(i: number): string {
  return CLUSTER_COLORS[i % CLUSTER_COLORS.length];
}

function NetworkReachCard({ reach }: { reach: NetworkReach }) {
  const { model, degrees, clusters, summary } = reach;
  const castes = clusters.filter((c) => c.type === "caste");
  const industries = clusters.filter((c) => c.type === "industry");

  const hasContacts = summary.direct > 0;
  const maxDegreeCount = Math.max(1, ...degrees.map((d) => d.count));
  // log-scaled bar width so degree 6 is visible next to degree 1
  const barPct = (n: number): number => {
    if (n <= 0) return 0;
    const ratio = Math.log10(1 + n) / Math.log10(1 + maxDegreeCount);
    return Math.max(2, Math.min(100, ratio * 100));
  };

  return (
    <div className="rounded-2xl border border-white/5 bg-card p-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-white/5 p-3">
          <p className="text-lg font-bold text-white">
            {formatCount(summary.direct)}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
            Прямые
          </p>
        </div>
        <div className="rounded-xl bg-accent/10 p-3 ring-1 ring-accent/20">
          <p className="text-lg font-bold text-accent">
            {formatCount(summary.potential_d2)}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-accent/70">
            2° потенциал
          </p>
        </div>
        <div className="rounded-xl bg-purple-500/10 p-3 ring-1 ring-purple-500/20">
          <p className="text-lg font-bold text-purple-300">
            {formatCount(summary.potential_d3)}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-purple-300/70">
            3° потенциал
          </p>
        </div>
        <div className="rounded-xl bg-yellow-500/10 p-3 ring-1 ring-yellow-500/20">
          <p className="text-lg font-bold text-yellow-300">
            {formatCount(summary.potential_d6_cumulative)}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-yellow-300/70">
            6° всего
          </p>
        </div>
      </div>

      {!hasContacts && (
        <p className="mt-4 rounded-xl bg-white/5 p-3 text-center text-xs text-neutral-400">
          Добавь первые контакты — и здесь появится проекция твоей сети на 6 уровней глубины.
        </p>
      )}

      {/* Degrees funnel */}
      {hasContacts && (
        <div className="mt-5">
          <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">
            Воронка рукопожатий
          </p>
          <div className="flex flex-col gap-1.5">
            {degrees.map((d) => {
              const pct = barPct(d.count);
              const isCurrent = d.degree === 1;
              return (
                <div key={d.degree} className="flex items-center gap-2">
                  <div
                    className={`w-6 shrink-0 text-center text-[11px] font-semibold ${
                      isCurrent ? "text-accent" : "text-neutral-500"
                    }`}
                  >
                    {d.degree}°
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-white/5">
                        <motion.div
                          className={`h-full rounded-md ${
                            isCurrent
                              ? "bg-gradient-to-r from-accent to-yellow-400"
                              : "bg-gradient-to-r from-accent/40 to-purple-400/40"
                          }`}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{
                            duration: 0.7,
                            delay: d.degree * 0.05,
                            ease: "easeOut",
                          }}
                        />
                        {d.capped && (
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-yellow-300">
                            cap
                          </span>
                        )}
                      </div>
                      <div className="w-14 shrink-0 text-right text-[12px] font-semibold text-white">
                        {formatCount(d.count)}
                      </div>
                    </div>
                    <p className="mt-0.5 text-[10px] text-neutral-500">
                      {DEGREE_LABEL[d.degree]}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Formula */}
      <details className="group mt-5 rounded-xl bg-white/5 p-3">
        <summary className="flex cursor-pointer items-center justify-between text-[11px] uppercase tracking-widest text-neutral-400 [&::-webkit-details-marker]:hidden">
          <span>Математика</span>
          <span className="text-neutral-600 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-neutral-400">
          <p className="rounded-lg bg-black/30 px-2 py-1.5 font-mono text-[11px] text-neutral-300">
            R(d) = N · (k · (1 − C))^(d − 1)
          </p>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>
              <span className="text-neutral-300">N = {summary.direct}</span> — прямые контакты
            </li>
            <li>
              <span className="text-neutral-300">k = {model.dunbar_k}</span> — число Данбара (связей на человека)
            </li>
            <li>
              <span className="text-neutral-300">C = {model.clustering_c}</span> — коэф. кластеризации (Уоттс-Строгатц)
            </li>
            <li>
              <span className="text-neutral-300">
                k · (1 − C) ≈ {model.new_per_hop}
              </span>{" "}
              — уникальных на каждом следующем уровне
            </li>
            <li>
              Кастовая проекция: R<sub>касты</sub>(d) = R(d) · доля, с гомофильной премией до{" "}
              {Math.round(model.homophily_factor * 100)}% (McPherson).
            </li>
            <li>Крышка: население Земли ≈ {formatCount(model.reach_cap)}.</li>
          </ul>
        </div>
      </details>

      {/* Clusters */}
      {hasContacts && (castes.length > 0 || industries.length > 0) && (
        <div className="mt-5 space-y-4">
          {castes.length > 0 && (
            <ClusterBlock
              title="Касты (роли)"
              tint="purple"
              clusters={castes}
            />
          )}
          {industries.length > 0 && (
            <ClusterBlock
              title="Индустрии"
              tint="emerald"
              clusters={industries}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ClusterBlock({
  title,
  clusters,
  tint,
}: {
  title: string;
  clusters: NetworkReachCluster[];
  tint: "purple" | "emerald";
}) {
  if (clusters.length === 0) return null;
  const maxDirect = Math.max(1, ...clusters.map((c) => c.direct));
  const N = clusters.length;

  // Radial hub-and-spoke: "Ты" in the middle, clusters on an orbit.
  // Bubble area scales with √direct; spoke thickness with share.
  const W = 360;
  const H = 240;
  const cx0 = W / 2;
  const cy0 = H / 2;
  const orbit = Math.min(W, H) * 0.29;
  const circumference = 2 * Math.PI * orbit;
  const gap = circumference / Math.max(N, 1);
  const maxR = Math.min(34, Math.max(14, (gap - 6) / 2));
  const minR = 11;

  const bubbles = clusters.map((c, i) => {
    // Distribute evenly starting from the top (12 o'clock), clockwise.
    // For a single cluster place it to the right for a clean "me → X" read.
    const angle = N === 1 ? 0 : (i / N) * 2 * Math.PI - Math.PI / 2;
    const sizeRatio = Math.sqrt(c.direct / maxDirect);
    const r = Math.max(minR, Math.min(maxR, sizeRatio * maxR + 4));
    const cx = cx0 + Math.cos(angle) * orbit;
    const cy = cy0 + Math.sin(angle) * orbit;
    // Label position: push outward along the spoke, past the bubble edge.
    const dx = cx - cx0;
    const dy = cy - cy0;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const labelX = cx + (dx / len) * (r + 10);
    const labelY = cy + (dy / len) * (r + 10) + 3;
    return {
      cluster: c,
      r,
      cx,
      cy,
      labelX,
      labelY,
      color: colorForIndex(i),
      spokeWidth: 0.6 + (c.direct / maxDirect) * 1.6,
    };
  });

  const textTint = tint === "purple" ? "text-purple-300" : "text-emerald-300";
  const chipBg =
    tint === "purple"
      ? "bg-purple-500/10 text-purple-300"
      : "bg-emerald-500/10 text-emerald-300";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-widest text-neutral-500">
          {title}
        </p>
        <p className="text-[10px] text-neutral-500">ты в центре · клики на орбите</p>
      </div>

      <div className="rounded-xl bg-black/30 p-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full overflow-visible"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Кластеры: ${title}`}
        >
          <circle
            cx={cx0}
            cy={cy0}
            r={orbit}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeDasharray="2 3"
          />
          {bubbles.map((b) => (
            <line
              key={`s-${b.cluster.id}`}
              x1={cx0}
              y1={cy0}
              x2={b.cx}
              y2={b.cy}
              stroke={b.color}
              strokeOpacity={0.35}
              strokeWidth={b.spokeWidth}
            />
          ))}

          <circle
            cx={cx0}
            cy={cy0}
            r={16}
            fill="#6366f1"
            fillOpacity={0.12}
            stroke="#6366f1"
            strokeOpacity={0.45}
          />
          <circle cx={cx0} cy={cy0} r={6} fill="#e6e8ec" />
          <text
            x={cx0}
            y={cy0}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="8"
            fontWeight="700"
            fill="#0f0f0f"
          >
            Ты
          </text>

          {bubbles.map((b) => {
            const label =
              b.cluster.label.length > 14
                ? b.cluster.label.slice(0, 13) + "…"
                : b.cluster.label;
            return (
              <g key={b.cluster.id}>
                <circle
                  cx={b.cx}
                  cy={b.cy}
                  r={b.r}
                  fill={b.color}
                  fillOpacity={0.22}
                  stroke={b.color}
                  strokeOpacity={0.8}
                  strokeWidth={1.5}
                />
                <circle
                  cx={b.cx}
                  cy={b.cy}
                  r={Math.max(2, b.r * 0.28)}
                  fill={b.color}
                  fillOpacity={0.9}
                />
                <text
                  x={b.cx}
                  y={b.cy}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="9"
                  fontWeight="700"
                  fill="#ffffff"
                  fillOpacity={0.85}
                >
                  {b.cluster.direct}
                </text>
                <text
                  x={b.labelX}
                  y={b.labelY}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#c7c7c7"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {clusters.map((c, i) => {
          const directPct = (c.direct / maxDirect) * 100;
          return (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: colorForIndex(i) }}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] text-white">
                {c.label}
              </span>
              <span className={`shrink-0 text-[10px] ${textTint}`}>
                {c.share_pct}%
              </span>
              <div className="hidden sm:flex min-w-0 flex-1 items-center gap-2">
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${directPct}%`,
                      background: colorForIndex(i),
                      opacity: 0.5,
                    }}
                  />
                </div>
              </div>
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${chipBg}`}
                title={`Через 1 рукопожатие — ожидаемо ~${formatCount(
                  c.potential_d2,
                )} человек. Гомофилия +${c.homophily_pct}%.`}
              >
                2°: {formatCount(c.potential_d2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
