// Shared types + grade ladder for the "Самураи пути" page.
//
// The senseis surfaced by the Growth Edge feature are rendered here as
// samurai masters of the user's path. The server returns raw growth-edge
// data; the client maps each sensei's `priority` to a samurai grade and
// renders a kamon crest for it.

export interface GrowthPlane {
  plane: string;
  why: string;
  how_to_absorb: string;
}

export interface Sensei {
  contact_id: string;
  full_name: string;
  occupation: string | null;
  company: string | null;
  photo_url: string | null;
  city: string | null;
  country: string | null;
  warmth_status: string;
  warmth_score: number;
  last_interaction_at: string | null;
  headline: string;
  planes: GrowthPlane[];
  chess_note: string | null;
  priority: number;
  analyzed_at: string;
}

export interface SenseiResponse {
  senseis: Sensei[];
}

// A samurai mastery grade. There are two ways to land in a grade:
//   - per-sensei: based on their growth-edge `priority` (how aggressive
//     to learn from them) — used only as a soft hint on the sensei card.
//   - for the user themselves: based on how much they've actually
//     absorbed (Pareto steps completed across their dojo) — that's the
//     real "путь самурая", and what drives the hero + mastery ladder.
export interface SamuraiGrade {
  index: number;
  title: string; // Russian-facing label
  subtitle: string; // short human description shown under the title
  priority_min: number;
  /** % of Pareto steps completed to enter this grade (user progression). */
  progress_min: number;
}

export const SAMURAI_GRADES: SamuraiGrade[] = [
  { index: 0, title: "Самурай",      subtitle: "Только встал на путь",            priority_min: 0,  progress_min: 0 },
  { index: 1, title: "Мечник",       subtitle: "Уже подражает мастерам",          priority_min: 30, progress_min: 12 },
  { index: 2, title: "Мастер",       subtitle: "Усваивает паттерны как свои",     priority_min: 50, progress_min: 30 },
  { index: 3, title: "Стратег",      subtitle: "Видит игру на несколько шагов",   priority_min: 70, progress_min: 55 },
  { index: 4, title: "Святой меча",  subtitle: "Сам стал наставником",            priority_min: 87, progress_min: 85 },
];

export function gradeForPriority(priority: number): SamuraiGrade {
  let grade = SAMURAI_GRADES[0];
  for (const g of SAMURAI_GRADES) {
    if (priority >= g.priority_min) grade = g;
    else break;
  }
  return grade;
}

/** Grade derived from the user's own Pareto-step completion %. */
export function gradeForProgress(pct: number): SamuraiGrade {
  let grade = SAMURAI_GRADES[0];
  for (const g of SAMURAI_GRADES) {
    if (pct >= g.progress_min) grade = g;
    else break;
  }
  return grade;
}

/** % range a user grade covers (0..100). For the ladder display. */
export function gradeProgressRange(index: number): {
  min: number;
  max: number;
} {
  const min = SAMURAI_GRADES[index]?.progress_min ?? 0;
  const next = SAMURAI_GRADES[index + 1]?.progress_min;
  return { min, max: next != null ? next - 1 : 100 };
}

export interface SamuraiPalette {
  field: string; // crest disc fill
  ring: string; // crest outer trim ring
  emblem: string; // kamon petals + boss
  blade: string; // katana blade
  tsuba: string; // katana guard
  glow: string; // outer glow
}

// Steel → indigo (藍) → crimson (緋) → crimson+gold → black+gold.
export const SAMURAI_PALETTE: Record<number, SamuraiPalette> = {
  0: {
    field: "#39414e",
    ring: "#5b6678",
    emblem: "#aab6c6",
    blade: "#c8d0da",
    tsuba: "#6b7686",
    glow: "rgba(170,182,198,0.30)",
  },
  1: {
    field: "#26305a",
    ring: "#46599a",
    emblem: "#94a9e6",
    blade: "#b3bfe2",
    tsuba: "#46599a",
    glow: "rgba(148,169,230,0.40)",
  },
  2: {
    field: "#5a1f25",
    ring: "#9a363f",
    emblem: "#e88c94",
    blade: "#dbb9bc",
    tsuba: "#9a363f",
    glow: "rgba(232,140,148,0.46)",
  },
  3: {
    field: "#3a1318",
    ring: "#9c6622",
    emblem: "#f0c450",
    blade: "#ead08c",
    tsuba: "#9c6622",
    glow: "rgba(240,196,80,0.54)",
  },
  4: {
    field: "#15140f",
    ring: "#c79230",
    emblem: "#f7dc85",
    blade: "#f1e4b2",
    tsuba: "#c79230",
    glow: "rgba(247,220,133,0.72)",
  },
};

export function paletteForGrade(index: number): SamuraiPalette {
  return SAMURAI_PALETTE[index] ?? SAMURAI_PALETTE[0];
}
