import { apiFetch, API_BASE } from "./marketApi.js";

export async function fetchProfileFilter() {
  if (!API_BASE) return { filter_type: null, filter_value: null };
  return apiFetch("/api/profile/filter");
}

export async function fetchFilterOptions() {
  if (!API_BASE) return { characters: [], series: [], rarities: [] };
  return apiFetch("/api/profile/filter-options");
}

export async function setProfileFilter(filterType, filterValue) {
  if (!API_BASE) return { ok: true, filter_type: filterType, filter_value: filterValue };
  return apiFetch("/api/profile/filter", {
    method: "POST",
    body: JSON.stringify({ filter_type: filterType, filter_value: filterValue }),
  });
}

export async function clearProfileFilter() {
  if (!API_BASE) return { ok: true, filter_type: null, filter_value: null };
  return apiFetch("/api/profile/filter", {
    method: "POST",
    body: JSON.stringify({ filter_type: null, filter_value: null }),
  });
}
