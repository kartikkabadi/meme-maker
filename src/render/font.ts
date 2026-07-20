import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FONTS_DIR } from '../catalog.js';
import { MemeError } from '../spec.js';

/**
 * Minimal TrueType font reader: glyph advance widths and outlines.
 * Parsing the font directly (instead of relying on fontconfig/pango)
 * keeps rendering deterministic across platforms.
 */

interface GlyphContour {
  points: { x: number; y: number; onCurve: boolean }[];
}

export interface Glyph {
  advanceWidth: number;
  contours: GlyphContour[];
  index: number;
}

export class Font {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  private readonly data: Buffer;
  private readonly tables = new Map<string, { offset: number; length: number }>();
  private readonly cmap = new Map<number, number>();
  private readonly loca: number[];
  private readonly glyfOffset: number;
  private readonly advances: number[];
  private readonly glyphCache = new Map<number, Glyph>();

  constructor(path: string) {
    this.data = readFileSync(path);
    const numTables = this.data.readUInt16BE(4);
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      const tag = this.data.toString('ascii', o, o + 4);
      this.tables.set(tag, {
        offset: this.data.readUInt32BE(o + 8),
        length: this.data.readUInt32BE(o + 12),
      });
    }
    const head = this.table('head');
    this.unitsPerEm = this.data.readUInt16BE(head + 18);
    const indexToLocFormat = this.data.readInt16BE(head + 50);
    const hhea = this.table('hhea');
    this.ascender = this.data.readInt16BE(hhea + 4);
    this.descender = this.data.readInt16BE(hhea + 6);
    const numberOfHMetrics = this.data.readUInt16BE(hhea + 34);
    const maxp = this.table('maxp');
    const numGlyphs = this.data.readUInt16BE(maxp + 4);
    const hmtx = this.table('hmtx');
    this.advances = [];
    let advance = 0;
    for (let i = 0; i < numGlyphs; i++) {
      if (i < numberOfHMetrics) advance = this.data.readUInt16BE(hmtx + i * 4);
      this.advances.push(advance);
    }
    this.parseCmap();
    const locaOffset = this.table('loca');
    this.loca = [];
    for (let i = 0; i <= numGlyphs; i++) {
      this.loca.push(
        indexToLocFormat === 0
          ? this.data.readUInt16BE(locaOffset + i * 2) * 2
          : this.data.readUInt32BE(locaOffset + i * 4),
      );
    }
    this.glyfOffset = this.table('glyf');
  }

  private table(tag: string): number {
    const t = this.tables.get(tag);
    if (!t) throw new MemeError('IO_ERROR', `font missing required table "${tag}"`);
    return t.offset;
  }

  private parseCmap(): void {
    const cmapOffset = this.table('cmap');
    const numTables = this.data.readUInt16BE(cmapOffset + 2);
    let best = -1;
    for (let i = 0; i < numTables; i++) {
      const o = cmapOffset + 4 + i * 8;
      const platformId = this.data.readUInt16BE(o);
      const encodingId = this.data.readUInt16BE(o + 2);
      const subOffset = this.data.readUInt32BE(o + 4);
      if ((platformId === 3 && (encodingId === 1 || encodingId === 10)) || platformId === 0) {
        best = cmapOffset + subOffset;
      }
    }
    if (best < 0) throw new MemeError('IO_ERROR', 'font has no usable cmap subtable');
    const format = this.data.readUInt16BE(best);
    if (format === 4) {
      const segCount = this.data.readUInt16BE(best + 6) / 2;
      const endsOff = best + 14;
      const startsOff = endsOff + segCount * 2 + 2;
      const deltasOff = startsOff + segCount * 2;
      const rangesOff = deltasOff + segCount * 2;
      for (let seg = 0; seg < segCount; seg++) {
        const end = this.data.readUInt16BE(endsOff + seg * 2);
        const start = this.data.readUInt16BE(startsOff + seg * 2);
        const delta = this.data.readInt16BE(deltasOff + seg * 2);
        const rangeOffset = this.data.readUInt16BE(rangesOff + seg * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyphIndex: number;
          if (rangeOffset === 0) {
            glyphIndex = (c + delta) & 0xffff;
          } else {
            const addr = rangesOff + seg * 2 + rangeOffset + (c - start) * 2;
            glyphIndex = this.data.readUInt16BE(addr);
            if (glyphIndex !== 0) glyphIndex = (glyphIndex + delta) & 0xffff;
          }
          if (glyphIndex !== 0) this.cmap.set(c, glyphIndex);
        }
      }
    } else if (format === 12) {
      const nGroups = this.data.readUInt32BE(best + 12);
      for (let g = 0; g < nGroups; g++) {
        const o = best + 16 + g * 12;
        const start = this.data.readUInt32BE(o);
        const end = this.data.readUInt32BE(o + 4);
        const startGlyph = this.data.readUInt32BE(o + 8);
        for (let c = start; c <= end; c++) this.cmap.set(c, startGlyph + (c - start));
      }
    } else {
      throw new MemeError('IO_ERROR', `unsupported cmap format ${format}`);
    }
  }

  glyphIndex(codePoint: number): number {
    return this.cmap.get(codePoint) ?? 0;
  }

  glyph(codePoint: number): Glyph {
    const index = this.glyphIndex(codePoint);
    const cached = this.glyphCache.get(index);
    if (cached) return cached;
    const glyph: Glyph = {
      index,
      advanceWidth: this.advances[index] ?? this.advances[this.advances.length - 1] ?? 0,
      contours: this.parseGlyphOutline(index),
    };
    this.glyphCache.set(index, glyph);
    return glyph;
  }

  private parseGlyphOutline(index: number, depth = 0): GlyphContour[] {
    if (depth > 5) return [];
    const start = this.loca[index];
    const end = this.loca[index + 1];
    if (start === undefined || end === undefined || start === end) return [];
    const o = this.glyfOffset + start;
    const numberOfContours = this.data.readInt16BE(o);
    if (numberOfContours < 0) return this.parseComposite(o + 10, depth);
    const endPts: number[] = [];
    for (let i = 0; i < numberOfContours; i++) {
      endPts.push(this.data.readUInt16BE(o + 10 + i * 2));
    }
    const numPoints = (endPts[endPts.length - 1] ?? -1) + 1;
    const instructionLength = this.data.readUInt16BE(o + 10 + numberOfContours * 2);
    let p = o + 12 + numberOfContours * 2 + instructionLength;
    const flags: number[] = [];
    while (flags.length < numPoints) {
      const flag = this.data.readUInt8(p++);
      flags.push(flag);
      if (flag & 8) {
        let repeat = this.data.readUInt8(p++);
        while (repeat-- > 0) flags.push(flag);
      }
    }
    const xs: number[] = [];
    let x = 0;
    for (const flag of flags) {
      if (flag & 2) {
        const dx = this.data.readUInt8(p++);
        x += flag & 16 ? dx : -dx;
      } else if (!(flag & 16)) {
        x += this.data.readInt16BE(p);
        p += 2;
      }
      xs.push(x);
    }
    const ys: number[] = [];
    let y = 0;
    for (const flag of flags) {
      if (flag & 4) {
        const dy = this.data.readUInt8(p++);
        y += flag & 32 ? dy : -dy;
      } else if (!(flag & 32)) {
        y += this.data.readInt16BE(p);
        p += 2;
      }
      ys.push(y);
    }
    const contours: GlyphContour[] = [];
    let pointIndex = 0;
    for (const endPt of endPts) {
      const contour: GlyphContour = { points: [] };
      for (; pointIndex <= endPt; pointIndex++) {
        contour.points.push({
          x: xs[pointIndex]!,
          y: ys[pointIndex]!,
          onCurve: (flags[pointIndex]! & 1) !== 0,
        });
      }
      contours.push(contour);
    }
    return contours;
  }

  private parseComposite(offset: number, depth: number): GlyphContour[] {
    const contours: GlyphContour[] = [];
    let p = offset;
    let more = true;
    while (more) {
      const flags = this.data.readUInt16BE(p);
      const glyphIndex = this.data.readUInt16BE(p + 2);
      p += 4;
      let dx = 0;
      let dy = 0;
      if (flags & 1) {
        dx = this.data.readInt16BE(p);
        dy = this.data.readInt16BE(p + 2);
        p += 4;
      } else {
        dx = this.data.readInt8(p);
        dy = this.data.readInt8(p + 1);
        p += 2;
      }
      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      if (flags & 8) {
        a = d = this.data.readInt16BE(p) / 16384;
        p += 2;
      } else if (flags & 64) {
        a = this.data.readInt16BE(p) / 16384;
        d = this.data.readInt16BE(p + 2) / 16384;
        p += 4;
      } else if (flags & 128) {
        a = this.data.readInt16BE(p) / 16384;
        b = this.data.readInt16BE(p + 2) / 16384;
        c = this.data.readInt16BE(p + 4) / 16384;
        d = this.data.readInt16BE(p + 6) / 16384;
        p += 8;
      }
      for (const contour of this.parseGlyphOutline(glyphIndex, depth + 1)) {
        contours.push({
          points: contour.points.map((pt) => ({
            x: a * pt.x + c * pt.y + dx,
            y: b * pt.x + d * pt.y + dy,
            onCurve: pt.onCurve,
          })),
        });
      }
      more = (flags & 32) !== 0;
    }
    return contours;
  }
}

const fontCache = new Map<string, Font>();

export const BUILTIN_FONTS: Record<string, string> = {
  anton: 'Anton-Regular.ttf',
};

export const DEFAULT_FONT = 'anton';

export function loadFont(name: string = DEFAULT_FONT): Font {
  const key = name.toLowerCase();
  const cached = fontCache.get(key);
  if (cached) return cached;
  const file = BUILTIN_FONTS[key];
  if (!file) {
    throw new MemeError(
      'INVALID_SPEC',
      `unknown font "${name}"; available: ${Object.keys(BUILTIN_FONTS).join(', ')}`,
    );
  }
  const font = new Font(join(FONTS_DIR, file));
  fontCache.set(key, font);
  return font;
}
