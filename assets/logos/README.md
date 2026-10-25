# Engram logos

The source artwork, as delivered (PNG, 2026-10-25), on a near-black (#09090E) background:

| file           | variant                                              |
| -------------- | ---------------------------------------------------- |
| `primary.png`  | primary (horizontal): the README banner, social card |
| `stacked.png`  | stacked: `/architecture` header, the 404 page        |
| `wordmark.png` | wordmark: the site footer                            |
| `icon.png`     | icon / monogram: favicon, app icons, the bare mark   |
| `badge.png`    | badge / emblem: the site footer, the README sign-off |

`python3 scripts/brand-assets.py` (Pillow) derives everything else from these: transparent dark and light variants in `assets/brand/`, the web app's `icon.png`, `apple-icon.png` and `opengraph-image.png`, and the copies in `apps/web/public/brand/`. The site's nav and hero draw the mark as SVG (`apps/web/src/components/brand/mark.tsx`). Rerun the script after changing a logo; its outputs are committed.
