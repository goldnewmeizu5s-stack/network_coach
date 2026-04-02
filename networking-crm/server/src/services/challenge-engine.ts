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

interface ChallengeData {
  title: string;
  description: string;
  category: string;
  difficulty: number;
  methodology_reference: string | null;
  estimated_time_minutes: number;
}

function todayRange(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
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

  // Category breakdown
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
    completion_rate_7d: total7 > 0 ? Math.round((completed7 / total7) * 100) : 50,
    completion_rate_14d: total14 > 0 ? Math.round((completed14 / total14) * 100) : 50,
    completion_rate_30d: all30 > 0 ? Math.round((completed30 / all30) * 100) : 50,
    last5,
    skippedCategories: skippedCategories.map((s) => s.category),
    tooHardCategories: tooHardRecent.map((c) => c.category),
    lastTooHard: tooHardRecent.length > 0,
  };
}

function calculateDifficulty(stats: Awaited<ReturnType<typeof getChallengeStats>>): number {
  let diff = 5;
  const rate = stats.completion_rate_7d;

  if (rate > 90) diff += 2;
  else if (rate > 80) diff += 1;
  else if (rate < 20) diff -= 3;
  else if (rate < 40) diff -= 2;

  if (stats.lastTooHard) diff -= 2;

  return Math.max(1, Math.min(10, diff));
}

export async function generateDailyChallenge(): Promise<ReturnType<typeof prisma.challenge.create>> {
  const user = await prisma.user.findFirst({
    select: { goals: true, fears: true, weaknesses: true },
  });

  const stats = await getChallengeStats();
  const difficulty = calculateDifficulty(stats);

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

  // Get relevant methodologies
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

  // Validate category
  if (!CATEGORIES.includes(challengeData.category)) {
    challengeData.category = "mindset";
  }

  // Find methodology
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
      methodology_id: methodologyId,
      status: "pending",
    },
  });
}

export async function generateAlternativeChallenges(): Promise<
  Awaited<ReturnType<typeof prisma.challenge.create>>[]
> {
  // Generate 2 simpler alternatives with different categories
  const stats = await getChallengeStats();
  const mainDiff = calculateDifficulty(stats);
  const recentCategories = stats.last5.slice(0, 3).map((c) => c.category);

  const availableCategories = CATEGORIES.filter(
    (c) => !recentCategories.includes(c)
  );

  const alternatives = [];
  for (let i = 0; i < 2; i++) {
    const cat =
      availableCategories[i % availableCategories.length] || CATEGORIES[i];
    const diff = Math.max(1, Math.min(10, mainDiff + (i === 0 ? -1 : 1)));
    const fallback = getFallbackChallenge(diff, cat);

    const challenge = await prisma.challenge.create({
      data: {
        date: new Date(),
        title: fallback.title,
        description: fallback.description,
        category: fallback.category,
        difficulty: diff,
        status: "pending",
      },
    });
    alternatives.push(challenge);
  }

  return alternatives;
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

  // Pick one matching category if specified, otherwise closest difficulty
  let selected: ChallengeData;
  if (category) {
    selected =
      templates.find((t) => t.category === category) ||
      templates[Math.floor(Math.random() * templates.length)];
  } else {
    // Sort by distance to target difficulty
    templates.sort(
      (a, b) =>
        Math.abs(a.difficulty - difficulty) -
        Math.abs(b.difficulty - difficulty)
    );
    selected = templates[0];
  }

  return { ...selected, difficulty };
}
