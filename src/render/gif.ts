import sharp from 'sharp';
import { MemeError } from '../spec.js';

export interface TextOverlay {
  svg: Buffer;
  frames?: [number, number];
}

/**
 * Composite text overlays onto an animated GIF, preserving frame timing and
 * loop count. sharp represents an animated image as a vertically-stacked
 * canvas of pages, so each overlay is composited once per applicable frame
 * at that frame's vertical offset.
 */
export async function renderGif(inputPath: string, overlays: TextOverlay[]): Promise<Buffer> {
  let image: sharp.Sharp;
  let meta: sharp.Metadata;
  try {
    image = sharp(inputPath, { animated: true });
    meta = await image.metadata();
  } catch (err) {
    throw new MemeError('IO_ERROR', `cannot read GIF "${inputPath}": ${(err as Error).message}`);
  }
  const frameCount = meta.pages ?? 1;
  const frameHeight = meta.pageHeight ?? meta.height ?? 0;

  const composites: sharp.OverlayOptions[] = [];
  for (let i = 0; i < frameCount; i++) {
    for (const o of overlays) {
      if (o.frames && (i < o.frames[0] || i > o.frames[1])) continue;
      composites.push({ input: o.svg, left: 0, top: i * frameHeight });
    }
  }
  if (composites.length > 0) image = image.composite(composites);

  return image.gif({ loop: meta.loop ?? 0, delay: meta.delay }).toBuffer();
}

export async function gifFrameInfo(
  inputPath: string,
): Promise<{ frames: number; width: number; height: number }> {
  const meta = await sharp(inputPath, { animated: true }).metadata();
  return {
    frames: meta.pages ?? 1,
    width: meta.width ?? 0,
    height: meta.pageHeight ?? meta.height ?? 0,
  };
}
