export default function TaskCard({ task, onClaim, claiming }) {
  const percent = task.target > 0 ? Math.min(100, Math.round((task.progress / task.target) * 100)) : 0;
  const rewardLabel =
    task.reward_type === "currency" ? `${task.reward_currency} VɎ` : "🎴 a card";

  return (
    <article className="task-card">
      <p className="task-card__text">{task.display_text}</p>

      <div className="task-card__progress-track">
        <div className="task-card__progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="task-card__progress-label">
        {task.progress} / {task.target}
      </p>

      <div className="task-card__footer">
        <span className="task-card__reward">🎁 {rewardLabel}</span>
        <button
          type="button"
          className="sheet-button sheet-button--confirm task-card__claim"
          disabled={!task.done || claiming}
          onClick={() => onClaim(task.id)}
        >
          {claiming ? "Claiming…" : task.done ? "Claim" : "In progress"}
        </button>
      </div>
    </article>
  );
}
