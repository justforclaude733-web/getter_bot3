import { getRarityTier } from "../data/rarities.js";

export default function SellConfirmSheet({ character, price, balance, pending, onConfirm, onCancel }) {
  if (!character) return null;

  const tier = getRarityTier(character.rarity);
  const [artFrom, artTo] = character.gradient;
  const balanceAfter = balance + price;

  return (
    <div className="sheet-overlay" onClick={onCancel}>
      <div className="confirm-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-sheet__handle" />

        <div className="confirm-sheet__row">
          <div
            className="confirm-sheet__thumb"
            style={{ "--art-from": artFrom, "--art-to": artTo }}
          >
            {character.name.charAt(0)}
          </div>
          <div>
            <p className="confirm-sheet__title">{character.name}</p>
            <p className="confirm-sheet__subtitle">
              {character.series} · {tier.label}
            </p>
          </div>
        </div>

        <div className="confirm-sheet__ledger">
          <div className="confirm-sheet__ledger-row">
            <span>Sell price</span>
            <span>{price} VɎ</span>
          </div>
          <div className="confirm-sheet__ledger-row">
            <span>Balance</span>
            <span>{balance} VɎ</span>
          </div>
          <div className="confirm-sheet__ledger-row" data-emphasis="true">
            <span>After sale</span>
            <span>{balanceAfter} VɎ</span>
          </div>
        </div>

        <p className="confirm-sheet__error confirm-sheet__error--neutral">
          This sells one copy straight to the bot, not on the Market — it can't be undone.
        </p>

        <div className="confirm-sheet__actions">
          <button type="button" className="sheet-button sheet-button--cancel" onClick={onCancel}>
            ❌ Cancel
          </button>
          <button
            type="button"
            className="sheet-button sheet-button--confirm"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Selling…" : "🏪 Confirm sale"}
          </button>
        </div>
      </div>
    </div>
  );
}
