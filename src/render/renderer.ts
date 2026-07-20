import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { getTemplate, templateImagePath } from '../catalog.js';
import { MemeError, parseMemeSpec, type MemeSpec, type Template, type TextBox } from '../spec.js';
import { renderGif, type TextOverlay } from './gif.js';
import { renderCanvasBase, renderLayoutBase } from './layout.js';
import { renderTextLayer, type Rect } from './text.js';

export interface RenderResult {
  path?: string;
  buffer: Buffer;
  format: 'png' | 'jpeg' | 'gif' | 'webp';
  width: number;
  height: number;
  bytes: number;
  warnings: string[];
}

function parseDim(value: number | string | undefined, total: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return value;
  return (parseFloat(value) / 100) * total;
}

function resolveRect(
  box: TextBox,
  template: Template | null,
  width: number,
  height: number,
): {
  rect: Rect;
  defaults?: {
    style?: TextBox['style'];
    anchor?: 'top' | 'middle' | 'bottom';
    align?: 'left' | 'center' | 'right';
  };
} {
  if (box.slot !== undefined) {
    if (!template) {
      throw new MemeError('SLOT_NOT_FOUND', `slot "${box.slot}" given but base is not a template`);
    }
    const slot = template.slots.find((s) => s.name === box.slot);
    if (!slot) {
      throw new MemeError(
        'SLOT_NOT_FOUND',
        `template "${template.id}" has no slot "${box.slot}"; slots: ${template.slots.map((s) => s.name).join(', ')}`,
      );
    }
    const [x, y, w, h] = slot.rect;
    return {
      rect: { x, y, width: w, height: h },
      defaults: { style: slot.style, anchor: slot.anchor, align: slot.align },
    };
  }
  const w = parseDim(box.width, width, width * 0.9);
  const h = parseDim(box.height, height, height * 0.25);
  const x = parseDim(box.x, width, (width - w) / 2);
  const y = parseDim(box.y, height, (height - h) / 2);
  return { rect: { x, y, width: w, height: h } };
}

async function buildBase(
  spec: MemeSpec,
): Promise<{
  buffer?: Buffer;
  gifPath?: string;
  template: Template | null;
  width: number;
  height: number;
}> {
  const { base } = spec;
  switch (base.kind) {
    case 'template': {
      const template = getTemplate(base.id);
      const path = templateImagePath(template);
      if (template.type === 'gif') {
        return { gifPath: path, template, width: template.width, height: template.height };
      }
      return {
        buffer: await sharp(path).toBuffer(),
        template,
        width: template.width,
        height: template.height,
      };
    }
    case 'image': {
      let meta: sharp.Metadata;
      try {
        meta = await sharp(base.path).metadata();
      } catch (err) {
        throw new MemeError(
          'IO_ERROR',
          `cannot read image "${base.path}": ${(err as Error).message}`,
        );
      }
      const isGif = meta.format === 'gif' && (meta.pages ?? 1) > 1;
      if (isGif) {
        return {
          gifPath: base.path,
          template: null,
          width: meta.width ?? 0,
          height: meta.pageHeight ?? meta.height ?? 0,
        };
      }
      return {
        buffer: await sharp(base.path).toBuffer(),
        template: null,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
      };
    }
    case 'canvas':
      return {
        buffer: await renderCanvasBase(base),
        template: null,
        width: base.width,
        height: base.height,
      };
    case 'layout': {
      const buffer = await renderLayoutBase(base);
      const meta = await sharp(buffer).metadata();
      return { buffer, template: null, width: meta.width ?? 0, height: meta.height ?? 0 };
    }
  }
}

export async function renderMeme(input: MemeSpec | unknown): Promise<RenderResult> {
  const spec = parseMemeSpec(input);
  const { buffer, gifPath, template, width, height } = await buildBase(spec);
  const warnings: string[] = [];

  const overlays: TextOverlay[] = spec.texts.map((box) => {
    const { rect, defaults } = resolveRect(box, template, width, height);
    const layer = renderTextLayer(box, rect, width, height, defaults);
    if (layer.overflow) {
      warnings.push(`text "${box.text.slice(0, 30)}..." overflows its box even at minimum size`);
    }
    return { svg: Buffer.from(layer.svg), frames: box.frames };
  });

  const isGif = gifPath !== undefined;
  const format = spec.output.format ?? (isGif ? 'gif' : 'png');

  let out: Buffer;
  let outWidth = width;
  let outHeight = height;
  if (isGif) {
    if (format !== 'gif') {
      throw new MemeError('INVALID_SPEC', `animated base requires gif output, got "${format}"`);
    }
    out = await renderGif(gifPath, overlays);
  } else {
    let pipeline = sharp(buffer).composite(
      overlays.map((o) => ({ input: o.svg, left: 0, top: 0 })),
    );
    if (spec.output.maxWidth && spec.output.maxWidth < width) {
      // composite before resize is not supported in one pass; flatten first
      const flat = await pipeline.png().toBuffer();
      pipeline = sharp(flat).resize({ width: spec.output.maxWidth });
      const scale = spec.output.maxWidth / width;
      outWidth = spec.output.maxWidth;
      outHeight = Math.round(height * scale);
    }
    const quality = spec.output.quality;
    if (format === 'png') pipeline = pipeline.png();
    else if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: quality ?? 90 });
    else if (format === 'webp') pipeline = pipeline.webp({ quality: quality ?? 90 });
    else pipeline = pipeline.gif();
    out = await pipeline.toBuffer();
  }

  const result: RenderResult = {
    buffer: out,
    format,
    width: Math.round(outWidth),
    height: Math.round(outHeight),
    bytes: out.length,
    warnings,
  };

  if (spec.output.path) {
    try {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(spec.output.path, out);
    } catch (err) {
      throw new MemeError(
        'IO_ERROR',
        `cannot write "${spec.output.path}": ${(err as Error).message}`,
      );
    }
    result.path = spec.output.path;
  }
  return result;
}

export function defaultOutputName(spec: MemeSpec, format: string): string {
  const hash = createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, 8);
  const name = spec.base.kind === 'template' ? spec.base.id : spec.base.kind;
  return `meme-${name}-${hash}.${format}`;
}
