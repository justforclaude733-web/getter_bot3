import { apiFetch, API_BASE, imageUrl, gradientFor } from "./marketApi.js";

// Mock fallback so the Chat tab still renders while iterating on layout
// without a live backend (same pattern the other tabs use).
const MOCK_CHAT_CHARACTERS = [
  {
    id: 101,
    name: "Rin",
    series: "Fate",
    image_file_id: null,
    rarity_name: "Legendary",
    last_message: "Talk to me anytime~",
    last_message_sender: "character",
    last_message_at: new Date().toISOString(),
  },
  {
    id: 102,
    name: "Asuka",
    series: "Evangelion",
    image_file_id: null,
    rarity_name: "Epic",
    last_message: null,
    last_message_sender: null,
    last_message_at: new Date(Date.now() - 86400000).toISOString(),
  },
];

const MOCK_REPLIES = ["Hehe, that's cute.", "Tell me more!", "I missed you today."];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeChatCharacter(row) {
  return {
    id: row.id,
    name: row.name,
    series: row.series,
    rarity: row.rarity_name || "Unranked",
    imageUrl: imageUrl(row.image_file_id),
    mediaType: row.media_type || "photo",
    gradient: gradientFor(row.id),
    lastMessage: row.last_message,
    lastMessageSender: row.last_message_sender,
    lastMessageAt: row.last_message_at,
    pinned: Boolean(row.pinned),
    blocked: Boolean(row.blocked),
  };
}

export async function fetchChatCharacters() {
  if (!API_BASE) {
    await delay(200);
    return MOCK_CHAT_CHARACTERS.map(normalizeChatCharacter);
  }
  const rows = await apiFetch("/api/chat/characters");
  return rows.map(normalizeChatCharacter);
}

function normalizeMessage(row) {
  return {
    id: row.id,
    sender: row.sender,
    content: row.content,
    createdAt: row.created_at,
  };
}

const mockHistory = new Map();

export async function fetchChatMessages(characterId) {
  if (!API_BASE) {
    await delay(200);
    return (mockHistory.get(characterId) || []).map(normalizeMessage);
  }
  const rows = await apiFetch(`/api/chat/messages/${characterId}`);
  return rows.map(normalizeMessage);
}

export async function sendChatMessage(characterId, text) {
  if (!API_BASE) {
    await delay(350);
    const list = mockHistory.get(characterId) || [];
    const now = () => new Date().toISOString();
    const userMsg = { id: list.length + 1, sender: "user", content: text, created_at: now() };
    const reply = {
      id: list.length + 2,
      sender: "character",
      content: MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)],
      created_at: now(),
    };
    mockHistory.set(characterId, [...list, userMsg, reply]);
    return { ok: true, userMessage: normalizeMessage(userMsg), reply: normalizeMessage(reply) };
  }

  try {
    const data = await apiFetch("/api/chat/messages", {
      method: "POST",
      body: JSON.stringify({ character_id: characterId, text }),
    });
    return {
      ok: true,
      userMessage: normalizeMessage(data.user_message),
      reply: normalizeMessage(data.reply),
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ---- pin / block / delete (long-press menu on a conversation row) ----

async function chatConversationAction(path, characterId) {
  if (!API_BASE) return { ok: true };
  try {
    await apiFetch(path, { method: "POST", body: JSON.stringify({ character_id: characterId }) });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export const pinConversation = (characterId) => chatConversationAction("/api/chat/conversation/pin", characterId);
export const unpinConversation = (characterId) => chatConversationAction("/api/chat/conversation/unpin", characterId);
export const blockConversation = (characterId) => chatConversationAction("/api/chat/conversation/block", characterId);
export const unblockConversation = (characterId) =>
  chatConversationAction("/api/chat/conversation/unblock", characterId);
export const deleteConversation = (characterId) =>
  chatConversationAction("/api/chat/conversation/delete", characterId);
