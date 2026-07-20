import type { TextBox, TextStyle } from '../spec.js';
import { DEFAULT_FONT, loadFont, type Font, type Glyph } from './font.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolvedStyle {
  font: string;
  size: number | 'auto';
  color: string;
  stroke: string;
  strokeWidth: number | 'auto';
  background?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  rotation: number;
  opacity: number;
  lineHeight: number;
  caps: boolean;
}

export const CLASSIC_STYLE: ResolvedStyle = {
  font: DEFAULT_FONT,
  size: 'auto',
  color: '#ffffff',
  stroke: '#000000',
  strokeWidth: 'auto',
  bold: false,
  italic: false,
  underline: false,
  rotation: 0,
  opacity: 1,
  lineHeight: 1.1,
  caps: true,
};

export function resolveStyle(...overrides: (TextStyle | undefined)[]): ResolvedStyle {
  const style = { ...CLASSIC_STYLE };
  for (const o of overrides) {
    if (!o) continue;
    if (o.font !== undefined) style.font = o.font;
    if (o.size !== undefined) style.size = o.size;
    if (o.color !== undefined) style.color = o.color;
    if (o.stroke !== undefined) style.stroke = o.stroke;
    if (o.strokeWidth !== undefined) style.strokeWidth = o.strokeWidth;
    if (o.background !== undefined) style.background = o.background;
    if (o.bold !== undefined) style.bold = o.bold;
    if (o.italic !== undefined) style.italic = o.italic;
    if (o.underline !== undefined) style.underline = o.underline;
    if (o.rotation !== undefined) style.rotation = o.rotation;
    if (o.opacity !== undefined) style.opacity = o.opacity;
    if (o.lineHeight !== undefined) style.lineHeight = o.lineHeight;
    if (o.caps !== undefined) style.caps = o.caps;
  }
  return style;
}

export function measureText(text: string, font: Font, size: number): number {
  let units = 0;
  for (const ch of text) units += font.glyph(ch.codePointAt(0)!).advanceWidth;
  return (units / font.unitsPerEm) * size;
}

/** Greedy word wrap; words longer than maxWidth are placed on their own line. */
export function wrapText(text: string, font: Font, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && measureText(candidate, font, size) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export interface FittedText {
  lines: string[];
  size: number;
  lineHeightPx: number;
  overflow: boolean;
}

const MIN_SIZE = 8;

/** Vertical extent of a line in em, from the font's ascender/descender. */
function emFactor(font: Font): number {
  return (font.ascender - font.descender) / font.unitsPerEm;
}

function fits(text: string, font: Font, size: number, rect: Rect, lineHeight: number): boolean {
  const lines = wrapText(text, font, size, rect.width);
  const height = lines.length * size * lineHeight * emFactor(font);
  const widest = Math.max(...lines.map((l) => measureText(l, font, size)), 0);
  return height <= rect.height && widest <= rect.width;
}

/** Binary-search the largest integer font size whose wrapped text fits the rect. */
export function fitText(
  text: string,
  font: Font,
  rect: Rect,
  lineHeight: number,
  fixedSize?: number,
): FittedText {
  if (fixedSize !== undefined) {
    const lines = wrapText(text, font, fixedSize, rect.width);
    return {
      lines,
      size: fixedSize,
      lineHeightPx: fixedSize * lineHeight * emFactor(font),
      overflow: !fits(text, font, fixedSize, rect, lineHeight),
    };
  }
  const cap = Math.max(MIN_SIZE, Math.floor(rect.height / emFactor(font)));
  let lo = MIN_SIZE;
  let hi = cap;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (fits(text, font, mid, rect, lineHeight)) lo = mid;
    else hi = mid - 1;
  }
  const size = lo;
  return {
    lines: wrapText(text, font, size, rect.width),
    size,
    lineHeightPx: size * lineHeight * emFactor(font),
    overflow: !fits(text, font, size, rect, lineHeight),
  };
}

function glyphPath(glyph: Glyph, scale: number, dx: number, dy: number): string {
  let d = '';
  const fx = (x: number) => (dx + x * scale).toFixed(2);
  const fy = (y: number) => (dy - y * scale).toFixed(2);
  for (const contour of glyph.contours) {
    const pts = contour.points;
    if (pts.length === 0) continue;
    // Ensure we start on an on-curve point (synthesize midpoint if needed).
    let startIdx = pts.findIndex((p) => p.onCurve);
    let start: { x: number; y: number };
    if (startIdx === -1) {
      start = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
      startIdx = 0;
    } else {
      start = pts[startIdx]!;
    }
    d += `M${fx(start.x)} ${fy(start.y)}`;
    let prevOff: { x: number; y: number } | null = null;
    for (let i = 1; i <= pts.length; i++) {
      const pt = pts[(startIdx + i) % pts.length]!;
      const target = i === pts.length ? start : pt;
      if (i === pts.length && prevOff === null) break;
      if (pt.onCurve || i === pts.length) {
        if (prevOff) {
          d += `Q${fx(prevOff.x)} ${fy(prevOff.y)} ${fx(target.x)} ${fy(target.y)}`;
          prevOff = null;
        } else {
          d += `L${fx(target.x)} ${fy(target.y)}`;
        }
      } else {
        if (prevOff) {
          const mid = { x: (prevOff.x + pt.x) / 2, y: (prevOff.y + pt.y) / 2 };
          d += `Q${fx(prevOff.x)} ${fy(prevOff.y)} ${fx(mid.x)} ${fy(mid.y)}`;
        }
        prevOff = { x: pt.x, y: pt.y };
      }
    }
    if (prevOff) d += `Q${fx(prevOff.x)} ${fy(prevOff.y)} ${fx(start.x)} ${fy(start.y)}`;
    d += 'Z';
  }
  return d;
}

export interface TextLayer {
  svg: string;
  overflow: boolean;
}

/**
 * Render a text box as a full-canvas SVG overlay: glyph outlines as paths
 * (deterministic; no fontconfig/pango dependency), painted stroke-under-fill
 * for the classic meme outline.
 */
export function renderTextLayer(
  box: TextBox,
  rect: Rect,
  canvasWidth: number,
  canvasHeight: number,
  defaults?: {
    style?: TextStyle;
    anchor?: 'top' | 'middle' | 'bottom';
    align?: 'left' | 'center' | 'right';
  },
): TextLayer {
  const style = resolveStyle(defaults?.style, box.style);
  const font = loadFont(style.font);
  const text = style.caps ? box.text.toUpperCase() : box.text;
  const fitted = fitText(
    text,
    font,
    rect,
    style.lineHeight,
    style.size === 'auto' ? undefined : style.size,
  );
  const { lines, size, lineHeightPx } = fitted;
  const scale = size / font.unitsPerEm;
  const ascentPx = (font.ascender / font.unitsPerEm) * size;
  const blockHeight = lines.length * lineHeightPx;
  const anchor = box.anchor ?? defaults?.anchor ?? 'middle';
  const align = box.align ?? defaults?.align ?? 'center';
  const strokeWidth =
    style.strokeWidth === 'auto' ? Math.max(1, Math.round(size / 14)) : style.strokeWidth;

  let blockTop: number;
  if (anchor === 'top') blockTop = rect.y;
  else if (anchor === 'bottom') blockTop = rect.y + rect.height - blockHeight;
  else blockTop = rect.y + (rect.height - blockHeight) / 2;

  const paths: string[] = [];
  const underlines: string[] = [];
  lines.forEach((line, i) => {
    const lineWidth = measureText(line, font, size);
    let x: number;
    if (align === 'left') x = rect.x;
    else if (align === 'right') x = rect.x + rect.width - lineWidth;
    else x = rect.x + (rect.width - lineWidth) / 2;
    const emHeightPx = ((font.ascender - font.descender) / font.unitsPerEm) * size;
    const baseline = blockTop + i * lineHeightPx + (lineHeightPx - emHeightPx) / 2 + ascentPx;
    let d = '';
    let cursor = x;
    for (const ch of line) {
      const glyph = font.glyph(ch.codePointAt(0)!);
      d += glyphPath(glyph, scale, cursor, baseline);
      cursor += glyph.advanceWidth * scale;
    }
    if (d) paths.push(d);
    if (style.underline && line.length > 0) {
      const uy = (baseline + size * 0.08).toFixed(2);
      underlines.push(
        `<line x1="${x.toFixed(2)}" y1="${uy}" x2="${(x + lineWidth).toFixed(2)}" y2="${uy}" stroke="${style.color}" stroke-width="${Math.max(1, size / 16).toFixed(2)}"/>`,
      );
    }
  });

  const d = paths.join('');
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const transforms: string[] = [];
  if (style.rotation) transforms.push(`rotate(${style.rotation} ${cx} ${cy})`);
  if (style.italic) transforms.push(`translate(${cx} 0) skewX(-12) translate(${-cx} 0)`);
  const transform = transforms.length ? ` transform="${transforms.join(' ')}"` : '';
  const boldStroke = style.bold ? Math.max(1, size / 40) : 0;

  const background = style.background
    ? `<rect x="${rect.x}" y="${blockTop.toFixed(2)}" width="${rect.width}" height="${blockHeight.toFixed(2)}" fill="${style.background}"/>`
    : '';
  const strokeLayer =
    strokeWidth > 0 && d
      ? `<path d="${d}" fill="${style.stroke}" stroke="${style.stroke}" stroke-width="${(strokeWidth * 2 + boldStroke).toFixed(2)}" stroke-linejoin="round"/>`
      : '';
  const fillLayer = d
    ? `<path d="${d}" fill="${style.color}"${boldStroke ? ` stroke="${style.color}" stroke-width="${boldStroke.toFixed(2)}"` : ''}/>`
    : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">` +
    `<g opacity="${style.opacity}"${transform}>${background}${strokeLayer}${fillLayer}${underlines.join('')}</g>` +
    `</svg>`;
  return { svg, overflow: fitted.overflow };
}
