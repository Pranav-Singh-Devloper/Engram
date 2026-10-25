// A brand image in the variant that suits the theme: the dark and light PNGs
// come from scripts/brand-assets.py; both are in the page, and CSS shows one.
/** Brand images come in a dark and a light variant (scripts/brand-assets.py); the theme picks one. */
export function BrandImage({
  name,
  alt,
  className,
  width,
  height,
}: {
  name: string;
  alt: string;
  className: string;
  width: number;
  height: number;
}) {
  return (
    <>
      <img
        src={`/brand/${name}-dark.png`}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className={`hidden dark:block ${className}`}
      />
      <img
        src={`/brand/${name}-light.png`}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className={`block dark:hidden ${className}`}
      />
    </>
  );
}
