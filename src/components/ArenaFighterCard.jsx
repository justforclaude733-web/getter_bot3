import { useState } from "react";
import { getElementInfo } from "../data/elements.js";
import CardMedia from "./CardMedia.jsx";

export default function ArenaFighterCard({ card, selected, onClick, footer, index = null }) {
  const [imageFailed, setImageFailed] = useState(false);
  const element = getElementInfo(card.element);
  const showImage = card.imageUrl && !imageFailed;
  const [artFrom, artTo] = card.gradient ?? ["#241E33", "#5C5378"];

  const style = { "--card-accent": element.accent, "--art-from": artFrom, "--art-to": artTo, "--i": index };

  return (
    <article
      className={index === null ? "fighter-card" : "fighter-card card-build"}
      style={style}
      data-selected={selected || undefined}
      data-maxed={card.level >= (card.max_level ?? 15) || undefined}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="fighter-card__art">
        <span className="fighter-card__element" title={element.label}>
          {element.label.split(" ")[0]}
        </span>
        <span className="fighter-card__level">Lv {card.level}</span>
        {showImage ? (
          <CardMedia
            className="character-card__photo"
            src={card.imageUrl}
            mediaType={card.mediaType}
            alt={card.name}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="character-card__monogram">{card.name.charAt(0)}</span>
        )}
        {selected && <span className="fighter-card__check">✓</span>}
      </div>

      <div className="fighter-card__body">
        <h4 className="fighter-card__name">{card.name}</h4>
        <div className="fighter-card__stats">
          <span className="fighter-card__stat fighter-card__stat--atk">⚔ {card.current_attack}</span>
          <span className="fighter-card__stat fighter-card__stat--def">🛡 {card.current_defense}</span>
        </div>
      </div>

      {footer && <div className="fighter-card__footer">{footer}</div>}
    </article>
  );
}
