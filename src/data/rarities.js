// Mirrors the rarity *names* your bot's /addrarity defines. This is just
// presentation - color (or gradient, for the two shimmer tiers) + a
// display label per name. Unknown names still render fine (grey, using
// the name as-is), so a new rarity you add later doesn't break anything.
// glowLevel: 0 = flat, 1 = a soft static glow, 2 = a pulsing "special pull"
// glow - reserved for the two shimmer-chip tiers so pulling one of those
// actually *feels* different, not just a different chip color.
export const RARITY_TIERS = {
  common: { label: "Common", accent: "#93A3B8", glowLevel: 0 },
  rare: { label: "Rare", accent: "#4FB6E7", glowLevel: 1 },
  mystic: { label: "Mystic", accent: "#8B5FE0", glowLevel: 1 },
  legendary: { label: "Legendary", accent: "#F2B84B", glowLevel: 1 },
  elysian: { label: "Elysian", accent: "#6FE3B4", glowLevel: 1 },
  prismatic: {
    label: "Prismatic",
    accent: "#FF6EC7",
    chipBackground: "linear-gradient(90deg, #FF6EC7, #8B5FE0, #4FB6E7, #6FE3B4, #F2B84B)",
    glowLevel: 2,
  },
  nocturne: { label: "Nocturne", accent: "#5568D6", glowLevel: 1 },
  sovereign: { label: "Sovereign", accent: "#C0392B", glowLevel: 1 },
  aevoria: { label: "Aevoria", accent: "#21C8D8", glowLevel: 1 },
  celestial: { label: "Celestial", accent: "#8FD6FF", glowLevel: 1 },
  singular: { label: "Singular", accent: "#E8ECF2", glowLevel: 1 },
  omnara: {
    label: "Omnara",
    accent: "#F4D35E",
    chipBackground: "linear-gradient(90deg, #F4D35E, #FFFFFF, #C9A7FF)",
    glowLevel: 2,
  },
  unranked: { label: "Unranked", accent: "#6B7280", glowLevel: 0 },
};

export const RARITY_NAMES = Object.values(RARITY_TIERS)
  .map((tier) => tier.label)
  .filter((label) => label !== "Unranked");

export function getRarityTier(name) {
  const key = (name || "unranked").toLowerCase();
  return RARITY_TIERS[key] ?? { label: name, accent: "#6B7280", glowLevel: 0 };
}

