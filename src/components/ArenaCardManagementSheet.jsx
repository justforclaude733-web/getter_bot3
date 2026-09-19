import { useState } from "react";
import ArenaFighterCard from "./ArenaFighterCard.jsx";
import { getElementInfo } from "../data/elements.js";
import { upgradeFighterCard } from "../api/arenaApi.js";

function UpgradeRow({ card, onUpgraded, notify }) {
  const [busy, setBusy] = useState(null);
  const element = getElementInfo(card.element);
  const maxed = card.level >= card.max_level;

  async function handleUpgrade(stat) {
    setBusy(stat);
    const result = await upgradeFighterCard(card.user_character_id, stat);
    if (result.ok) {
      onUpgraded(card.user_character_id, result);
      notify?.("success");
    } else {
      notify?.("error");
    }
    setBusy(null);
  }

  const nextAttack = Math.round(card.current_attack * element.attackMult);
  const nextDefense = Math.round(card.current_defense * element.defenseMult);

  return (
    <ArenaFighterCard
      card={card}
      footer={
        maxed ? (
          <span className="fighter-card__maxed">MAX LEVEL</span>
        ) : (
          <div className="fighter-card__upgrade-buttons">
            <button
              type="button"
              className="fighter-card__upgrade-btn"
              disabled={busy !== null}
              onClick={() => handleUpgrade("attack")}
            >
              {busy === "attack" ? "…" : `⚔ → ${nextAttack}`}
            </button>
            <button
              type="button"
              className="fighter-card__upgrade-btn"
              disabled={busy !== null}
              onClick={() => handleUpgrade("defense")}
            >
              {busy === "defense" ? "…" : `🛡 → ${nextDefense}`}
            </button>
          </div>
        )
      }
    />
  );
}

export default function ArenaCardManagementSheet({ cards, onCardsChange, onClose, notify }) {
  function handleUpgraded(userCharacterId, result) {
    onCardsChange((prev) =>
      prev.map((c) =>
        c.user_character_id === userCharacterId
          ? { ...c, level: result.level, current_attack: result.current_attack, current_defense: result.current_defense }
          : c
      )
    );
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="confirm-sheet arena-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-sheet__handle" />
        <p className="confirm-sheet__title">🛠 Card Management</p>
        <p className="confirm-sheet__subtitle">Upgrade Attack or Defense - each pick raises that stat by your card's element multiplier</p>

        {cards.length === 0 ? (
          <p className="empty-state empty-state--tight">No Fighter cards to upgrade yet.</p>
        ) : (
          <div className="fighter-grid fighter-grid--scroll">
            {cards.map((card) => (
              <UpgradeRow key={card.user_character_id} card={card} onUpgraded={handleUpgraded} notify={notify} />
            ))}
          </div>
        )}

        <div className="confirm-sheet__actions">
          <button type="button" className="sheet-button sheet-button--confirm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
