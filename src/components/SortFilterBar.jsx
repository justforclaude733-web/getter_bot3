import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchProfileFilter, fetchFilterOptions, setProfileFilter, clearProfileFilter } from "../api/profileFilterApi.js";

const MODE_LABEL = { character: "Character", series: "Series", rarity: "Rarity" };

export default function SortFilterBar({ onFilterChange }) {
  const [filter, setFilter] = useState({ filter_type: null, filter_value: null });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mode, setMode] = useState("character");
  const [options, setOptions] = useState(null);

  useEffect(() => {
    fetchProfileFilter().then(setFilter);
  }, []);

  function openSheet() {
    setSheetOpen(true);
    if (!options) fetchFilterOptions().then(setOptions);
  }

  async function pick(filterType, value) {
    const result = await setProfileFilter(filterType, value);
    setFilter({ filter_type: result.filter_type, filter_value: result.filter_value });
    setSheetOpen(false);
    onFilterChange?.();
  }

  async function clear() {
    const result = await clearProfileFilter();
    setFilter({ filter_type: result.filter_type, filter_value: result.filter_value });
    setSheetOpen(false);
    onFilterChange?.();
  }

  const list = mode === "character" ? options?.characters : mode === "series" ? options?.series : options?.rarities;

  return (
    <>
      <div className="sort-bar">
        <button type="button" className="sort-bar__trigger" onClick={openSheet}>
          {filter.filter_type ? (
            <span>
              {MODE_LABEL[filter.filter_type]}: <strong>{filter.filter_value}</strong>
            </span>
          ) : (
            <span>Sort / Filter</span>
          )}
          <span className="sort-bar__chevron">⌄</span>
        </button>
        {filter.filter_type && (
          <button type="button" className="sort-bar__clear" onClick={clear} aria-label="Clear filter">
            ✕
          </button>
        )}
      </div>

      {sheetOpen &&
        createPortal(
        <div className="sheet-overlay sort-sheet-overlay" onClick={() => setSheetOpen(false)}>
          <div className="confirm-sheet sort-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-sheet__handle" />
            <p className="sort-sheet__title">Sort your constellation</p>

            <div className="sort-sheet__modes">
              {Object.entries(MODE_LABEL).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className="sort-sheet__mode"
                  data-active={mode === key || undefined}
                  onClick={() => setMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="sort-sheet__list">
              {!options ? (
                <p className="sort-sheet__hint">Loading…</p>
              ) : !list || list.length === 0 ? (
                <p className="sort-sheet__hint">Nothing to pick yet.</p>
              ) : (
                list.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="sort-sheet__option"
                    data-active={filter.filter_type === mode && filter.filter_value === value}
                    onClick={() => pick(mode, value)}
                  >
                    {value}
                  </button>
                ))
              )}
            </div>

            <div className="confirm-sheet__actions">
              <button type="button" className="sheet-button" onClick={clear}>
                Clear filter
              </button>
              <button type="button" className="sheet-button sheet-button--confirm" onClick={() => setSheetOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>,
        // Rendered outside .tab-header: that element keeps a transform/filter from the
        // tab-build animation, which makes position:fixed size against the header box
        // instead of the screen. .app-shell (not body) keeps the theme CSS variables.
        document.querySelector(".app-shell") || document.body
      )}
    </>
  );
}
