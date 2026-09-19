import { useEffect, useState } from "react";
import { fetchPlayerProfile } from "../api/leaderboardApi.js";

export default function PlayerProfileSheet({ userId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userId == null) return;
    let cancelled = false;
    setLoading(true);
    setProfile(null);
    fetchPlayerProfile(userId).then((data) => {
      if (!cancelled) {
        setProfile(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (userId == null) return null;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="confirm-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-sheet__handle" />

        {loading ? (
          <p className="empty-state">Loading player…</p>
        ) : (
          <>
            <div className="confirm-sheet__row">
              <div
                className="confirm-sheet__thumb"
                style={{ "--art-from": "var(--gold)", "--art-to": "var(--surface-raised)" }}
              >
                {profile.display_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="confirm-sheet__title">{profile.display_name}</p>
                <p className="confirm-sheet__subtitle">Player #{profile.user_id}</p>
              </div>
            </div>

            <div className="confirm-sheet__ledger">
              <div className="confirm-sheet__ledger-row">
                <span>Balance</span>
                <span>{profile.balance} VɎ</span>
              </div>
              <div className="confirm-sheet__ledger-row" data-emphasis="true">
                <span>Cards owned</span>
                <span>{profile.card_count}</span>
              </div>
            </div>
          </>
        )}

        <div className="confirm-sheet__actions">
          <button type="button" className="sheet-button sheet-button--cancel" onClick={onClose}>
            ❌ Close
          </button>
        </div>
      </div>
    </div>
  );
}
