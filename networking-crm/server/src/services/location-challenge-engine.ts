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

const DATING_PROBABILITY = 0.12;

type Tier = "quick" | "normal" | "stretch";

interface LocationChallengeData {
  tier: Tier;
  title: string;
  description: string;
  category: string;
  difficulty: number;
  estimated_time_minutes: number;
  context_tags: string[];
  dating_flavor: boolean;
  methodology_reference: string | null;
}

interface GenerateOpts {
  context: string;
  transcriptSource?: "text" | "voice";
  forceDating?: boolean; // Only used for tests/debug. Real flow uses probability.
}

function rollDatingFlavor(forced?: boolean): boolean {
  if (forced !== undefined) return forced;
  return Math.random() < DATING_PROBABILITY;
}

function clampDifficulty(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

async function getBaselineDifficulty(): Promise<number> {
  const completed = await prisma.challenge.findMany({
    where: { status: "completed" },
    orderBy: { completed_at: "desc" },
    select: { difficulty: true },
    take: 5,
  });
  if (completed.length === 0) return 3;
  const avg =
    completed.reduce((sum, c) => sum + c.difficulty, 0) / completed.length;
  return clampDifficulty(avg);
}

export async function generateLocationChallenges(
  opts: GenerateOpts
): Promise<Awaited<ReturnType<typeof prisma.challenge.create>>[]> {
  const context = opts.context.trim();
  if (!context) throw new Error("Empty location context");

  const user = await prisma.user.findFirst({
    select: { goals: true, fears: true, weaknesses: true },
  });

  const baseline = await getBaselineDifficulty();
  const quickDiff = Math.max(1, baseline - 2);
  const normalDiff = baseline;
  const stretchDiff = Math.min(10, baseline + 2);

  const datingRolls = [
    rollDatingFlavor(opts.forceDating),
    rollDatingFlavor(opts.forceDating),
    rollDatingFlavor(opts.forceDating),
  ];

  const datingHint = datingRolls.some((r) => r)
    ? `\nDATING-FLAVOR ASSIGNMENTS (${datingRolls
        .map((r, i) => `${["quick", "normal", "stretch"][i]}:${r ? "YES" : "no"}`)
        .join(", ")}): For each tier marked YES, the challenge should create a NATURAL (not pickup-artist) opportunity for the user to meet a girl relevant to the described location. NO cheesy approaches. Keep it human, low-pressure — e.g. "sit near the trail viewpoint, offer your spare granola bar if someone takes a break next to you" or "at the bar, ask the bartender a genuine question while the person next to you can overhear". NO touching, NO flirting scripts, NO "confidence games". The dating-flavor should feel like a SIDE EFFECT of being present, not the goal. The primary goal is still networking/being open.`
    : "";

  const methodologies = await getRelevantMethodologies(
    [user?.goals, "networking", context].filter(Boolean).join(" "),
    3
  );

  const prompt = `The user tells you where they are RIGHT NOW and what they're doing. Generate 3 hyper-specific networking challenges tailored to that exact context.

USER CONTEXT (${opts.transcriptSource === "voice" ? "transcribed from voice" : "typed"}):
"""
${context}
"""

USER PROFILE:
Goals: ${user?.goals || "Not specified"}
Fears: ${user?.fears || "Not specified"}
Weaknesses: ${user?.weaknesses || "Not specified"}

BASELINE DIFFICULTY (from past completions): ${baseline}/10
${datingHint}

RELEVANT METHODOLOGIES:
${formatMethodologiesForPrompt(methodologies)}

RULES FOR LOCATION-AWARE GENERATION:
1. READ the context carefully. Identify: the physical environment, who is likely around (solo travellers, groups, staff, locals, tourists, other hikers, bar patrons, gym-goers, etc.), time of day if mentioned, mood if mentioned.
2. Each challenge must reference SPECIFICS from the context. NOT generic advice. Example: if user says "I'm hiking in Patagonia" — mention the trail, weather, common hiker behavior, refugios, viewpoints. If user says "I'm at a craft-beer bar" — mention the bartender, the tap list, people sitting at the bar vs. tables.
3. Challenges must be DOABLE in the described place within the next 1-60 minutes.
4. Each tier must have a DIFFERENT category.
5. Tone: encouraging coach, natural, NEVER awkward pickup-artist.
6. Write in Russian (same as user's profile language).
7. context_tags: 2-5 short lowercase English tags describing the environment (e.g. ["hiking", "outdoor", "solo_travellers"]).

Generate exactly 3 challenges:

1. ⚡ QUICK (micro, ${quickDiff}/10, 1-5 min): tiny low-barrier action right in this context.
2. 🎯 NORMAL (${normalDiff}/10, 5-20 min): meaningful but achievable interaction in this context.
3. 🔥 STRETCH (${stretchDiff}/10, 15-45 min): ambitious open-ended challenge fitting this context.

Return JSON array of exactly 3 objects — NO markdown fences, NO commentary:
[
  {
    "tier": "quick",
    "title": "short catchy title (5-8 words, Russian)",
    "description": "specific instructions referencing the context (2-4 sentences, Russian)",
    "category": "one of: conversation, follow_up, digital, skill, mindset, stretch",
    "difficulty": <number 1-10>,
    "estimated_time_minutes": <number>,
    "context_tags": ["tag1", "tag2"],
    "dating_flavor": <boolean — MUST match the assignment above>,
    "methodology_reference": "title or null"
  },
  { "tier": "normal", ... },
  { "tier": "stretch", ... }
]`;

  let data: LocationChallengeData[];
  try {
    const response = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const match = text.match(/\[[\s\S]*\]/);
    data = match ? JSON.parse(match[0]) : [];
    if (!Array.isArray(data) || data.length < 3) {
      throw new Error("Invalid AI response for location challenges");
    }
  } catch (err) {
    logger.error("Location challenges Claude error, using fallbacks", {
      error: String(err),
    });
    data = getLocationFallbacks(context, quickDiff, normalDiff, stretchDiff, datingRolls);
  }

  const methodologyMap = new Map<string, string>();
  for (const m of methodologies) methodologyMap.set(m.title.toLowerCase(), m.id);

  const tierOrder: Tier[] = ["quick", "normal", "stretch"];
  const tierDiffs = [quickDiff, normalDiff, stretchDiff];
  const results: Awaited<ReturnType<typeof prisma.challenge.create>>[] = [];

  for (let i = 0; i < 3; i++) {
    const d = data[i] || {} as LocationChallengeData;
    const tier = tierOrder[i];
    const targetDiff = tierDiffs[i];
    const diff = clampDifficulty(d.difficulty || targetDiff);
    const cat =
      d.category && CATEGORIES.includes(d.category)
        ? d.category
        : CATEGORIES[i % CATEGORIES.length];

    let methodologyId: string | null = null;
    if (d.methodology_reference) {
      const ref = d.methodology_reference.toLowerCase();
      for (const [title, id] of methodologyMap) {
        if (title.includes(ref) || ref.includes(title)) {
          methodologyId = id;
          break;
        }
      }
    }

    const tags = Array.isArray(d.context_tags)
      ? d.context_tags.filter((t) => typeof t === "string").slice(0, 8)
      : [];

    const challenge = await prisma.challenge.create({
      data: {
        date: new Date(),
        title: d.title || `Челлендж под локацию (${tier})`,
        description: d.description || context,
        category: cat,
        difficulty: diff,
        tier,
        estimated_time_minutes: d.estimated_time_minutes || null,
        methodology_id: methodologyId,
        status: "pending",
        is_location_based: true,
        location_context: context,
        context_tags: tags,
        dating_flavor: Boolean(d.dating_flavor) || datingRolls[i],
      },
    });
    results.push(challenge);
  }

  return results;
}

function getLocationFallbacks(
  context: string,
  quickDiff: number,
  normalDiff: number,
  stretchDiff: number,
  datingRolls: boolean[]
): LocationChallengeData[] {
  return [
    {
      tier: "quick",
      title: "Подмечай детали вокруг",
      description: `Оглядись там, где ты сейчас (${context.slice(0, 60)}). Найди одного человека поблизости — заметь одну деталь о нём/ней (книга, рюкзак, татуировка, что-то из одежды). Цель — просто включить наблюдательность.`,
      category: "mindset",
      difficulty: quickDiff,
      estimated_time_minutes: 3,
      context_tags: ["awareness"],
      dating_flavor: datingRolls[0],
      methodology_reference: null,
    },
    {
      tier: "normal",
      title: "Заговори с кем-то рядом",
      description: `В том месте, где ты находишься, найди момент и заговори с одним человеком. Начни с естественного повода — вопрос по месту, комментарий о происходящем, мелкая просьба. Не ставь цель познакомиться — просто короткий человеческий обмен.`,
      category: "conversation",
      difficulty: normalDiff,
      estimated_time_minutes: 10,
      context_tags: ["local_interaction"],
      dating_flavor: datingRolls[1],
      methodology_reference: null,
    },
    {
      tier: "stretch",
      title: "Полноценный разговор на месте",
      description: `Останься в этом месте подольше и выстрой один полноценный разговор (10+ минут) с кем-то, кого встретил здесь. Задай 2-3 открытых вопроса, послушай, расскажи о себе. Если сложилось — обменяйся контактом.`,
      category: "stretch",
      difficulty: stretchDiff,
      estimated_time_minutes: 30,
      context_tags: ["deep_conversation"],
      dating_flavor: datingRolls[2],
      methodology_reference: null,
    },
  ];
}

// Apply dating probability roll to the regular daily challenges
// Called AFTER they're generated — rolls per-challenge and tags them if lucky.
export async function applyDatingFlavorRoll(
  challengeIds: string[]
): Promise<void> {
  for (const id of challengeIds) {
    if (Math.random() < DATING_PROBABILITY) {
      await prisma.challenge.update({
        where: { id },
        data: { dating_flavor: true },
      });
    }
  }
}
