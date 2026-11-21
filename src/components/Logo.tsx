import { useEffect, useState } from 'react';

// The shop's logo lives at public/logo.png. It is tidied up once when the app opens: the empty margin around it
// is trimmed away and the cream background is made see-through, so it sits cleanly on any colour and on a printed invoice.

const LOGO_URL = '/logo.png';
const MAX_WIDTH = 900;

let result: string | null | undefined; // undefined = not tried yet, null = no logo file
let pending: Promise<string | null> | null = null;

function prepareLogo(): Promise<string | null> {
  if (result !== undefined) return Promise.resolve(result);
  if (pending) return pending;
  pending = new Promise<string | null>((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const { naturalWidth: w, naturalHeight: h } = img;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(LOGO_URL);
        ctx.drawImage(img, 0, 0);
        const image = ctx.getImageData(0, 0, w, h);
        const px = image.data;

        // The background colour is whatever the four corners are (unless the file is already see-through).
        const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
        const opaque = corners.every((i) => px[i + 3] > 200);
        const bg = [0, 1, 2].map((c) => corners.reduce((s, i) => s + px[i + c], 0) / corners.length);

        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            let alpha = px[i + 3] / 255;
            if (opaque) {
              const d = Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2]));
              // fade smoothly from "same as the background" (see-through) to "clearly drawn" (solid)
              alpha = Math.min(1, Math.max(0, (d - 8) / 48));
              px[i + 3] = Math.round(alpha * 255);
            }
            if (alpha > 0.25) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) return resolve(LOGO_URL);
        ctx.putImageData(image, 0, 0);

        const pad = 6;
        const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
        const sw = Math.min(w, maxX + pad) - sx, sh = Math.min(h, maxY + pad) - sy;
        const scale = Math.min(1, MAX_WIDTH / sw);
        const out = document.createElement('canvas');
        out.width = Math.round(sw * scale);
        out.height = Math.round(sh * scale);
        out.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
        resolve(out.toDataURL('image/png'));
      } catch {
        resolve(LOGO_URL); // could not be processed: use the file as it is
      }
    };
    img.src = LOGO_URL;
  }).then((r) => {
    result = r;
    return r;
  });
  return pending;
}

/** The ready-to-use logo image, or null when public/logo.png has not been added. */
export function useLogo(): { src: string | null } {
  const [src, setSrc] = useState<string | null>(result ?? null);
  useEffect(() => {
    let alive = true;
    prepareLogo().then((r) => { if (alive) setSrc(r); });
    return () => { alive = false; };
  }, []);
  return { src };
}

/** A small stand-in mark in the logo's colours, shown until the real logo file is added. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Mahaveer Agencies" className="shrink-0">
      <defs>
        <linearGradient id="mark-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F28C2C" />
          <stop offset="1" stopColor="#D9A93E" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="27" fill="none" stroke="url(#mark-ring)" strokeWidth="4" strokeLinecap="round" strokeDasharray="140 30" transform="rotate(-40 32 32)" />
      <text x="32" y="43" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight="700" fontSize="30" fill="#17497F">M</text>
    </svg>
  );
}
