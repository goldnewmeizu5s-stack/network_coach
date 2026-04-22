// Shared types for the rank / shoulder-board system. The server is the
// source of truth for rank definitions and XP math; the client only renders.

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

// Color palette per tier — used by the shoulder-board SVG.
export const TIER_PALETTE: Record<
  RankTier,
  {
    base: string;      // shoulder board fill
    trim: string;      // edge piping
    accent: string;    // stripes / accent color
    star: string;      // star fill
    glow: string;      // outer glow ring
  }
> = {
  recruit: {
    base: "#3f4147",
    trim: "#5a5d66",
    accent: "#9aa0ab",
    star: "#e6e8ec",
    glow: "rgba(154,160,171,0.35)",
  },
  nco: {
    base: "#4a3a2a",
    trim: "#6b5436",
    accent: "#d4a24c",
    star: "#f5d07a",
    glow: "rgba(212,162,76,0.45)",
  },
  officer: {
    base: "#1f3a5f",
    trim: "#3b5c87",
    accent: "#e9d27a",
    star: "#ffe08a",
    glow: "rgba(233,210,122,0.45)",
  },
  senior: {
    base: "#4a1e1e",
    trim: "#6b2c2c",
    accent: "#ffd26a",
    star: "#ffe6a3",
    glow: "rgba(255,210,106,0.55)",
  },
  general: {
    base: "#1a1a1a",
    trim: "#6b5020",
    accent: "#f0c450",
    star: "#ffe999",
    glow: "rgba(240,196,80,0.7)",
  },
};
