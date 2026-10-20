import type { ImgHTMLAttributes } from 'react'

/**
 * A brand image from public/brand as AVIF, then WebP, then the PNG (docs/BRAND.md). `name` is the file name without its
 * extension ("logo-mark", "logo-wordmark"). The <picture> is `display: contents`, so the <img> lays out exactly as before.
 * The PDFs keep using the PNG directly (the PDF engine reads PNG only).
 */
export function BrandImage({ name, ...img }: { name: 'logo-mark' | 'logo-wordmark' } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  return (
    <picture className="contents">
      <source type="image/avif" srcSet={`/brand/${name}.avif`} />
      <source type="image/webp" srcSet={`/brand/${name}.webp`} />
      <img src={`/brand/${name}.png`} {...img} />
    </picture>
  )
}
