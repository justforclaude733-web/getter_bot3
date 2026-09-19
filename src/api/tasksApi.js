import { apiFetch, API_BASE } from "./marketApi.js";

const MOCK_TASKS = {
  is_admin: false,
  daily_claimed: false,
  daily_reward: 15,
  tasks: [
    { id: 1, task_type: "own_cards", display_text: "Get 5 new cards", target: 5, progress: 2, done: false, reward_type: "currency", reward_currency: 40 },
    { id: 2, task_type: "sell_market", display_text: "Sell 1 card on the Market", target: 1, progress: 0, done: false, reward_type: "currency", reward_currency: 20 },
    { id: 3, task_type: "earn_currency", display_text: "Earn 100 VɎ", target: 100, progress: 100, done: true, reward_type: "card", reward_currency: null },
  ],
};

export async function fetchTasks() {
  if (!API_BASE) return MOCK_TASKS;
  return apiFetch("/api/tasks");
}

export async function claimDailyBonus() {
  if (!API_BASE) return { ok: true, new_balance: 515 };
  return apiFetch("/api/tasks/daily-claim", { method: "POST" });
}

export async function claimTask(taskId) {
  if (!API_BASE) return { ok: true };
  return apiFetch("/api/tasks/claim", {
    method: "POST",
    body: JSON.stringify({ task_id: taskId }),
  });
}

export async function searchAdminCharacters(query) {
  if (!API_BASE) return [];
  const params = new URLSearchParams({ q: query || "" });
  return apiFetch(`/api/tasks/admin/characters?${params.toString()}`);
}

export async function fetchAdminRarities() {
  if (!API_BASE) return [];
  return apiFetch("/api/tasks/admin/rarities");
}

export async function adminAddTask(payload) {
  if (!API_BASE) return { ok: true, task_id: Date.now() };
  return apiFetch("/api/tasks/admin/add", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
