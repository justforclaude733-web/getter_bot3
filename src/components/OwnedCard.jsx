import { useState } from "react";
import { getRarityTier } from "../data/rarities.js";
import CardMedia from "./CardMedia.jsx";

export default function OwnedCard({ character, sellPrice, onSell, index = 0 }) {
  const [imageFailed, setImageFailed] = useState(false);
  const tier = getRarityTier(character.rarity);
  const [artFrom, artTo] = character.gradient;
  const chipBackground = tier.chipBackground ?? tier.accent;
  const showImage = character.imageUrl && !imageFailed;
  const canSell = sellPrice > 0;

  const style = {
    "--card-accent": tier.accent,
    "--art-from": artFrom,
    "--art-to": artTo,
    "--i": index,
  };

  return (
    <article className="character-card owned-card card-build" data-glow={tier.glowLevel || undefined} style={style}>
      <div className="character-card__art">
        {character.quantity > 1 && <span className="quantity-badge">×{character.quantity}</span>}
        {showImage ? (
          <CardMedia
            className="character-card__photo"
            src={character.imageUrl}
            mediaType={character.mediaType}
            alt={character.name}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="character-card__monogram">{character.name.charAt(0)}</span>
        )}
      </div>

      <div className="character-card__body character-card__body--tight">
        <h3 className="character-card__name">{character.name}</h3>
        <div className="character-card__meta">
          <span className="rarity-chip" style={{ background: chipBackground }}>
            {tier.label}
          </span>
          <span className="character-card__series">{character.series}</span>
        </div>
      </div>

      {onSell && (
        <div className="character-card__footer">
          <span className="price-ticket">🏪 {canSell ? `${sellPrice} VɎ` : "—"}</span>
          <button
            type="button"
            className="buy-button"
            data-owned={!canSell}
            disabled={!canSell}
            onClick={() => canSell && onSell(character)}
          >
            Sell
          </button>
        </div>
      )}
    </article>
  );
}
