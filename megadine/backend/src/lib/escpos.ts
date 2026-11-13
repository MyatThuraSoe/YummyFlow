/**
 * Minimal ESC/POS command builder (F-26).
 *
 * Thermal printers are not text terminals: a job needs an initialise command,
 * an explicit code page, line feeds and a cut, otherwise the first ticket of
 * the day can inherit the previous job's font and the last one is never cut.
 * This module builds those byte sequences without pulling in a printer SDK.
 */

export const ESC = 0x1b;
export const GS = 0x1d;

export type Align = "left" | "center" | "right";

/** Common single-byte code pages. 0 = CP437, 16 = CP1252, 255 = Thai. */
export const CODEPAGES = {
  cp437: 0,
  cp850: 2,
  cp858: 19,
  cp1252: 16,
  cp874: 255,
} as const;

export interface Raster {
  /** Packed 1-bit rows, MSB first. */
  data: Buffer;
  width: number;
  height: number;
}

export class EscPosBuilder {
  private readonly parts: Buffer[] = [];

  raw(bytes: number[] | Buffer): this {
    this.parts.push(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    return this;
  }

  /** ESC @ — reset the printer before every job. */
  init(): this {
    return this.raw([ESC, 0x40]);
  }

  /** ESC t n — select the code page used for the following text. */
  codepage(n: number): this {
    return this.raw([ESC, 0x74, n & 0xff]);
  }

  /** ESC a n — 0 left, 1 centre, 2 right. */
  align(align: Align): this {
    return this.raw([ESC, 0x61, align === "center" ? 1 : align === "right" ? 2 : 0]);
  }

  /** ESC E n — emphasised text. */
  bold(on = true): this {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }

  /** GS ! n — width/height multipliers (1-8). */
  size(width = 1, height = 1): this {
    const n = ((Math.min(8, Math.max(1, width)) - 1) << 4) | (Math.min(8, Math.max(1, height)) - 1);
    return this.raw([GS, 0x21, n]);
  }

  text(value: string, encoding: BufferEncoding = "utf8"): this {
    return this.raw(Buffer.from(value, encoding));
  }

  newline(count = 1): this {
    return this.raw(new Array(Math.max(1, count)).fill(0x0a));
  }

  /** ESC d n — feed n lines before the cut. */
  feed(lines = 3): this {
    return this.raw([ESC, 0x64, Math.min(255, Math.max(1, lines))]);
  }

  /** BEL — a short beep on the printers that expose a buzzer. */
  beep(times = 1): this {
    return this.raw(new Array(Math.min(5, Math.max(1, times))).fill(0x07));
  }

  /** GS V — feed and cut. 66 = partial cut with feed, 65 = full cut. */
  cut(partial = true): this {
    return this.raw([GS, 0x56, partial ? 66 : 65, 3]);
  }

  /** GS v 0 — raster bit image (used for Burmese/Thai text and logos). */
  raster(image: Raster): this {
    const widthBytes = Math.ceil(image.width / 8);
    const xL = widthBytes & 0xff;
    const xH = (widthBytes >> 8) & 0xff;
    const yL = image.height & 0xff;
    const yH = (image.height >> 8) & 0xff;
    return this.raw([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]).raw(image.data);
  }

  build(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/** Wrap plain text in a complete job: init, code page, body, feed, cut. */
export function escPosText(
  text: string,
  opts: { codepage?: number; encoding?: BufferEncoding; beep?: boolean; align?: Align } = {},
): Buffer {
  const b = new EscPosBuilder().init();
  if (opts.codepage !== undefined) b.codepage(opts.codepage);
  if (opts.align) b.align(opts.align);
  if (opts.beep) b.beep(1);
  b.text(text, opts.encoding ?? "utf8");
  b.feed(3).cut();
  return b.build();
}

/** A complete job that prints only a bitmap (Burmese label path). */
export function escPosRaster(image: Raster, opts: { beep?: boolean } = {}): Buffer {
  const b = new EscPosBuilder().init();
  if (opts.beep) b.beep(1);
  b.raster(image).feed(3).cut();
  return b.build();
}
