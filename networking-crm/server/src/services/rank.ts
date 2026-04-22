import prisma from "../lib/prisma";
import { normalizeCountry } from "../lib/country-normalize";

// ──────────────────────────────────────────────────────────────
// Rank system — "Погоны Нетворкера"
// 18 ranks from Рядовой (recruit) to Маршал Нетворкинга (supreme).
// Total XP is the sum of five categories (see computeRank).
// Tiers control the shoulder-board art on the client.
// ──────────────────────────────────────────────────────────────

export type RankTier = "recruit" | "nco" | "officer" | "senior" | "general";

export interface RankDef {
  index: number;
  title: string;
  short: string;
  tier: RankTier;
  xp_min: number;
  stars: number;
  bars: number;
  chevrons: number;
}

export const RANKS: RankDef[] = [
  { index: 0,  title: "Рядовой",              short: "Рядовой",     tier: "recruit", xp_min: 0,      stars: 0, bars: 0, chevrons: 0 },
  { index: 1,  title: "Ефрейтор",             short: "Ефрейтор",    tier: "recruit", xp_min: 150,    stars: 0, bars: 0, chevrons: 1 },
  { index: 2,  title: "Младший сержант",      short: "Мл. сержант", tier: "nco",     xp_min: 400,    stars: 0, bars: 0, chevrons: 2 },
  { index: 3,  title: "Сержант",              short: "Сержант",     tier: "nco",     xp_min: 900,    stars: 0, bars: 0, chevrons: 3 },
  { index: 4,  title: "Старший сержант",      short: "Ст. сержант", tier: "nco",     xp_min: 1800,   stars: 0, bars: 0, chevrons: 4 },
  { index: 5,  title: "Старшина",             short: "Старшина",    tier: "nco",     xp_min: 3200,   stars: 0, bars: 0, chevrons: 5 },
  { index: 6,  title: "Младший лейтенант",    short: "Мл. лейт.",   tier: "officer", xp_min: 5000,   stars: 1, bars: 1, chevrons: 0 },
  { index: 7,  title: "Лейтенант",            short: "Лейтенант",   tier: "officer", xp_min: 8000,   stars: 2, bars: 1, chevrons: 0 },
  { index: 8,  title: "Старший лейтенант",    short: "Ст. лейт.",   tier: "officer", xp_min: 12000,  stars: 3, bars: 1, chevrons: 0 },
  { index: 9,  title: "Капитан",              short: "Капитан",     tier: "officer", xp_min: 17000,  stars: 4, bars: 1, chevrons: 0 },
  { index: 10, title: "Майор",                short: "Майор",       tier: "senior",  xp_min: 24000,  stars: 1, bars: 2, chevrons: 0 },
  { index: 11, title: "Подполковник",         short: "Подполк.",    tier: "senior",  xp_min: 33000,  stars: 2, bars: 2, chevrons: 0 },
  { index: 12, title: "Полковник",            short: "Полковник",   tier: "senior",  xp_min: 45000,  stars: 3, bars: 2, chevrons: 0 },
  { index: 13, title: "Генерал-майор",        short: "Ген.-майор",  tier: "general", xp_min: 60000,  stars: 1, bars: 0, chevrons: 0 },
  { index: 14, title: "Генерал-лейтенант",    short: "Ген.-лейт.",  tier: "general", xp_min: 85000,  stars: 2, bars: 0, chevrons: 0 },
  { index: 15, title: "Генерал-полковник",    short: "Ген.-полк.",  tier: "general", xp_min: 115000, stars: 3, bars: 0, chevrons: 0 },
  { index: 16, title: "Генерал армии",        short: "Ген. армии",  tier: "general", xp_min: 150000, stars: 4, bars: 0, chevrons: 0 },
  { index: 17, title: "Маршал Нетворкинга",   short: "Маршал",      tier: "general", xp_min: 200000, stars: 5, bars: 0, chevrons: 0 },
];

// Rough ISO 3166-1 alpha-2 → continent map (only common countries).
const CONTINENT_BY_CC: Record<string, string> = {
  RU: "EU", UA: "EU", BY: "EU", MD: "EU", LV: "EU", LT: "EU", EE: "EU",
  PL: "EU", CZ: "EU", SK: "EU", HU: "EU", RO: "EU", BG: "EU", HR: "EU",
  RS: "EU", ME: "EU", SI: "EU", GR: "EU", CY: "EU", DE: "EU", FR: "EU",
  IT: "EU", ES: "EU", PT: "EU", NL: "EU", BE: "EU", CH: "EU", AT: "EU",
  SE: "EU", NO: "EU", DK: "EU", FI: "EU", IE: "EU", IS: "EU", LU: "EU",
  MC: "EU", MT: "EU", BA: "EU", MK: "EU", AL: "EU", GB: "EU", TR: "EU",
  KZ: "AS", UZ: "AS", GE: "AS", AM: "AS", AZ: "AS", KG: "AS", TJ: "AS",
  TM: "AS", IL: "AS", AE: "AS", SA: "AS", QA: "AS", BH: "AS", KW: "AS",
  OM: "AS", IR: "AS", IQ: "AS", JO: "AS", LB: "AS", SY: "AS", YE: "AS",
  CN: "AS", JP: "AS", KR: "AS", IN: "AS", TH: "AS", VN: "AS",
  ID: "AS", MY: "AS", SG: "AS", PH: "AS", LK: "AS", MM: "AS", NP: "AS",
  PK: "AS", BD: "AS", TW: "AS", HK: "AS", MN: "AS", AF: "AS", LA: "AS", KH: "AS",
  EG: "AF", MA: "AF", TN: "AF", DZ: "AF", LY: "AF", SD: "AF",
  ZA: "AF", NG: "AF", KE: "AF", TZ: "AF", UG: "AF", GH: "AF",
  AO: "AF", SN: "AF", ZW: "AF", ZM: "AF", CI: "AF", CM: "AF", RW: "AF",
  BW: "AF", NA: "AF", MZ: "AF", MG: "AF",
  US: "NA", CA: "NA", MX: "NA", CU: "NA", DO: "NA", HT: "NA", JM: "NA",
  PR: "NA", PA: "NA", CR: "NA", GT: "NA", NI: "NA", HN: "NA", SV: "NA",
  TT: "NA", BS: "NA",
  BR: "SA", AR: "SA", CL: "SA", CO: "SA", PE: "SA", UY: "SA", VE: "SA",
  EC: "SA", BO: "SA", PY: "SA",
  AU: "OC", NZ: "OC",
};

// Relationship category display labels.
const CATEGORY_LABELS: Record<string, string> = {
  business: "Бизнес",
  friendship: "Дружба",
  mentor: "Менторы",
  connector: "Коннекторы",
  investor: "Инвесторы",
  creative: "Креативные",
  other: "Прочие",
};

// Rough industry detector for the occupation string.
// Each bucket is an ordered list of keywords (lowercased). First hit wins.
const INDUSTRY_PATTERNS: { id: string; label: string; keywords: string[] }[] = [
  { id: "tech", label: "Технологии", keywords: [
    "разраб", "программ", "инженер", "developer", "engineer", "software",
    "backend", "frontend", "fullstack", "devops", "data scientist", "ml",
    "machine learn", "ai", "ии", "ct0", "cto", "tech lead",
  ]},
  { id: "finance", label: "Финансы", keywords: [
    "инвест", "трейд", "trader", "trading", "фонд", "finance", "банкир",
    "banker", "hedge", "private equity", "pe ", "vc ", "venture", "invest",
    "portfolio", "крипто", "crypto", "defi",
  ]},
  { id: "product", label: "Продукт", keywords: [
    "product", "продакт", "pm ", "product manag", "ux", "ui ", "designer",
    "дизайн", "researcher",
  ]},
  { id: "founder", label: "Основатели", keywords: [
    "founder", "cofounder", "основат", "основал", "co-founder", "ceo",
    "предприниматель", "entrepreneur",
  ]},
  { id: "marketing", label: "Маркетинг", keywords: [
    "marketing", "маркет", "growth", "pr ", "brand", "бренд", "smm",
    "content", "копирайт",
  ]},
  { id: "sales", label: "Продажи", keywords: [
    "sales", "account", "продаж", "биздев", "bd ", "biz dev", "business development",
  ]},
  { id: "consulting", label: "Консалтинг", keywords: [
    "consult", "консалт", "advisor", "advisory",
  ]},
  { id: "creative", label: "Медиа / Креатив", keywords: [
    "writer", "журналист", "journalist", "artist", "photographer",
    "фотограф", "film", "директор фильма", "producer", "продюсер", "музыкант",
    "composer", "художник",
  ]},
  { id: "science", label: "Наука", keywords: [
    "researcher", "phd", "scientist", "учёный", "ученый", "исследова",
    "professor", "профессор",
  ]},
  { id: "health", label: "Медицина", keywords: [
    "doctor", "врач", "nurse", "therap", "psychologist", "психолог",
    "coach", "коуч", "wellness", "фитнес",
  ]},
  { id: "education", label: "Образование", keywords: [
    "teacher", "учитель", "lector", "preподаватель", "преподаватель", "тренер",
  ]},
  { id: "legal", label: "Юриспруденция", keywords: [
    "lawyer", "юрист", "legal", "attorney", "адвокат", "notary",
  ]},
  { id: "realestate", label: "Недвижимость", keywords: [
    "real estate", "realtor", "broker", "риэлтор", "девелопер ", "development",
  ]},
  { id: "government", label: "Гос / НКО", keywords: [
    "government", "госслуж", "политик", "politician", "ngo", "нко", "нонпроф",
  ]},
  { id: "operations", label: "Операционка", keywords: [
    "operation", "ops ", "chief of staff", "coo", "admin ", "офис-менедж",
  ]},
];

function detectIndustry(occupation: string | null): string | null {
  if (!occupation) return null;
  const lower = occupation.toLowerCase();
  for (const ind of INDUSTRY_PATTERNS) {
    if (ind.keywords.some((k) => lower.includes(k))) return ind.id;
  }
  return null;
}

export interface RankCategory {
  id: string;
  title: string;
  icon: string;
  xp: number;
  description: string;
  breakdown: { label: string; value: number | string }[];
}

export interface HandshakeWorld {
  countries: number;
  continents: number;
  cities: number;
  country_codes: string[];
  continent_codes: string[];
  top_cities: { name: string; count: number }[];
  top_categories: { id: string; label: string; count: number }[];
  top_industries: { id: string; label: string; count: number }[];
}

export interface RankPayload {
  total_xp: number;
  rank: RankDef & { progress_pct: number; xp_to_next: number | null };
  next_rank: RankDef | null;
  categories: RankCategory[];
  handshake_world: HandshakeWorld;
  totals: {
    contacts: number;
    interactions: number;
    completed_challenges: number;
    completed_followups: number;
    streak_days: number;
    warm_or_close_contacts: number;
    avg_warmth: number;
    unique_countries: number;
    unique_continents: number;
    unique_cities: number;
    unique_castes: number;
    unique_industries: number;
  };
}

function findRankForXp(xp: number): RankDef {
  let current = RANKS[0];
  for (const r of RANKS) {
    if (xp >= r.xp_min) current = r;
    else break;
  }
  return current;
}

function nextRank(current: RankDef): RankDef | null {
  return RANKS[current.index + 1] ?? null;
}

// Streak: days with at least one activity (new contact, done follow-up,
// completed challenge, or interaction) ending today. Breaks on the first
// day with zero activity.
async function computeStreak(): Promise<number> {
  const yearAgo = new Date(Date.now() - 365 * 86400000);

  const [doneFUs, createdContacts, completedChallenges, interactions] =
    await Promise.all([
      prisma.followUp.findMany({
        where: { status: "done", completed_at: { gte: yearAgo } },
        select: { completed_at: true },
      }),
      prisma.contact.findMany({
        where: { created_at: { gte: yearAgo } },
        select: { created_at: true },
      }),
      prisma.challenge.findMany({
        where: { status: "completed", completed_at: { gte: yearAgo } },
        select: { completed_at: true },
      }),
      prisma.interaction.findMany({
        where: { created_at: { gte: yearAgo } },
        select: { created_at: true },
      }),
    ]);

  const days = new Set<string>();
  const add = (d: Date | null | undefined) => {
    if (d) days.add(d.toISOString().slice(0, 10));
  };
  for (const r of doneFUs) add(r.completed_at);
  for (const r of createdContacts) add(r.created_at);
  for (const r of completedChallenges) add(r.completed_at);
  for (const r of interactions) add(r.created_at);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    if (days.has(d.toISOString().slice(0, 10))) streak++;
    else break;
  }
  return streak;
}

// Lightweight city normalization: trim + lowercase for bucketing, but
// keep a canonical Title Case version for display.
function normalizeCity(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  // Strip obvious country suffixes after comma ("Dubai, UAE" -> "Dubai").
  const head = trimmed.split(",")[0].trim();
  return head;
}

function bump<T extends string>(map: Map<T, number>, key: T): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export async function computeRank(): Promise<RankPayload> {
  const [
    contacts,
    interactionCount,
    completedChallenges,
    completedFollowUps,
    warmClose,
    avgWarmth,
    streak,
  ] = await Promise.all([
    prisma.contact.findMany({
      where: { warmth_status: { not: "archived" } },
      select: {
        id: true,
        warmth_status: true,
        country: true,
        met_country: true,
        origin_country: true,
        city: true,
        occupation: true,
        relationship_category: true,
        key_interests: true,
      },
    }),
    prisma.interaction.count(),
    prisma.challenge.findMany({
      where: { status: "completed" },
      select: { xp_earned: true, difficulty: true },
    }),
    prisma.followUp.count({ where: { status: "done" } }),
    prisma.contact.count({
      where: { warmth_status: { in: ["warm", "close"] } },
    }),
    prisma.contact.aggregate({
      _avg: { warmth_score: true },
      where: { warmth_status: { not: "archived" } },
    }),
    computeStreak(),
  ]);

  // ── 1. Discipline — challenges + streak ──────────────────────────
  const challengeXp = completedChallenges.reduce(
    (s, c) => s + (c.xp_earned || 0) + (c.difficulty || 0) * 5,
    0,
  );
  const streakXp = streak * 10;
  const disciplineXp = challengeXp + streakXp;

  // ── 2. Reach — number of contacts ────────────────────────────────
  const totalContacts = contacts.length;
  const reachXp = totalContacts * 20 + Math.floor(totalContacts / 10) * 100;

  // ── 3. Conversation — interactions + done follow-ups ─────────────
  const conversationXp = interactionCount * 8 + completedFollowUps * 25;

  // ── 4. Six degrees — geographic + social diversity ───────────────
  // Normalize every country-ish field to ISO, regardless of what was
  // stored (handles legacy "Russia" / "Россия" / "RU" indifferently).
  const countryCodes = new Set<string>();
  const cityCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const industryCounts = new Map<string, number>();
  const interestSet = new Set<string>();

  for (const c of contacts) {
    for (const raw of [c.country, c.met_country, c.origin_country]) {
      const iso = normalizeCountry(raw);
      if (iso) countryCodes.add(iso);
    }

    const city = normalizeCity(c.city);
    if (city) bump(cityCounts, city);

    const cat = c.relationship_category;
    if (cat && CATEGORY_LABELS[cat]) bump(categoryCounts, cat);

    const industry = detectIndustry(c.occupation);
    if (industry) bump(industryCounts, industry);

    for (const interest of c.key_interests ?? []) {
      const norm = (interest || "").trim().toLowerCase();
      if (norm) interestSet.add(norm);
    }
  }

  const continentCodes = new Set<string>();
  for (const code of countryCodes) {
    const cont = CONTINENT_BY_CC[code];
    if (cont) continentCodes.add(cont);
  }

  const sixDegreesXp =
    countryCodes.size * 120 +
    continentCodes.size * 250 +
    cityCounts.size * 60 +
    categoryCounts.size * 100 +
    industryCounts.size * 80 +
    Math.min(interestSet.size, 40) * 15;

  // ── 5. Warmth — quality of relationships ─────────────────────────
  const avg = avgWarmth._avg.warmth_score ?? 0;
  const warmthXp = warmClose * 60 + Math.round(avg * 3);

  const totalXp =
    disciplineXp + reachXp + conversationXp + sixDegreesXp + warmthXp;

  const current = findRankForXp(totalXp);
  const next = nextRank(current);
  const span = next ? next.xp_min - current.xp_min : 0;
  const progress = next
    ? Math.min(100, Math.max(0, ((totalXp - current.xp_min) / span) * 100))
    : 100;

  const topCities = Array.from(cityCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  const topCategories = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, label: CATEGORY_LABELS[id] ?? id, count }));

  const topIndustries = Array.from(industryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => {
      const meta = INDUSTRY_PATTERNS.find((p) => p.id === id);
      return { id, label: meta?.label ?? id, count };
    });

  const categories: RankCategory[] = [
    {
      id: "discipline",
      title: "Дисциплина",
      icon: "🎖️",
      xp: disciplineXp,
      description: "Ежедневные челленджи и серия активных дней",
      breakdown: [
        { label: "Выполнено челленджей", value: completedChallenges.length },
        { label: "XP за челленджи", value: challengeXp },
        { label: "Серия дней подряд", value: streak },
        { label: "XP за серию", value: streakXp },
      ],
    },
    {
      id: "reach",
      title: "Охват",
      icon: "📡",
      xp: reachXp,
      description: "Размер твоей сети: чем больше контактов, тем выше ранг",
      breakdown: [
        { label: "Всего контактов", value: totalContacts },
        { label: "Бонус за десятки", value: Math.floor(totalContacts / 10) * 100 },
      ],
    },
    {
      id: "conversation",
      title: "Общение",
      icon: "💬",
      xp: conversationXp,
      description: "Как часто и адекватно ты поддерживаешь связи",
      breakdown: [
        { label: "Взаимодействий", value: interactionCount },
        { label: "Закрытых follow-up", value: completedFollowUps },
      ],
    },
    {
      id: "six_degrees",
      title: "Шесть рукопожатий",
      icon: "🌍",
      xp: sixDegreesXp,
      description:
        "Разнообразие сети: страны, континенты, города, касты, индустрии, интересы",
      breakdown: [
        { label: "Стран", value: countryCodes.size },
        { label: "Континентов", value: continentCodes.size },
        { label: "Городов", value: cityCounts.size },
        { label: "Каст (ролей)", value: categoryCounts.size },
        { label: "Индустрий", value: industryCounts.size },
        { label: "Уник. интересов", value: Math.min(interestSet.size, 40) },
      ],
    },
    {
      id: "warmth",
      title: "Тепло связей",
      icon: "🔥",
      xp: warmthXp,
      description: "Глубина отношений — тёплые и близкие контакты",
      breakdown: [
        { label: "Тёплые + близкие", value: warmClose },
        { label: "Средний warmth score", value: Math.round(avg) },
      ],
    },
  ];

  return {
    total_xp: totalXp,
    rank: {
      ...current,
      progress_pct: Math.round(progress),
      xp_to_next: next ? next.xp_min - totalXp : null,
    },
    next_rank: next,
    categories,
    handshake_world: {
      countries: countryCodes.size,
      continents: continentCodes.size,
      cities: cityCounts.size,
      country_codes: Array.from(countryCodes).sort(),
      continent_codes: Array.from(continentCodes).sort(),
      top_cities: topCities,
      top_categories: topCategories,
      top_industries: topIndustries,
    },
    totals: {
      contacts: totalContacts,
      interactions: interactionCount,
      completed_challenges: completedChallenges.length,
      completed_followups: completedFollowUps,
      streak_days: streak,
      warm_or_close_contacts: warmClose,
      avg_warmth: Math.round(avg),
      unique_countries: countryCodes.size,
      unique_continents: continentCodes.size,
      unique_cities: cityCounts.size,
      unique_castes: categoryCounts.size,
      unique_industries: industryCounts.size,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// One-off backfill: any contact whose country / met_country /
// origin_country is still a free-form name gets rewritten to the
// ISO code we can now recognise. Idempotent — safe to re-run.
// Returns number of contacts touched.
// ──────────────────────────────────────────────────────────────
export async function backfillContactCountries(): Promise<number> {
  const rows = await prisma.contact.findMany({
    select: {
      id: true,
      country: true,
      met_country: true,
      origin_country: true,
    },
  });

  let touched = 0;
  for (const r of rows) {
    const update: Record<string, string | null> = {};
    const countryIso = normalizeCountry(r.country);
    if (r.country && countryIso && r.country !== countryIso) {
      update.country = countryIso;
    }
    const metIso = normalizeCountry(r.met_country);
    if (r.met_country && metIso && r.met_country !== metIso) {
      update.met_country = metIso;
    } else if (r.met_country && !metIso && r.met_country.length > 2) {
      // couldn't normalize — drop obviously non-ISO strings so they
      // don't masquerade as country codes elsewhere.
      update.met_country = null;
    }
    const originIso = normalizeCountry(r.origin_country);
    if (r.origin_country && originIso && r.origin_country !== originIso) {
      update.origin_country = originIso;
    } else if (
      r.origin_country &&
      !originIso &&
      r.origin_country.length > 2
    ) {
      update.origin_country = null;
    }

    if (Object.keys(update).length > 0) {
      await prisma.contact.update({ where: { id: r.id }, data: update });
      touched++;
    }
  }
  return touched;
}
