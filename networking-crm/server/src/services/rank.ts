import prisma from "../lib/prisma";

// ──────────────────────────────────────────────────────────────
// Rank system — "Погоны Нетворкера"
// 16 ranks from Рядовой (recruit) to Маршал Нетворкинга (supreme).
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
  OM: "AS", CN: "AS", JP: "AS", KR: "AS", IN: "AS", TH: "AS", VN: "AS",
  ID: "AS", MY: "AS", SG: "AS", PH: "AS", LK: "AS", MM: "AS", NP: "AS",
  PK: "AS", BD: "AS", TW: "AS", HK: "AS", MN: "AS",
  EG: "AF", MA: "AF", TN: "AF", ZA: "AF", NG: "AF", KE: "AF",
  US: "NA", CA: "NA", MX: "NA",
  BR: "SA", AR: "SA", CL: "SA", CO: "SA", PE: "SA",
  AU: "OC", NZ: "OC",
};

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
  country_codes: string[];
  continent_codes: string[];
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

// Count days with at least one activity (new contact, done follow-up,
// completed challenge, or interaction) ending today. Streak breaks the
// first day with zero activity.
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
      },
    }),
    prisma.interaction.count(),
    prisma.challenge.findMany({
      where: { status: "completed" },
      select: { xp_earned: true, difficulty: true },
    }),
    prisma.followUp.count({ where: { status: "done" } }),
    prisma.contact.count({
      where: {
        warmth_status: { in: ["warm", "close"] },
      },
    }),
    prisma.contact.aggregate({
      _avg: { warmth_score: true },
      where: { warmth_status: { not: "archived" } },
    }),
    computeStreak(),
  ]);

  // ── Categories ────────────────────────────────────────────────
  // 1. Discipline — challenges + streak
  const challengeXp = completedChallenges.reduce(
    (s, c) => s + (c.xp_earned || 0) + (c.difficulty || 0) * 5,
    0,
  );
  const streakXp = streak * 10;
  const disciplineXp = challengeXp + streakXp;

  // 2. Reach — number of contacts
  const totalContacts = contacts.length;
  const reachXp =
    totalContacts * 20 + Math.floor(totalContacts / 10) * 100;

  // 3. Conversation — interactions + done follow-ups
  const conversationXp =
    interactionCount * 8 + completedFollowUps * 25;

  // 4. Six degrees — unique countries/continents from any of the 3 country
  // fields (country, met_country, origin_country).
  const countryCodes = new Set<string>();
  for (const c of contacts) {
    for (const raw of [c.country, c.met_country, c.origin_country]) {
      if (!raw) continue;
      const code = raw.toUpperCase().trim();
      if (code.length === 2) countryCodes.add(code);
    }
  }
  const continentCodes = new Set<string>();
  for (const code of countryCodes) {
    const cont = CONTINENT_BY_CC[code];
    if (cont) continentCodes.add(cont);
  }
  const sixDegreesXp =
    countryCodes.size * 120 + continentCodes.size * 250;

  // 5. Warmth — quality of relationships
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
        "Теория шести рукопожатий: чем больше стран и континентов в сети, тем ближе к тебе мир",
      breakdown: [
        { label: "Уникальных стран", value: countryCodes.size },
        { label: "Континентов", value: continentCodes.size },
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
      country_codes: Array.from(countryCodes).sort(),
      continent_codes: Array.from(continentCodes).sort(),
    },
    totals: {
      contacts: totalContacts,
      interactions: interactionCount,
      completed_challenges: completedChallenges.length,
      completed_followups: completedFollowUps,
      streak_days: streak,
      warm_or_close_contacts: warmClose,
      avg_warmth: Math.round(avg),
    },
  };
}
