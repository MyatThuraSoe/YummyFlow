import { PNG } from "pngjs";
import { escPosRaster, type Raster } from "./escpos.js";

/**
 * Convert a PNG into a packed 1-bit image for `GS v 0` (F-26).
 *
 * Cheap thermal printers cannot shape Burmese or Thai script, so the POS/KDS
 * renders the ticket with the tablet's fonts and sends the PNG here. Anything
 * darker than the threshold becomes a black dot; transparent pixels stay white.
 */
export function pngToRaster(png: Buffer, threshold = 160): Raster {
  const image = PNG.sync.read(png);
  const width = image.width;
  const height = image.height;
  const rowBytes = Math.ceil(width / 8);
  const data = Buffer.alloc(rowBytes * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = image.data[i + 3] ?? 255;
      const alphaWeight = alpha / 255;
      const red = image.data[i] ?? 255;
      const green = image.data[i + 1] ?? 255;
      const blue = image.data[i + 2] ?? 255;
      // Composite over white so semi-transparent anti-aliased glyph edges stay light.
      const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) * alphaWeight + 255 * (1 - alphaWeight);
      if (luminance < threshold) {
        const index = y * rowBytes + (x >> 3);
        data[index] = (data[index] ?? 0) | (0x80 >> (x & 7));
      }
    }
  }
  return { data, width, height };
}

/** Detect `data:image/png;base64,...` and return the decoded bytes. */
export function decodePngDataUrl(value: string): Buffer | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(value.trim());
  if (!match || !match[1]) return null;
  return Buffer.from(match[1], "base64");
}

/** Complete ESC/POS job for a PNG image. */
export function pngToEscPos(png: Buffer, opts: { beep?: boolean } = {}): Buffer {
  return escPosRaster(pngToRaster(png), opts);
}
