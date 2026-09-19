import { useEffect, useRef, useState } from "react";
import { fetchChatMessages, sendChatMessage } from "../api/chatApi.js";
import { play } from "../audio/engine.js";

function bubbleTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatConversation({ character, notify }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchChatMessages(character.id).then((rows) => {
      if (!cancelled) {
        setMessages(rows);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [character.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, sending]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setDraft("");
    // Optimistic: show the player's own line immediately, then fill in
    // the character's reply (or roll it back) once the request settles.
    const optimisticId = `pending-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, sender: "user", content: text, createdAt: new Date().toISOString() },
    ]);
    play("sent");

    const result = await sendChatMessage(character.id, text);
    if (result.ok) {
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticId),
        result.userMessage,
        result.reply,
      ]);
      play("received");
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setDraft(text);
      notify?.("error");
    }
    setSending(false);
  }

  return (
    <div className="chat-conversation">
      <div className="chat-conversation__messages tab-scroll-body" ref={scrollRef}>
        {loading ? (
          <div className="chat-conversation__loading">Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div className="chat-conversation__loading">Say hi to {character.name}!</div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className="chat-bubble-row"
              data-sender={message.sender}
            >
              <div className="chat-bubble">
                <p>{message.content}</p>
                <span className="chat-bubble__time">{bubbleTime(message.createdAt)}</span>
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="chat-bubble-row" data-sender="character">
            <div className="chat-bubble chat-bubble--typing">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </div>
          </div>
        )}
      </div>

      <div className="chat-composer">
        <textarea
          className="chat-composer__input"
          placeholder={`Message ${character.name}...`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={1}
        />
        <button
          type="button"
          className="chat-composer__send"
          onClick={handleSend}
          disabled={!draft.trim() || sending}
        >
          ➤
        </button>
      </div>
    </div>
  );
}
