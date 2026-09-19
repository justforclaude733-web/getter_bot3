// Mirrors config.ELEMENTS on the backend (key, label, upgrade multipliers).
// Colors here are presentation-only - keyed the same way getRarityTier()
// keys rarities, so an element the backend doesn't know about yet still
// renders fine (grey, using the raw key as the label).
export const ELEMENT_TIERS = {
  fire: { label: "🔥 Fire", accent: "#FF6B4A", attackMult: 1.2, defenseMult: 1.08 },
  water: { label: "💧 Water", accent: "#4FB6E7", attackMult: 1.12, defenseMult: 1.12 },
  wind: { label: "🌪 Wind", accent: "#6FE3B4", attackMult: 1.17, defenseMult: 1.1 },
  dark: { label: "🌑 Dark", accent: "#8B5FE0", attackMult: 1.25, defenseMult: 1.05 },
  light: { label: "☀ Light", accent: "#F2D34B", attackMult: 1.08, defenseMult: 1.2 },
};

export function getElementInfo(key) {
  return ELEMENT_TIERS[key] ?? { label: key || "—", accent: "#6B7280", attackMult: 1, defenseMult: 1 };
}
