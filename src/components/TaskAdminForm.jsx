import { useEffect, useState } from "react";
import { searchAdminCharacters, fetchAdminRarities, adminAddTask } from "../api/tasksApi.js";

const TASK_TYPES = [
  { value: "own_cards", label: "Obtain N cards (any)" },
  { value: "character_cards", label: "Obtain N cards of a specific character" },
  { value: "rarity_cards", label: "Obtain N cards of a specific rarity" },
  { value: "buy_market", label: "Buy N cards from the Market" },
  { value: "sell_market", label: "Sell N cards on the Market" },
  { value: "earn_currency", label: "Earn N VɎ" },
  { value: "spend_currency", label: "Spend N VɎ" },
];

function CharacterPicker({ label, onPick, picked }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      searchAdminCharacters(query).then(setResults);
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  return (
    <div className="admin-field">
      <label>{label}</label>
      {picked ? (
        <div className="admin-picked-chip">
          <span>
            {picked.name} · {picked.rarity_name || "Unranked"} ({picked.series})
          </span>
          <button type="button" onClick={() => onPick(null)}>
            ✕
          </button>
        </div>
      ) : (
        <div className="admin-picker">
          <input
            type="text"
            placeholder="Search character name…"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => setQuery(event.target.value)}
          />
          {open && (
            <ul className="admin-picker__results">
              {results.length === 0 ? (
                <li className="admin-picker__empty">Type to search…</li>
              ) : (
                results.map((character) => (
                  <li key={character.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(character);
                        setOpen(false);
                      }}
                    >
                      {character.name} · {character.rarity_name || "Unranked"} ({character.series})
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function TaskAdminForm({ onClose, onCreated }) {
  const [taskType, setTaskType] = useState("own_cards");
  const [targetCount, setTargetCount] = useState(1);
  const [displayText, setDisplayText] = useState("");
  const [rewardType, setRewardType] = useState("currency");
  const [rewardCurrency, setRewardCurrency] = useState(10);
  const [rewardCharacter, setRewardCharacter] = useState(null);
  const [taskCharacter, setTaskCharacter] = useState(null);
  const [rarities, setRarities] = useState([]);
  const [rarityId, setRarityId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (taskType === "rarity_cards" && rarities.length === 0) {
      fetchAdminRarities().then(setRarities);
    }
  }, [taskType, rarities.length]);

  const needsCharacter = taskType === "character_cards";
  const needsRarity = taskType === "rarity_cards";

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!displayText.trim()) {
      setError("Write what the task tells the player to do.");
      return;
    }
    if (needsCharacter && !taskCharacter) {
      setError("Pick which character this task is about.");
      return;
    }
    if (needsRarity && !rarityId) {
      setError("Pick which rarity this task is about.");
      return;
    }
    if (rewardType === "currency" && (!rewardCurrency || rewardCurrency <= 0)) {
      setError("Set a VɎ reward amount above 0.");
      return;
    }
    if (rewardType === "card" && !rewardCharacter) {
      setError("Pick which card the reward hands out.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await adminAddTask({
        task_type: taskType,
        target_count: Number(targetCount),
        display_text: displayText.trim(),
        reward_type: rewardType,
        character_id: needsCharacter ? taskCharacter.id : null,
        rarity_id: needsRarity ? Number(rarityId) : null,
        reward_currency: rewardType === "currency" ? Number(rewardCurrency) : null,
        reward_character_id: rewardType === "card" ? rewardCharacter.id : null,
      });
      if (result.ok) {
        onCreated();
      } else {
        setError("Could not create the task - try again.");
      }
    } catch (err) {
      setError(err.message || "Could not create the task.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <form className="confirm-sheet admin-sheet" onClick={(event) => event.stopPropagation()} onSubmit={handleSubmit}>
        <div className="confirm-sheet__handle" />
        <p className="confirm-sheet__title">➕ New Task</p>

        <div className="admin-field">
          <label>Task text (shown to players)</label>
          <input
            type="text"
            placeholder="e.g. Get 10 new cards"
            value={displayText}
            onChange={(event) => setDisplayText(event.target.value)}
          />
        </div>

        <div className="admin-field">
          <label>What counts as progress</label>
          <select value={taskType} onChange={(event) => setTaskType(event.target.value)}>
            {TASK_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label>Target amount (N)</label>
          <input
            type="number"
            min="1"
            value={targetCount}
            onChange={(event) => setTargetCount(event.target.value)}
          />
        </div>

        {needsCharacter && (
          <CharacterPicker label="Which character" picked={taskCharacter} onPick={setTaskCharacter} />
        )}

        {needsRarity && (
          <div className="admin-field">
            <label>Which rarity</label>
            <select value={rarityId} onChange={(event) => setRarityId(event.target.value)}>
              <option value="">Select a rarity…</option>
              {rarities.map((rarity) => (
                <option key={rarity.id} value={rarity.id}>
                  {rarity.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="admin-field">
          <label>Reward type</label>
          <div className="leaderboard-toggle">
            <button type="button" data-active={rewardType === "currency"} onClick={() => setRewardType("currency")}>
              💰 VɎ
            </button>
            <button type="button" data-active={rewardType === "card"} onClick={() => setRewardType("card")}>
              🎴 Card
            </button>
          </div>
        </div>

        {rewardType === "currency" ? (
          <div className="admin-field">
            <label>Amount of VɎ</label>
            <input
              type="number"
              min="1"
              value={rewardCurrency}
              onChange={(event) => setRewardCurrency(event.target.value)}
            />
          </div>
        ) : (
          <CharacterPicker label="Which card to give" picked={rewardCharacter} onPick={setRewardCharacter} />
        )}

        {error && <p className="confirm-sheet__error">{error}</p>}

        <div className="confirm-sheet__actions">
          <button type="button" className="sheet-button sheet-button--cancel" onClick={onClose}>
            ❌ Cancel
          </button>
          <button type="submit" className="sheet-button sheet-button--confirm" disabled={submitting}>
            {submitting ? "Creating…" : "✅ Create Task"}
          </button>
        </div>
      </form>
    </div>
  );
}
