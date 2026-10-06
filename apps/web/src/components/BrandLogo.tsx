/** Surround's logo, drawn by scripts/build-brand.py: the badge and wordmark.
 * A compact logo shows the badge alone on a phone, where the header has no
 * room for both. */
export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <picture>
      {compact && (
        <source
          media="(max-width: 420px)"
          srcSet="/assets/brand/surround-mark.svg"
          width={38}
          height={38}
        />
      )}
      <img
        className="brand-logo"
        src="/assets/brand/surround-logo.svg"
        alt="Surround"
        width={196}
        height={38}
      />
    </picture>
  );
}
