import { getRarityTier } from "../data/rarities.js";

export default function BuyConfirmSheet({ character, balance, pending, onConfirm, onCancel }) {
  if (!character) return null;

  const tier = getRarityTier(character.rarity);
  const [artFrom, artTo] = character.gradient;
  const affordable = balance >= character.price;
  const balanceAfter = balance - character.price;

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
            <p className="confirm-sheet__subtitle">Seller {character.seller}</p>
          </div>
        </div>

        <div className="confirm-sheet__ledger">
          <div className="confirm-sheet__ledger-row">
            <span>Price</span>
            <span>{character.price} VɎ</span>
          </div>
          <div className="confirm-sheet__ledger-row">
            <span>Balance</span>
            <span>{balance} VɎ</span>
          </div>
          <div className="confirm-sheet__ledger-row" data-emphasis="true">
            <span>Left after</span>
            <span>{affordable ? balanceAfter : "—"} VɎ</span>
          </div>
        </div>

        {!affordable && <p className="confirm-sheet__error">ʏᴏᴜ ᴅᴏɴ'ᴛ ʜᴀᴠᴇ ᴇɴᴏᴜɢʜ VɎ</p>}

        <div className="confirm-sheet__actions">
          <button type="button" className="sheet-button sheet-button--cancel" onClick={onCancel}>
            ❌ Cancel
          </button>
          <button
            type="button"
            className="sheet-button sheet-button--confirm"
            disabled={!affordable || pending}
            onClick={onConfirm}
          >
            {pending ? "Buying…" : "✅ Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
