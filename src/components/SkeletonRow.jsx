export default function SkeletonRow() {
  return (
    <div className="leaderboard-row leaderboard-row--flat skeleton-row" aria-hidden="true">
      <div className="skeleton-line skeleton-line--rank skeleton-shimmer" />
      <div className="skeleton-line skeleton-line--title skeleton-shimmer" />
      <div className="skeleton-line skeleton-line--count skeleton-shimmer" />
    </div>
  );
}

export function SkeletonRowList({ count = 6 }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </>
  );
}
