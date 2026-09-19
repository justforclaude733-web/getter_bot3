import { useCallback, useEffect, useRef, useState } from "react";
import { play } from "../audio/engine.js";
import { useTelegram } from "../hooks/useTelegram.js";
import {
  fetchArenaStatus,
  fetchArenaCards,
  fetchArenaTeams,
  setArenaTeam,
  startArenaFight,
  fetchArenaBattle,
} from "../api/arenaApi.js";
import ArenaFighterCard from "./ArenaFighterCard.jsx";
import ArenaTeamPickerSheet from "./ArenaTeamPickerSheet.jsx";
import ArenaCardManagementSheet from "./ArenaCardManagementSheet.jsx";

function formatCountdown(msRemaining) {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function TeamSlots({ team, onEdit }) {
  const slots = [0, 1, 2].map((i) => team[i] || null);
  return (
    <div className="arena-team-slots" onClick={onEdit} role="button">
      {slots.map((card, i) =>
        card ? (
          <ArenaFighterCard key={card.user_character_id} card={card} index={i} />
        ) : (
          <div key={`empty-${i}`} className="arena-team-slot--empty card-build" style={{ "--i": i }}>
            <span>+</span>
          </div>
        )
      )}
    </div>
  );
}

// A lightweight VS scene shown while a fight is pending: the attacker's
// real 3 cards on the left, a mystery opponent on the right (we never
// know the defender's actual cards up front - that's the point of the
// Defense Team being a surprise), and a progress bar that fills over
// the real 3-minute wait instead of just a bare mm:ss countdown.
function BattleScene({ attackTeam, pct }) {
  return (
    <div>
      <div className="arena-battle-scene">
        <div className="arena-battle-scene__side">
          {attackTeam.map((card) => {
            const [artFrom, artTo] = card.gradient ?? ["#241E33", "#5C5378"];
            return (
              <div
                key={card.user_character_id}
                className="arena-battle-scene__mini"
                style={{ "--art-from": artFrom, "--art-to": artTo }}
                title={card.name}
              >
                {card.element_label?.split(" ")[0] ?? "⚔"}
              </div>
            );
          })}
        </div>
        <span className="arena-battle-scene__vs">VS</span>
        <div className="arena-battle-scene__side">
          {[0, 1, 2].map((i) => (
            <div key={i} className="arena-battle-scene__mystery">
              ?
            </div>
          ))}
        </div>
      </div>
      <div className="battle-progress">
        <div className="battle-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ArenaTab({ notify, onNavigate }) {
  const { haptic } = useTelegram();
  const [status, setStatus] = useState(null);
  const [cards, setCards] = useState([]);
  const [teams, setTeams] = useState({ attack: [], defense: [] });
  const [loading, setLoading] = useState(true);
  const [pickerTeamType, setPickerTeamType] = useState(null);
  const [showCardManagement, setShowCardManagement] = useState(false);
  const [fighting, setFighting] = useState(false);
  const [battle, setBattle] = useState(null);
  const [now, setNow] = useState(Date.now());

  const pollRef = useRef(null);
  const tickRef = useRef(null);

  const refreshAll = useCallback(() => {
    return Promise.all([fetchArenaStatus(), fetchArenaCards(), fetchArenaTeams()]).then(
      ([statusData, cardList, teamData]) => {
        setStatus(statusData);
        setCards(cardList);
        setTeams(teamData);
        setLoading(false);
        if (statusData.pending_battle && !statusData.pending_battle.resolved) {
          setBattle(statusData.pending_battle);
        }
      }
    );
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Live mm:ss ticker + progress-bar fill while a battle is pending.
  useEffect(() => {
    if (!battle || battle.resolved) {
      clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tickRef.current);
  }, [battle]);

  // Poll the battle until it resolves, then refresh trophies/league.
  useEffect(() => {
    if (!battle || battle.resolved) {
      clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const updated = await fetchArenaBattle(battle.id ?? battle.battle_id);
      if (updated.resolved) {
        clearInterval(pollRef.current);
        setBattle(updated);
        const outcome = updated.result === "attacker" ? "success" : updated.result === "draw" ? "warning" : "error";
        notify?.(outcome, { sound: false }); // haptic only - the outcome has its own jingle
        play(updated.result === "attacker" ? "victory" : updated.result === "draw" ? "draw" : "defeat");
        refreshAll();
      }
    }, 4000);
    return () => clearInterval(pollRef.current);
  }, [battle, notify, refreshAll]);

  async function handleFight() {
    haptic?.("medium");
    play("fight");
    setFighting(true);
    const result = await startArenaFight();
    setFighting(false);
    if (!result.ok) {
      notify?.("error");
      return;
    }
    setBattle({
      id: result.battle_id,
      battle_id: result.battle_id,
      resolved: false,
      started_at: result.started_at ?? new Date().toISOString(),
      resolves_at: result.resolves_at,
    });
  }

  async function handleSaveTeam(teamType, selectedIds) {
    const result = await setArenaTeam(teamType, selectedIds);
    if (result.ok) {
      notify?.("success");
      setPickerTeamType(null);
      refreshAll();
    } else {
      notify?.("error");
    }
  }

  function openPicker(teamType) {
    haptic?.("light");
    setPickerTeamType(teamType);
  }

  function openCardManagement() {
    haptic?.("light");
    setShowCardManagement(true);
  }

  function handleBrowseMarket() {
    setPickerTeamType(null);
    onNavigate?.("market");
  }

  if (loading) {
    return (
      <div className="arena-tab">
        <h1 className="brand-title">⚔ ARENA</h1>
        <div className="arena-status skeleton-shimmer" style={{ height: 46 }} />
        <div className="fighter-grid" style={{ marginTop: 16 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="fighter-card">
              <div className="fighter-card__art skeleton-shimmer" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const attackReady = teams.attack.length === 3;
  const battlePending = battle && !battle.resolved;
  const msRemaining = battlePending ? new Date(battle.resolves_at).getTime() - now : 0;
  const msTotal = battlePending ? new Date(battle.resolves_at).getTime() - new Date(battle.started_at).getTime() : 1;
  const pct = battlePending ? Math.min(100, Math.max(0, 100 - (msRemaining / msTotal) * 100)) : 0;
  const canFight = attackReady && !battlePending && !fighting;

  return (
    <div className="arena-tab">
      <h1 className="brand-title">⚔ ARENA</h1>

      <div className="arena-status">
        <span className="arena-status__league">
          {status.league.emoji} {status.league.name}
        </span>
        <span className="arena-status__trophies">🏆 {status.trophies}</span>
      </div>

      {battlePending && (
        <div className="arena-banner arena-banner--pending">
          ⏳ Battle in progress… resolves in {formatCountdown(msRemaining)}
          <BattleScene attackTeam={teams.attack} pct={pct} />
        </div>
      )}

      {battle && battle.resolved && (
        <div
          className="arena-banner"
          data-outcome={battle.result === "attacker" ? "win" : battle.result === "draw" ? "draw" : "loss"}
        >
          {battle.result === "attacker" && `🏆 Victory! +${battle.attacker_trophy_change} Trophies`}
          {battle.result === "defender" && `💀 Defeat. ${battle.attacker_trophy_change} Trophies`}
          {battle.result === "draw" && "🤝 Draw. 0 Trophies"}
          <span className="arena-banner__powers">
            Your Attack {battle.attack_power} vs Enemy Defense {battle.defense_power}
          </span>
        </div>
      )}

      <section className="arena-team-section build-fade-only">
        <div className="arena-team-section__head">
          <h3>⚔ Attack Team</h3>
          <button type="button" className="arena-edit-btn" onClick={() => openPicker("attack")}>
            Edit
          </button>
        </div>
        <TeamSlots team={teams.attack} onEdit={() => openPicker("attack")} />
      </section>

      <section className="arena-team-section build-fade-only">
        <div className="arena-team-section__head">
          <h3>🛡 Defense Team</h3>
          <button type="button" className="arena-edit-btn" onClick={() => openPicker("defense")}>
            Edit
          </button>
        </div>
        <TeamSlots team={teams.defense} onEdit={() => openPicker("defense")} />
        <p className="arena-team-hint">
          No saved Defense Team? 3 random Fighter cards from your collection get used automatically when someone
          attacks you.
        </p>
      </section>

      <button
        type="button"
        className="sheet-button sheet-button--confirm admin-add-task-button"
        onClick={openCardManagement}
      >
        🛠 Card Management
      </button>

      <button type="button" className="daily-claim-button" disabled={!canFight} onClick={handleFight}>
        {battlePending
          ? `⏳ ${formatCountdown(msRemaining)}`
          : !attackReady
          ? "⚔ Pick 3 Attack Team cards first"
          : fighting
          ? "Searching for an opponent…"
          : "⚔ Fight"}
      </button>

      {pickerTeamType && (
        <ArenaTeamPickerSheet
          teamType={pickerTeamType}
          cards={cards}
          initialSelected={teams[pickerTeamType]}
          onSave={(ids) => handleSaveTeam(pickerTeamType, ids)}
          onClose={() => setPickerTeamType(null)}
          onBrowseMarket={onNavigate ? handleBrowseMarket : null}
        />
      )}

      {showCardManagement && (
        <ArenaCardManagementSheet
          cards={cards}
          onCardsChange={setCards}
          onClose={() => setShowCardManagement(false)}
          notify={notify}
        />
      )}
    </div>
  );
}
