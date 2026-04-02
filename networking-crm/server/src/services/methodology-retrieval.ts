import prisma from "../lib/prisma";

interface MethodologyResult {
  id: string;
  source: string;
  title: string;
  core_principle: string;
  application_steps: string | null;
  when_to_use: string | null;
}

export async function getRelevantMethodologies(
  query: string,
  limit = 3
): Promise<MethodologyResult[]> {
  // Extract keywords from query (3+ chars, lowercase)
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  if (keywords.length === 0) return [];

  // First: try matching by tags
  const byTags = await prisma.methodology.findMany({
    where: {
      tags: { hasSome: keywords },
    },
    select: {
      id: true,
      source: true,
      title: true,
      core_principle: true,
      application_steps: true,
      when_to_use: true,
    },
    take: limit,
  });

  if (byTags.length >= limit) return byTags.slice(0, limit);

  // Fallback: search in full_text and title
  const remaining = limit - byTags.length;
  const existingIds = byTags.map((m) => m.id);

  const byText = await prisma.methodology.findMany({
    where: {
      id: { notIn: existingIds },
      OR: keywords.flatMap((kw) => [
        { full_text: { contains: kw, mode: "insensitive" as const } },
        { title: { contains: kw, mode: "insensitive" as const } },
        { core_principle: { contains: kw, mode: "insensitive" as const } },
      ]),
    },
    select: {
      id: true,
      source: true,
      title: true,
      core_principle: true,
      application_steps: true,
      when_to_use: true,
    },
    take: remaining,
  });

  return [...byTags, ...byText].slice(0, limit);
}

export function formatMethodologiesForPrompt(
  methodologies: MethodologyResult[]
): string {
  if (methodologies.length === 0) return "No specific methodologies matched.";

  return methodologies
    .map((m) => {
      const lines = [
        `- "${m.title}" (Source: ${m.source})`,
        `  Principle: ${m.core_principle}`,
        m.application_steps && `  Steps: ${m.application_steps}`,
        m.when_to_use && `  When to use: ${m.when_to_use}`,
      ]
        .filter(Boolean)
        .join("\n");
      return lines;
    })
    .join("\n");
}
