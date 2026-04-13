import { anthropic } from "../lib/ai";
import { config } from "../config";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import {
  getRelevantMethodologies,
  formatMethodologiesForPrompt,
} from "./methodology-retrieval";

const CATEGORIES = [
  "conversation",
  "follow_up",
  "digital",
  "skill",
  "mindset",
  "stretch",
];

type Tier = "quick" | "normal" | "stretch";

interface ChallengeData {
  title: string;
  description: string;
  category: string;
  difficulty: number;
  methodology_reference: string | null;
  estimated_time_minutes: number;
}

interface FlexibleChallengeData extends ChallengeData {
  tier: Tier;
}

function todayRange(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

// ── Proven Level ─────────────────────────────────────────
// Instead of assuming base 5, we look at what the user ACTUALLY completed.

async function getUserProvenLevel(): Promise<{
  level: number;
  totalCompleted: number;
  daysSinceLastCompletion: number | null;
  recentCompletedDifficulties: number[];
}> {
  // Get all completed challenges, most recent first
  const completed = await prisma.challenge.findMany({
    where: { status: "completed" },
    orderBy: { completed_at: "desc" },
    select: { difficulty: true, completed_at: true },
    take: 20,
  });

  if (completed.length === 0) {
    return {
      level: 2, // Start easy if never completed anything
      totalCompleted: 0,
      daysSinceLastCompletion: null,
      recentCompletedDifficulties: [],
    };
  }

  const totalCompleted = await prisma.challenge.count({
    where: { status: "completed" },
  });

  // Days since last completion
  const lastCompletion = completed[0].completed_at;
  const daysSinceLastCompletion = lastCompletion
    ? Math.floor((Date.now() - lastCompletion.getTime()) / 86400000)
    : null;

  // Recent completed difficulties (last 10)
  const recentDifficulties = completed.slice(0, 10).map((c) => c.difficulty);

  // Proven level = average of last 5 completed, rounded
  const last5 = recentDifficulties.slice(0, 5);
  const avgDifficulty = Math.round(
    last5.reduce((sum, d) => sum + d, 0) / last5.length
  );

  // If user has been away for a while, scale back
  let level = avgDifficulty;
  if (daysSinceLastCompletion !== null) {
    if (daysSinceLastCompletion >= 21) {
      // 3+ weeks away: drop significantly
      level = Math.max(1, avgDifficulty - 3);
    } else if (daysSinceLastCompletion >= 14) {
      // 2+ weeks away: drop moderately
      level = Math.max(1, avgDifficulty - 2);
    } else if (daysSinceLastCompletion >= 7) {
      // 1+ week away: drop slightly
      level = Math.max(1, avgDifficulty - 1);
    }
  }

  // If very few completions overall, keep it easier
  if (totalCompleted < 3) {
    level = Math.min(level, 3);
  } else if (totalCompleted < 7) {
    level = Math.min(level, 5);
  }

  return {
    level: Math.max(1, Math.min(10, level)),
    totalCompleted,
    daysSinceLastCompletion,
    recentCompletedDifficulties: recentDifficulties,
  };
}

async function getChallengeStats() {
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86400000);
  const d14 = new Date(now.getTime() - 14 * 86400000);
  const d30 = new Date(now.getTime() - 30 * 86400000);

  const [all30, completed7, completed14, completed30, last5, tooHardRecent] =
    await Promise.all([
      prisma.challenge.count({ where: { date: { gte: d30 } } }),
      prisma.challenge.count({
        where: { date: { gte: d7 }, status: "completed" },
      }),
      prisma.challenge.count({
        where: { date: { gte: d14 }, status: "completed" },
      }),
      prisma.challenge.count({
        where: { date: { gte: d30 }, status: "completed" },
      }),
      prisma.challenge.findMany({
        orderBy: { date: "desc" },
        take: 5,
        select: {
          title: true,
          category: true,
          status: true,
          difficulty: true,
        },
      }),
      prisma.challenge.findMany({
        where: { status: "too_hard", date: { gte: d7 } },
        select: { category: true },
      }),
    ]);

  const skippedCategories = await prisma.challenge.groupBy({
    by: ["category"],
    where: { date: { gte: d30 }, status: { in: ["skipped", "too_hard"] } },
    _count: true,
  });

  const total7 = await prisma.challenge.count({
    where: { date: { gte: d7 } },
  });
  const total14 = await prisma.challenge.count({
    where: { date: { gte: d14 } },
  });

  return {
    completion_rate_7d: total7 > 0 ? Math.round((completed7 / total7) * 100) : 0,
    completion_rate_14d: total14 > 0 ? Math.round((completed14 / total14) * 100) : 0,
    completion_rate_30d: all30 > 0 ? Math.round((completed30 / all30) * 100) : 0,
    last5,
    skippedCategories: skippedCategories.map((s) => s.category),
    tooHardCategories: tooHardRecent.map((c) => c.category),
    lastTooHard: tooHardRecent.length > 0,
  };
}

async function getDifficultyAdjustment(): Promise<number> {
  const user = await prisma.user.findFirst();
  if (!user) return 0;
  const prefs = (user.preferences as Record<string, unknown>) || {};
  return (prefs.difficulty_adjustment as number) || 0;
}

function calculateDifficulty(
  provenLevel: number,
  stats: Awaited<ReturnType<typeof getChallengeStats>>,
  adjustment: number = 0
): number {
  // Start from proven level (not hardcoded 5)
  let diff = provenLevel;

  // Fine-tune based on recent 7-day rate (smaller adjustments since base is already smart)
  const rate = stats.completion_rate_7d;
  if (rate > 90) diff += 1;
  else if (rate < 20 && rate > 0) diff -= 1;

  // Immediate reaction to "too hard"
  if (stats.lastTooHard) diff -= 2;

  // Apply user preference adjustment
  diff += adjustment;

  return Math.max(1, Math.min(10, diff));
}

// ── Flexible Challenge Generation ────────────────────────
// Generates 3 tiers: quick (micro), normal, stretch

export async function generateFlexibleChallenges(): Promise<
  Awaited<ReturnType<typeof prisma.challenge.create>>[]
> {
  const user = await prisma.user.findFirst({
    select: { goals: true, fears: true, weaknesses: true },
  });

  const [stats, proven, adjustment] = await Promise.all([
    getChallengeStats(),
    getUserProvenLevel(),
    getDifficultyAdjustment(),
  ]);

  const normalDiff = calculateDifficulty(proven.level, stats, adjustment);
  const quickDiff = Math.max(1, normalDiff - 2);
  const stretchDiff = Math.min(10, normalDiff + 2);

  // CRM state for context
  const [newCount, coolingContacts, pendingFu, neglected] = await Promise.all([
    prisma.contact.count({ where: { warmth_status: "new" } }),
    prisma.contact.findMany({
      where: { warmth_status: "cooling" },
      select: { full_name: true },
      take: 3,
    }),
    prisma.followUp.count({ where: { status: "pending" } }),
    prisma.contact.findMany({
      where: {
        warmth_status: { notIn: ["archived", "paused"] },
        last_interaction_at: {
          lt: new Date(Date.now() - 30 * 86400000),
        },
      },
      select: { full_name: true, last_interaction_at: true },
      take: 3,
    }),
  ]);

  const query = [user?.goals, user?.fears, "networking", stats.last5[0]?.category]
    .filter(Boolean)
    .join(" ");
  const methodologies = await getRelevantMethodologies(query, 3);

  const last5Text = stats.last5
    .map(
      (c) =>
        `- ${c.title} (${c.category}, difficulty: ${c.difficulty}, status: ${c.status})`
    )
    .join("\n");

  const neglectedText = neglected
    .map((c) => {
      const days = c.last_interaction_at
        ? Math.round(
            (Date.now() - c.last_interaction_at.getTime()) / 86400000
          )
        : "never";
      return `${c.full_name} (${days} days)`;
    })
    .join(", ");

  // Inactivity context for the prompt
  let inactivityNote = "";
  if (proven.daysSinceLastCompletion === null) {
    inactivityNote =
      "⚠️ User has NEVER completed a challenge. Make all 3 options very approachable and low-pressure. The quick option should take literally 1-2 minutes.";
  } else if (proven.daysSinceLastCompletion >= 7) {
    inactivityNote = `⚠️ User hasn't completed a challenge in ${proven.daysSinceLastCompletion} days. They're coming back after a break. Be extra welcoming, don't guilt-trip, make the quick option trivially easy to rebuild the habit.`;
  }

  const prompt = `Generate 3 networking challenges at different difficulty tiers for the user.

The user should be able to CHOOSE between an easy quick-win, a normal challenge, and an ambitious stretch goal.

USER PROFILE:
Goals: ${user?.goals || "Not specified"}
Fears: ${user?.fears || "Not specified"}
Weaknesses: ${user?.weaknesses || "Not specified"}

USER LEVEL:
Total challenges completed: ${proven.totalCompleted}
Days since last completion: ${proven.daysSinceLastCompletion ?? "never completed"}
Proven difficulty level: ${proven.level}/10
Recent completed difficulties: ${proven.recentCompletedDifficulties.join(", ") || "none"}
${inactivityNote}

RECENT CHALLENGE HISTORY:
${last5Text || "No recent challenges"}
Completion rate (7 days): ${stats.completion_rate_7d}%
Most skipped categories: ${stats.skippedCategories.join(", ") || "none"}
Categories marked "too hard": ${stats.tooHardCategories.join(", ") || "none"}

CURRENT CRM STATE:
New contacts: ${newCount}
Cooling contacts: ${coolingContacts.map((c) => c.full_name).join(", ") || "none"}
Pending follow-ups: ${pendingFu}
Most neglected: ${neglectedText || "none"}

RELEVANT METHODOLOGIES:
${formatMethodologiesForPrompt(methodologies)}

Generate exactly 3 challenges:

1. ⚡ QUICK (micro-challenge):
   - Difficulty: ${quickDiff}/10
   - Time: 1-5 minutes MAX
   - Should be almost impossible to NOT do. Super low barrier.
   - Examples: send one emoji reaction, read one post, write down one name
   - This is for building habit, not pushing limits

2. 🎯 NORMAL (standard):
   - Difficulty: ${normalDiff}/10
   - Time: 5-20 minutes
   - A meaningful but achievable challenge
   - Good balance of effort and reward

3. 🔥 STRETCH (ambitious):
   - Difficulty: ${stretchDiff}/10
   - Time: 15-45 minutes
   - Pushes comfort zone, bigger reward
   - Something to be proud of completing

RULES:
- Each challenge must have a DIFFERENT category
- Do NOT repeat same categories as last 3 days
- Reference specific contacts from CRM when relevant
- Reference methodologies when applicable
- Tone: encouraging coach, NEVER guilt-tripping
- If user never completed anything, make quick option TRIVIALLY easy (1 min)
- estimated_time_minutes must be realistic for each tier

Return a JSON array of exactly 3 objects:
[
  {
    "tier": "quick",
    "title": "short catchy title (5-8 words)",
    "description": "specific instructions (2-3 sentences)",
    "category": "one of: conversation, follow_up, digital, skill, mindset, stretch",
    "difficulty": <number 1-10>,
    "methodology_reference": "which methodology or null",
    "estimated_time_minutes": <number>
  },
  { "tier": "normal", ... },
  { "tier": "stretch", ... }
]

Write in the same language as the user's profile (default: Russian).`;

  let challengeDataList: FlexibleChallengeData[];
  try {
    const response = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const match = text.match(/\[[\s\S]*\]/);
    challengeDataList = match ? JSON.parse(match[0]) : [];

    if (!Array.isArray(challengeDataList) || challengeDataList.length < 3) {
      throw new Error("Invalid AI response for flexible challenges");
    }
  } catch (err) {
    logger.error("Flexible challenges Claude error, using fallbacks", {
      error: String(err),
    });
    challengeDataList = getFlexibleFallbacks(quickDiff, normalDiff, stretchDiff);
  }

  // Resolve methodologies
  const methodologyMap = new Map<string, string>();
  for (const m of methodologies) {
    methodologyMap.set(m.title.toLowerCase(), m.id);
  }

  const results = [];
  const tierOrder: Tier[] = ["quick", "normal", "stretch"];
  const tierDiffs = [quickDiff, normalDiff, stretchDiff];

  for (let i = 0; i < 3; i++) {
    const data = challengeDataList[i];
    const tier = tierOrder[i];
    const targetDiff = tierDiffs[i];
    const diff = Math.max(1, Math.min(10, data?.difficulty || targetDiff));
    const cat = data && CATEGORIES.includes(data.category)
      ? data.category
      : CATEGORIES[i % CATEGORIES.length];

    let methodologyId: string | null = null;
    if (data?.methodology_reference) {
      const ref = data.methodology_reference.toLowerCase();
      for (const [title, id] of methodologyMap) {
        if (title.includes(ref) || ref.includes(title)) {
          methodologyId = id;
          break;
        }
      }
    }

    const challenge = await prisma.challenge.create({
      data: {
        date: new Date(),
        title: data?.title || getFlexibleFallbacks(quickDiff, normalDiff, stretchDiff)[i].title,
        description: data?.description || getFlexibleFallbacks(quickDiff, normalDiff, stretchDiff)[i].description,
        category: cat,
        difficulty: diff,
        tier,
        estimated_time_minutes: data?.estimated_time_minutes || null,
        methodology_id: methodologyId,
        status: "pending",
      },
    });
    results.push(challenge);
  }

  return results;
}

function getFlexibleFallbacks(
  quickDiff: number,
  normalDiff: number,
  stretchDiff: number
): FlexibleChallengeData[] {
  return [
    {
      tier: "quick",
      title: "Поставь реакцию на пост",
      description:
        "Зайди в любую соцсеть и поставь осмысленную реакцию или лайк на пост кого-то из твоей сети. Одно действие — 30 секунд.",
      category: "digital",
      difficulty: quickDiff,
      methodology_reference: null,
      estimated_time_minutes: 2,
    },
    {
      tier: "normal",
      title: "Напиши одному знакомому",
      description:
        "Выбери одного контакта, с которым давно не общался, и отправь ему короткое сообщение. Не обязательно деловое — просто дай знать, что помнишь.",
      category: "follow_up",
      difficulty: normalDiff,
      methodology_reference: null,
      estimated_time_minutes: 10,
    },
    {
      tier: "stretch",
      title: "Познакомь двух людей",
      description:
        "Подумай, кого из твоей сети стоит познакомить друг с другом. Напиши обоим и предложи связать. Это создаёт ценность для всех.",
      category: "stretch",
      difficulty: stretchDiff,
      methodology_reference: null,
      estimated_time_minutes: 25,
    },
  ];
}

// ── Legacy functions (kept for API routes compatibility) ──

export async function generateDailyChallenge(): Promise<ReturnType<typeof prisma.challenge.create>> {
  const user = await prisma.user.findFirst({
    select: { goals: true, fears: true, weaknesses: true },
  });

  const [stats, proven, adjustment] = await Promise.all([
    getChallengeStats(),
    getUserProvenLevel(),
    getDifficultyAdjustment(),
  ]);
  const difficulty = calculateDifficulty(proven.level, stats, adjustment);

  // CRM state
  const [newCount, coolingContacts, pendingFu, neglected] = await Promise.all([
    prisma.contact.count({ where: { warmth_status: "new" } }),
    prisma.contact.findMany({
      where: { warmth_status: "cooling" },
      select: { full_name: true },
      take: 3,
    }),
    prisma.followUp.count({ where: { status: "pending" } }),
    prisma.contact.findMany({
      where: {
        warmth_status: { notIn: ["archived", "paused"] },
        last_interaction_at: {
          lt: new Date(Date.now() - 30 * 86400000),
        },
      },
      select: { full_name: true, last_interaction_at: true },
      take: 3,
    }),
  ]);

  const query = [
    user?.goals,
    user?.fears,
    "networking",
    stats.last5[0]?.category,
  ]
    .filter(Boolean)
    .join(" ");
  const methodologies = await getRelevantMethodologies(query, 3);

  const last5Text = stats.last5
    .map(
      (c) =>
        `- ${c.title} (${c.category}, difficulty: ${c.difficulty}, status: ${c.status})`
    )
    .join("\n");

  const neglectedText = neglected
    .map((c) => {
      const days = c.last_interaction_at
        ? Math.round(
            (Date.now() - c.last_interaction_at.getTime()) / 86400000
          )
        : "never";
      return `${c.full_name} (${days} days)`;
    })
    .join(", ");

  const prompt = `Generate a daily networking challenge for the user.

USER PROFILE:
Goals: ${user?.goals || "Not specified"}
Fears: ${user?.fears || "Not specified"}
Weaknesses: ${user?.weaknesses || "Not specified"}

RECENT CHALLENGE HISTORY:
${last5Text || "No recent challenges"}
Completion rate (7 days): ${stats.completion_rate_7d}%
Most skipped categories: ${stats.skippedCategories.join(", ") || "none"}
Categories marked "too hard": ${stats.tooHardCategories.join(", ") || "none"}

CURRENT CRM STATE:
New contacts: ${newCount}
Cooling contacts: ${coolingContacts.map((c) => c.full_name).join(", ") || "none"}
Pending follow-ups: ${pendingFu}
Most neglected: ${neglectedText || "none"}

RELEVANT METHODOLOGIES:
${formatMethodologiesForPrompt(methodologies)}

TARGET DIFFICULTY: ${difficulty}/10

RULES:
- Generate ONE challenge
- Category must be one of: conversation, follow_up, digital, skill, mindset, stretch
- Do NOT repeat the same challenge type as the last 3 days
- If the user fears something specific, periodically include gentle challenges in that area (but not every day)
- Reference specific contacts from CRM when relevant ("Reach out to [Name]...")
- Reference the methodology that inspired this challenge
- Tone: encouraging coach, NEVER guilt-tripping
- If difficulty < 4: make it easy and fun
- If difficulty > 7: make it ambitious but achievable
- estimated_time_minutes should be realistic for the challenge

Return JSON:
{
  "title": "short catchy title (5-8 words)",
  "description": "detailed description with specific instructions (2-4 sentences)",
  "category": "one of the categories above",
  "difficulty": <number 1-10>,
  "methodology_reference": "which methodology inspired this (or null)",
  "estimated_time_minutes": <number>
}

Write in the same language as the user's profile (default: Russian).`;

  let challengeData: ChallengeData;
  try {
    const response = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const match = text.match(/\{[\s\S]*\}/);
    challengeData = match
      ? JSON.parse(match[0])
      : getFallbackChallenge(difficulty);
  } catch (err) {
    logger.error("Challenge generation Claude error", { error: String(err) });
    challengeData = getFallbackChallenge(difficulty);
  }

  if (!CATEGORIES.includes(challengeData.category)) {
    challengeData.category = "mindset";
  }

  let methodologyId: string | null = null;
  if (challengeData.methodology_reference && methodologies.length > 0) {
    const match = methodologies.find(
      (m) =>
        m.title
          .toLowerCase()
          .includes(
            (challengeData.methodology_reference || "").toLowerCase()
          ) ||
        (challengeData.methodology_reference || "")
          .toLowerCase()
          .includes(m.title.toLowerCase())
    );
    if (match) methodologyId = match.id;
  }

  return prisma.challenge.create({
    data: {
      date: new Date(),
      title: challengeData.title,
      description: challengeData.description,
      category: challengeData.category,
      difficulty: Math.max(1, Math.min(10, challengeData.difficulty)),
      estimated_time_minutes: challengeData.estimated_time_minutes || null,
      methodology_id: methodologyId,
      status: "pending",
    },
  });
}

export async function generateAlternativeChallenges(): Promise<
  Awaited<ReturnType<typeof prisma.challenge.create>>[]
> {
  const [stats, proven, adjustment] = await Promise.all([
    getChallengeStats(),
    getUserProvenLevel(),
    getDifficultyAdjustment(),
  ]);
  const mainDiff = calculateDifficulty(proven.level, stats, adjustment);
  const recentCategories = stats.last5.slice(0, 3).map((c) => c.category);

  const availableCategories = CATEGORIES.filter(
    (c) => !recentCategories.includes(c)
  );

  let challengeDataList: ChallengeData[];

  try {
    const prompt = `Generate 2 alternative networking challenges with DIFFERENT categories from these recent ones: ${recentCategories.join(", ") || "none"}.

Available categories: ${availableCategories.join(", ") || CATEGORIES.join(", ")}
Target difficulty range: ${Math.max(1, mainDiff - 1)} to ${Math.min(10, mainDiff + 1)}

Return a JSON array of exactly 2 objects, each with:
{
  "title": "short catchy title (5-8 words)",
  "description": "detailed description with specific instructions (2-4 sentences)",
  "category": "one of: conversation, follow_up, digital, skill, mindset, stretch",
  "difficulty": <number 1-10>,
  "methodology_reference": null,
  "estimated_time_minutes": <number>
}

Each challenge must have a DIFFERENT category. Write in Russian.`;

    const response = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const match = text.match(/\[[\s\S]*\]/);
    challengeDataList = match ? JSON.parse(match[0]) : [];

    if (!Array.isArray(challengeDataList) || challengeDataList.length < 2) {
      throw new Error("Invalid AI response");
    }
  } catch (err) {
    logger.error("Alternative challenges Claude error, using fallbacks", {
      error: String(err),
    });
    challengeDataList = [];
    for (let i = 0; i < 2; i++) {
      const cat =
        availableCategories[i % availableCategories.length] || CATEGORIES[i];
      const diff = Math.max(1, Math.min(10, mainDiff + (i === 0 ? -1 : 1)));
      challengeDataList.push(getFallbackChallenge(diff, cat));
    }
  }

  const alternatives = [];
  for (let i = 0; i < 2; i++) {
    const data = challengeDataList[i];
    const diff = Math.max(1, Math.min(10, data.difficulty || mainDiff));
    const cat = CATEGORIES.includes(data.category) ? data.category : (availableCategories[i] || "mindset");

    const challenge = await prisma.challenge.create({
      data: {
        date: new Date(),
        title: data.title,
        description: data.description,
        category: cat,
        difficulty: diff,
        estimated_time_minutes: data.estimated_time_minutes || null,
        status: "pending",
      },
    });
    alternatives.push(challenge);
  }

  return alternatives;
}

export async function generateBonusChallenge(): Promise<ReturnType<typeof prisma.challenge.create>> {
  const [stats, proven, adjustment] = await Promise.all([
    getChallengeStats(),
    getUserProvenLevel(),
    getDifficultyAdjustment(),
  ]);
  const baseDiff = calculateDifficulty(proven.level, stats, adjustment);
  // Bonus challenges are slightly harder and more creative
  const bonusDiff = Math.min(10, baseDiff + 2);

  let challengeData: ChallengeData;

  try {
    const prompt = `Generate a FUN BONUS networking challenge. This is an optional extra challenge, so make it creative and exciting!

Target difficulty: ${bonusDiff}/10

This should be something unusual, creative, or particularly rewarding. Examples:
- "Start a conversation with a stranger at a coffee shop"
- "Record a 1-min voice message thanking someone who helped you"
- "Find and connect with someone from a completely different field"

Return JSON:
{
  "title": "short catchy title (5-8 words)",
  "description": "detailed fun description (2-4 sentences)",
  "category": "one of: conversation, follow_up, digital, skill, mindset, stretch",
  "difficulty": <number 1-10>,
  "methodology_reference": null,
  "estimated_time_minutes": <number>
}

Write in Russian. Make it FUN and unusual!`;

    const response = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const match = text.match(/\{[\s\S]*\}/);
    challengeData = match
      ? JSON.parse(match[0])
      : getFallbackChallenge(bonusDiff, "stretch");
  } catch (err) {
    logger.error("Bonus challenge Claude error", { error: String(err) });
    challengeData = getFallbackChallenge(bonusDiff, "stretch");
  }

  if (!CATEGORIES.includes(challengeData.category)) {
    challengeData.category = "stretch";
  }

  return prisma.challenge.create({
    data: {
      date: new Date(),
      title: challengeData.title,
      description: challengeData.description,
      category: challengeData.category,
      difficulty: Math.max(1, Math.min(10, challengeData.difficulty)),
      estimated_time_minutes: challengeData.estimated_time_minutes || null,
      is_bonus: true,
      status: "pending",
    },
  });
}

function getFallbackChallenge(
  difficulty: number,
  category?: string
): ChallengeData {
  const templates: ChallengeData[] = [
    {
      title: "Напиши одному знакомому",
      description:
        "Выбери одного контакта, с которым давно не общался, и отправь ему короткое сообщение. Не обязательно деловое — просто дай знать, что помнишь.",
      category: "follow_up",
      difficulty: 3,
      methodology_reference: null,
      estimated_time_minutes: 5,
    },
    {
      title: "Прокомментируй 3 поста",
      description:
        "Зайди в LinkedIn или Telegram и оставь вдумчивые комментарии к 3 постам людей из твоей сети. Не лайк, а реальная мысль.",
      category: "digital",
      difficulty: 4,
      methodology_reference: null,
      estimated_time_minutes: 15,
    },
    {
      title: "Задай глубокий вопрос",
      description:
        "В следующем разговоре (или созвоне) задай собеседнику один неожиданный глубокий вопрос. Например: 'Что тебя больше всего удивило за последний месяц?'",
      category: "conversation",
      difficulty: 5,
      methodology_reference: null,
      estimated_time_minutes: 10,
    },
    {
      title: "Познакомь двух людей",
      description:
        "Подумай, кого из твоей сети стоит познакомить друг с другом. Напиши обоим и предложи связать.",
      category: "stretch",
      difficulty: 7,
      methodology_reference: null,
      estimated_time_minutes: 20,
    },
    {
      title: "Запиши аудио-заметку",
      description:
        "Вспомни последнюю интересную встречу и запиши голосовое на 2-3 минуты: кто этот человек, что зацепило, какой потенциал.",
      category: "skill",
      difficulty: 3,
      methodology_reference: null,
      estimated_time_minutes: 5,
    },
    {
      title: "Подумай о своём стиле общения",
      description:
        "Выдели 5 минут и запиши: какие 3 качества делают тебя хорошим собеседником? Что ты мог бы улучшить?",
      category: "mindset",
      difficulty: 4,
      methodology_reference: null,
      estimated_time_minutes: 10,
    },
  ];

  let selected: ChallengeData;
  if (category) {
    selected =
      templates.find((t) => t.category === category) ||
      templates[Math.floor(Math.random() * templates.length)];
  } else {
    templates.sort(
      (a, b) =>
        Math.abs(a.difficulty - difficulty) -
        Math.abs(b.difficulty - difficulty)
    );
    selected = templates[0];
  }

  return { ...selected, difficulty };
}
