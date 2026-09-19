import { RARITY_NAMES } from "../data/rarities.js";

const RARITY_OPTIONS = ["All", ...RARITY_NAMES];

export default function FilterBar({ activeRarity, onRarityChange, query, onQueryChange }) {
  return (
    <div>
      <div className="filter-row">
        {RARITY_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className="filter-chip"
            data-active={activeRarity === option}
            onClick={() => onRarityChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <input
        type="text"
        className="search-input"
        placeholder="Search by name or series..."
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
    </div>
  );
}
