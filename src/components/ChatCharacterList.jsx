import { useRef, useState } from "react";
import CardMedia from "./CardMedia.jsx";
import { pinConversation, unpinConversation, blockConversation, unblockConversation, deleteConversation } from "../api/chatApi.js";

const LONG_PRESS_MS = 450;

function timeLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function ChatAvatar({ character }) {
  const [artFrom, artTo] = character.gradient ?? ["#241E33", "#5C5378"];
  return (
    <div className="chat-avatar" style={{ "--art-from": artFrom, "--art-to": artTo }}>
      {character.imageUrl ? (
        <CardMedia
          src={character.imageUrl}
          mediaType={character.mediaType}
          alt={character.name}
          className="chat-avatar__media"
        />
      ) : (
        <span className="chat-avatar__initial">{character.name.charAt(0)}</span>
      )}
    </div>
  );
}

// Long-press (touch or mouse-hold) a conversation row to pin/block/delete
// it. Only meaningful for rows that already have a conversation - the
// "start a new chat" picker sheet doesn't pass onChanged, so this stays
// off there entirely.
function ChatRow({ character, index, onSelect, onChanged }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);
  const firedRef = useRef(false);

  function startPress() {
    if (!onChanged) return;
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      setMenuOpen(true);
    }, LONG_PRESS_MS);
  }
  function cancelPress() {
    clearTimeout(timerRef.current);
  }
  function handleClick() {
    if (firedRef.current) {
      // The long-press already fired and opened the menu - swallow the
      // click that follows the touch release so it doesn't also open
      // the conversation underneath the menu.
      firedRef.current = false;
      return;
    }
    onSelect(character);
  }

  async function runAction(action) {
    setBusy(true);
    await action(character.id);
    setBusy(false);
    setMenuOpen(false);
    onChanged?.();
  }

  return (
    <>
      <button
        type="button"
        className="chat-list-row card-build"
        style={{ "--i": Math.min(index, 6) }}
        onClick={handleClick}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
        onMouseDown={startPress}
        onMouseUp={cancelPress}
        onMouseLeave={cancelPress}
      >
        <ChatAvatar character={character} />
        <div className="chat-list-row__text">
          <div className="chat-list-row__top">
            <span className="chat-list-row__name">
              {character.pinned && <span className="chat-list-row__pin">📌</span>}
              {character.name}
            </span>
            <span className="chat-list-row__time">{timeLabel(character.lastMessageAt)}</span>
          </div>
          <p className="chat-list-row__preview">
            {character.blocked
              ? "Blocked"
              : character.lastMessage
              ? `${character.lastMessageSender === "user" ? "You: " : ""}${character.lastMessage}`
              : `Say hi to ${character.name}`}
          </p>
        </div>
      </button>

      {menuOpen && (
        <div className="sheet-overlay" onClick={() => setMenuOpen(false)}>
          <div className="confirm-sheet chat-context-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-sheet__handle" />
            <p className="chat-context-sheet__title">{character.name}</p>
            <div className="chat-context-sheet__actions">
              <button
                type="button"
                className="chat-context-sheet__action"
                disabled={busy}
                onClick={() => runAction(character.pinned ? unpinConversation : pinConversation)}
              >
                📌 {character.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                type="button"
                className="chat-context-sheet__action"
                disabled={busy}
                onClick={() => runAction(character.blocked ? unblockConversation : blockConversation)}
              >
                🚫 {character.blocked ? "Unblock" : "Block"}
              </button>
              <button
                type="button"
                className="chat-context-sheet__action chat-context-sheet__action--danger"
                disabled={busy}
                onClick={() => runAction(deleteConversation)}
              >
                🗑️ Delete conversation
              </button>
            </div>
            <button type="button" className="sheet-button" onClick={() => setMenuOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default function ChatCharacterList({ characters, loading, onSelect, onChanged }) {
  if (loading) {
    return (
      <div className="chat-list">
        {[0, 1, 2, 3].map((i) => (
          <div className="chat-list-row chat-list-row--skeleton card-build" style={{ "--i": i }} key={i}>
            <div className="chat-avatar chat-avatar--skeleton" />
            <div className="chat-list-row__text">
              <div className="skeleton-line skeleton-line--short" />
              <div className="skeleton-line" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="chat-empty card-build">
        <p className="chat-empty__title">No characters yet</p>
        <p className="chat-empty__text">
          Get a character from the Market or a spawn drop, then come back here to chat with them.
        </p>
      </div>
    );
  }

  return (
    <div className="chat-list">
      {characters.map((character, i) => (
        <ChatRow key={character.id} character={character} index={i} onSelect={onSelect} onChanged={onChanged} />
      ))}
    </div>
  );
}

export { ChatAvatar, timeLabel };
