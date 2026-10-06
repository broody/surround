import { useEffect, useState } from "react";

/** A character portrait that crossfades when the expression changes. */
export default function CharacterPortrait({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  const [shown, setShown] = useState(src);
  const [leaving, setLeaving] = useState<string | null>(null);
  useEffect(() => {
    if (src === shown) return;
    let cancelled = false;
    // Wait for the new expression so the fade never passes a blank frame.
    const next = new Image();
    next.src = src;
    void next
      .decode()
      .catch(() => {})
      .then(() => {
        if (cancelled) return;
        // Without animations nothing would clear the old layer.
        const still = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        setLeaving(still ? null : shown);
        setShown(src);
      });
    return () => {
      cancelled = true;
    };
  }, [src, shown]);
  return (
    <div className="character-portrait">
      {leaving && (
        <img key={leaving} src={leaving} alt="" className="leaving" />
      )}
      <img
        key={shown}
        src={shown}
        alt={alt}
        className={leaving ? "entering" : undefined}
        onAnimationEnd={() => setLeaving(null)}
      />
    </div>
  );
}
