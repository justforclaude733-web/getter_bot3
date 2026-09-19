import { useEffect, useState } from "react";
import { getRarityTier } from "../data/rarities.js";
import CardMedia from "./CardMedia.jsx";
import { play } from "../audio/engine.js";

export default function CardRevealOverlay({ character, onDismiss }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!character) return;
    setImageFailed(false);
    // The rarer the pull, the bigger the sparkle run.
    play("reveal", { tier: getRarityTier(character.rarity).glowLevel });
    // mount closed, then flip open next frame so the animation actually plays
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => {
      cancelAnimationFrame(raf);
      setVisible(false);
    };
  }, [character]);

  if (!character) return null;

  const tier = getRarityTier(character.rarity);
  const chipBackground = tier.chipBackground ?? tier.accent;
  const [artFrom, artTo] = character.gradient ?? ["#3A2E63", "#7B4FA6"];
  const showImage = character.imageUrl && !imageFailed;

  const style = {
    "--card-accent": tier.accent,
    "--art-from": artFrom,
    "--art-to": artTo,
  };

  return (
    <div className="reveal-overlay" data-visible={visible || undefined} onClick={onDismiss}>
      <div
        className="reveal-card"
        data-glow={tier.glowLevel || undefined}
        style={style}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="reveal-card__eyebrow">✦ New Card ✦</p>

        <div className="reveal-card__art">
          {showImage ? (
            <CardMedia
              className="character-card__photo"
              src={character.imageUrl}
              mediaType={character.mediaType}
              alt={character.name}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span className="character-card__monogram">{character.name.charAt(0)}</span>
          )}
        </div>

        <h2 className="reveal-card__name">{character.name}</h2>
        <span className="rarity-chip reveal-card__rarity" style={{ background: chipBackground }}>
          {tier.label}
        </span>
        <p className="reveal-card__series">{character.series}</p>

        <button type="button" className="sheet-button sheet-button--confirm reveal-card__dismiss" onClick={onDismiss}>
          Nice! ✦
        </button>
      </div>
    </div>
  );
}
