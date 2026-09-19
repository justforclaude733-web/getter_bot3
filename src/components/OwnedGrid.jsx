import OwnedCard from "./OwnedCard.jsx";

export default function OwnedGrid({ cards, sellPrices, onSell, onBrowseMarket }) {
  if (cards.length === 0) {
    return (
      <div className="empty-state empty-state--action">
        <p>You don't own any cards yet — visit the Market tab to start your collection.</p>
        {onBrowseMarket && (
          <button type="button" className="empty-state__cta" onClick={onBrowseMarket}>
            🛍 Browse the Market
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="card-grid">
        {cards.map((character, index) => (
          <OwnedCard
            key={character.id}
            character={character}
            sellPrice={sellPrices ? sellPrices[character.rarity] || 0 : 0}
            onSell={onSell}
            index={index}
          />
        ))}
      </div>
      <p className="end-of-list">You've seen them all 🙂</p>
    </div>
  );
}
