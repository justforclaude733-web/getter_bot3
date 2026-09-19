import { apiFetch, API_BASE, imageUrl, gradientFor } from "./marketApi.js";

// Small mock fallback so the Arena tab still renders something sensible
// while iterating on layout without a live backend (same pattern the
// other tabs already use).
const MOCK_CARDS = [
  {
    user_character_id: 1,
    character_id: 101,
    name: "Rin",
    series: "Fate",
    image_file_id: null,
    element: "fire",
    element_label: "🔥 Fire",
    level: 4,
    max_level: 15,
    current_attack: 432,
    current_defense: 231,
  },
  {
    user_character_id: 2,
    character_id: 102,
    name: "Asuka",
    series: "Evangelion",
    image_file_id: null,
    element: "light",
    element_label: "☀ Light",
    level: 1,
    max_level: 15,
    current_attack: 200,
    current_defense: 220,
  },
];

const MOCK_LEAGUES = [
  { key: "novice", name: "Novice", emoji: "🌱", min: 0, victory: 30, defeat: -10 },
  { key: "waifu_fan", name: "Waifu Fan", emoji: "🌸", min: 300, victory: 28, defeat: -12 },
  { key: "collector", name: "Collector", emoji: "💖", min: 700, victory: 26, defeat: -14 },
  { key: "elite", name: "Elite Collector", emoji: "✨", min: 1200, victory: 24, defeat: -16 },
  { key: "diamond", name: "Diamond Heart", emoji: "💎", min: 1800, victory: 22, defeat: -18 },
  { key: "lord", name: "Waifu Lord", emoji: "👑", min: 2600, victory: 20, defeat: -20 },
  { key: "emperor", name: "Waifu Emperor", emoji: "🌟", min: 3600, victory: 18, defeat: -22 },
  { key: "legend", name: "Eternal Legend", emoji: "🔥", min: 5000, victory: 15, defeat: -25 },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCard(card) {
  return {
    ...card,
    imageUrl: imageUrl(card.image_file_id),
    mediaType: card.media_type || "photo",
    gradient: gradientFor(card.character_id),
  };
}

export async function fetchArenaLeagues() {
  if (!API_BASE) {
    await delay(150);
    return MOCK_LEAGUES;
  }
  return apiFetch("/api/arena/leagues");
}

export async function fetchArenaStatus() {
  if (!API_BASE) {
    await delay(200);
    return { trophies: 150, league: MOCK_LEAGUES[0], pending_battle: null };
  }
  return apiFetch("/api/arena/status");
}

export async function fetchArenaCards() {
  if (!API_BASE) {
    await delay(200);
    return MOCK_CARDS.map(normalizeCard);
  }
  const cards = await apiFetch("/api/arena/cards");
  return cards.map(normalizeCard);
}

export async function fetchArenaTeams() {
  if (!API_BASE) {
    await delay(200);
    return { attack: [normalizeCard(MOCK_CARDS[0])], defense: [] };
  }
  const data = await apiFetch("/api/arena/teams");
  return {
    attack: data.attack.map(normalizeCard),
    defense: data.defense.map(normalizeCard),
  };
}

export async function setArenaTeam(teamType, userCharacterIds) {
  if (!API_BASE) {
    await delay(200);
    return { ok: true, team_type: teamType, size: userCharacterIds.length };
  }
  try {
    const data = await apiFetch("/api/arena/teams/set", {
      method: "POST",
      body: JSON.stringify({ team_type: teamType, user_character_ids: userCharacterIds }),
    });
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function upgradeFighterCard(userCharacterId, stat) {
  if (!API_BASE) {
    await delay(200);
    return { ok: true, stat, level: 2, current_attack: 260, current_defense: 200 };
  }
  try {
    const data = await apiFetch("/api/arena/upgrade", {
      method: "POST",
      body: JSON.stringify({ user_character_id: userCharacterId, stat }),
    });
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function startArenaFight() {
  if (!API_BASE) {
    await delay(300);
    return {
      ok: true,
      battle_id: Date.now(),
      resolves_at: new Date(Date.now() + 5000).toISOString(),
      result: "attacker",
    };
  }
  try {
    const data = await apiFetch("/api/arena/fight", { method: "POST" });
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function fetchArenaBattle(battleId) {
  if (!API_BASE) {
    await delay(150);
    return { id: battleId, resolved: true, result: "attacker", attack_power: 900, defense_power: 600 };
  }
  return apiFetch(`/api/arena/battle/${battleId}`);
}

export async function fetchArenaHistory() {
  if (!API_BASE) {
    await delay(150);
    return [];
  }
  return apiFetch("/api/arena/history");
}
