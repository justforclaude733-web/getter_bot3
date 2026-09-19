export default function SkeletonCard() {
  return (
    <div className="character-card skeleton-card" aria-hidden="true">
      <div className="skeleton-card__art skeleton-shimmer" />
      <div className="character-card__body">
        <div className="skeleton-line skeleton-line--name skeleton-shimmer" />
        <div className="skeleton-line skeleton-line--meta skeleton-shimmer" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }) {
  return (
    <div className="card-grid">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
