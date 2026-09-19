import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import ChatCharacterList, { ChatAvatar } from "./ChatCharacterList.jsx";
import ChatConversation from "./ChatConversation.jsx";
import { fetchChatCharacters } from "../api/chatApi.js";

function PencilIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 15.5V20Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M13.5 6.5 17.5 10.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export default forwardRef(function ChatTab({ notify, onSubViewChange, onExit }, ref) {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCharacter, setActiveCharacter] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  function reload() {
    return fetchChatCharacters().then((rows) => {
      setCharacters(rows);
      setLoading(false);
      setActiveCharacter((current) => (current ? rows.find((c) => c.id === current.id) || current : current));
      return rows;
    });
  }

  useEffect(() => {
    let cancelled = false;
    fetchChatCharacters().then((rows) => {
      if (!cancelled) {
        setCharacters(rows);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The main screen only ever shows conversations the player actually
  // started - characters with no messages yet only show up in the
  // pencil's "start a new chat" picker below, never in both places.
  const conversations = characters.filter((c) => c.lastMessage);
  const startable = characters.filter((c) => !c.lastMessage);

  function openConversation(character) {
    setPickerOpen(false);
    setActiveCharacter(character);
  }

  function backToList() {
    setActiveCharacter(null);
  }

  // Reports whether a conversation is open so App.jsx knows the Telegram
  // BackButton should step back to the chat list first (instead of
  // straight to Home), and exposes that same step as an imperative
  // `goBack()` for App.jsx's BackButton handler to call directly.
  useEffect(() => {
    onSubViewChange?.(Boolean(activeCharacter));
  }, [activeCharacter, onSubViewChange]);

  useImperativeHandle(ref, () => ({ goBack: backToList }));

  return (
    <div className="chat-tab">
      <div className="chat-topbar tab-header">
        {activeCharacter ? (
          <>
            <button type="button" className="chat-topbar__back" onClick={backToList} aria-label="Back">
              ‹
            </button>
            <ChatAvatar character={activeCharacter} />
            <div className="chat-topbar__identity">
              <span className="chat-topbar__name">{activeCharacter.name}</span>
              <span className="chat-topbar__status">{activeCharacter.series}</span>
            </div>
          </>
        ) : (
          <span className="chat-topbar__title">Chats</span>
        )}
        <button type="button" className="chat-topbar__close" onClick={onExit} aria-label="Close">
          ✕
        </button>
      </div>

      {activeCharacter ? (
        <ChatConversation character={activeCharacter} notify={notify} />
      ) : (
        <div className="tab-scroll-body chat-tab__body">
          {loading ? (
            <ChatCharacterList characters={[]} loading onSelect={() => {}} />
          ) : conversations.length === 0 ? (
            <div className="chat-empty-state">
              <button type="button" className="chat-empty-state__fab" onClick={() => setPickerOpen(true)}>
                <PencilIcon />
              </button>
              <p className="chat-empty-state__text">
                No conversations yet - tap the pencil to pick one of your characters and say hi.
              </p>
            </div>
          ) : (
            <ChatCharacterList
              characters={conversations}
              loading={false}
              onSelect={openConversation}
              onChanged={reload}
            />
          )}
        </div>
      )}

      {!activeCharacter && conversations.length > 0 && (
        <button type="button" className="chat-fab" onClick={() => setPickerOpen(true)} aria-label="Start a new chat">
          <PencilIcon />
        </button>
      )}

      {pickerOpen && (
        <div className="sheet-overlay" onClick={() => setPickerOpen(false)}>
          <div className="confirm-sheet chat-picker-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-sheet__handle" />
            <p className="chat-picker-sheet__title">Start a chat</p>
            <div className="chat-picker-sheet__list">
              <ChatCharacterList characters={startable} loading={loading} onSelect={openConversation} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
