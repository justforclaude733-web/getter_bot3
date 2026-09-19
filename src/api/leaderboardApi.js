import { apiFetch, API_BASE } from "./marketApi.js";

// Small mock fallback so the tab still renders something sensible
// while iterating on layout without a live backend (mirrors the
// pattern marketApi.js already uses for the Market/Home tabs).
const MOCK_RICHEST = [
  { user_id: 1, display_name: "@shadowmint", balance: 18420 },
  { user_id: 2, display_name: "@lunarforge", balance: 15230 },
  { user_id: 3, display_name: "@velvetash", balance: 12110 },
];

const MOCK_TOP_COLLECTORS = [
  { user_id: 1, display_name: "@shadowmint", card_count: 58 },
  { user_id: 2, display_name: "@lunarforge", card_count: 51 },
  { user_id: 3, display_name: "@velvetash", card_count: 44 },
];

export async function fetchTopCollectors() {
  if (!API_BASE) return MOCK_TOP_COLLECTORS;
  return apiFetch("/api/leaderboard/collectors");
}

export async function fetchRichest() {
  if (!API_BASE) return MOCK_RICHEST;
  return apiFetch("/api/leaderboard/richest");
}

export async function fetchPlayerProfile(userId) {
  if (!API_BASE) {
    const mock = MOCK_RICHEST.find((row) => row.user_id === userId);
    return {
      user_id: userId,
      display_name: mock?.display_name ?? `Player ${userId}`,
      balance: mock?.balance ?? 0,
      card_count: 0,
      cards: [],
    };
  }
  return apiFetch(`/api/leaderboard/profile/${userId}`);
}
