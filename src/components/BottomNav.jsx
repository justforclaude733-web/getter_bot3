import { useTelegram } from "../hooks/useTelegram.js";

function HomeIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 11.5 12 4l8 7.5"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 10v8.5a1 1 0 0 0 1 1h3.5v-5a1.5 1.5 0 0 1 1.5-1.5v0a1.5 1.5 0 0 1 1.5 1.5v5H17a1 1 0 0 0 1-1V10"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MarketIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M4.5 8.5 6 4h12l1.5 4.5"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 8.5h15V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8.5Z"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 2}
        strokeLinejoin="round"
      />
      <path
        d="M9 11.5a2.5 2.5 0 0 0 5 0"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrophyIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M7 4h10v4a5 5 0 0 1-10 0V4Z"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 2}
        strokeLinejoin="round"
      />
      <path
        d="M7 5H4v1a4 4 0 0 0 4 4M17 5h3v1a4 4 0 0 1-4 4"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 2}
        strokeLinecap="round"
      />
      <path d="M12 13v3M9 20h6M10 20v-2.5h4V20" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" />
    </svg>
  );
}

function GameIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="7" cy="15.5" r="2.6" stroke="currentColor" strokeWidth={active ? 2.4 : 2} />
      <circle cx="17" cy="15.5" r="2.6" stroke="currentColor" strokeWidth={active ? 2.4 : 2} />
      <path
        d="M9.2 15.5h5.6M9.5 15 12 8h3.5l2 3"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-7Z"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 2}
        strokeLinejoin="round"
      />
      <path d="M8 9h8M8 12h5" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" />
    </svg>
  );
}

function ArenaIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 4.5 12 7l6-2.5-1 5-5 9.5-5-9.5-1-5Z"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 2}
        strokeLinejoin="round"
      />
      <path d="M9 20h6" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" />
    </svg>
  );
}

const TABS = [
  { id: "home", label: "Home", Icon: HomeIcon },
  { id: "market", label: "Market", Icon: MarketIcon },
  { id: "game", label: "Ride", Icon: GameIcon },
  { id: "leaderboard", label: "Leaderboard", Icon: TrophyIcon },
  { id: "arena", label: "Arena", Icon: ArenaIcon },
  { id: "chat", label: "Chat", Icon: ChatIcon },
];

// Exported so App.jsx can tell which way a tab switch "moved" (for the
// directional tab-build slide animation) without duplicating this list.
export const TAB_ORDER = TABS.map((tab) => tab.id);

export default function BottomNav({ active, onChange, hidden }) {
  const { haptic } = useTelegram();

  function handleChange(tabId) {
    if (tabId !== active) haptic?.("light");
    onChange(tabId);
  }

  return (
    <nav className="bottom-nav" data-hidden={hidden || undefined}>
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            className="bottom-nav__item"
            data-active={isActive}
            onClick={() => handleChange(tab.id)}
          >
            <tab.Icon active={isActive} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
