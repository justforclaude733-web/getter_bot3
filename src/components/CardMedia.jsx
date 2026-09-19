// Renders a character's card art as either a photo or a video, depending
// on mediaType (set by the bot when the character was added with
// /addcharacter or /send - see media_type in the backend). Both tags
// share the same className so existing CSS (object-fit: cover, sizing,
// etc.) applies identically to either.
export default function CardMedia({ src, mediaType, alt, className, loading, onError }) {
  if (mediaType === "video") {
    return (
      <video
        className={className}
        src={src}
        autoPlay
        loop
        muted
        playsInline
        onError={onError}
      />
    );
  }

  return (
    <img className={className} src={src} alt={alt} loading={loading} onError={onError} />
  );
}
