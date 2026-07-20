import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderMeme } from '../src/render/renderer.js';
import { MemeError } from '../src/spec.js';

const GOLDEN_DIR = join(__dirname, 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/** Mean absolute per-channel pixel difference between two encoded images. */
async function pixelDiff(a: Buffer, b: Buffer): Promise<number> {
  const [ra, rb] = await Promise.all([
    sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  expect(ra.info.width).toBe(rb.info.width);
  expect(ra.info.height).toBe(rb.info.height);
  let total = 0;
  for (let i = 0; i < ra.data.length; i++) total += Math.abs(ra.data[i]! - rb.data[i]!);
  return total / ra.data.length;
}

async function expectGolden(name: string, buffer: Buffer): Promise<void> {
  const path = join(GOLDEN_DIR, name);
  if (UPDATE || !existsSync(path)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(path, buffer);
    return;
  }
  const diff = await pixelDiff(readFileSync(path), buffer);
  expect(diff, `${name} differs from golden by ${diff}`).toBeLessThan(1);
}

describe('renderMeme', () => {
  it('renders the classic drake meme (golden)', async () => {
    const result = await renderMeme({
      base: { kind: 'template', id: 'drake' },
      texts: [
        { slot: 'no', text: 'MANUAL EDITORS' },
        { slot: 'yes', text: 'AGENT CLIS' },
      ],
      output: {},
    });
    expect(result.format).toBe('png');
    expect(result.width).toBe(1200);
    await expectGolden('drake.png', result.buffer);
  });

  it('renders free-placement text on a blank canvas (golden)', async () => {
    const result = await renderMeme({
      base: { kind: 'canvas', width: 600, height: 400, color: '#1e3a5f' },
      texts: [{ text: 'HELLO AGENTS', y: '10%', height: '30%' }],
      output: {},
    });
    expect(result.width).toBe(600);
    await expectGolden('canvas.png', result.buffer);
  });

  it('renders a 2x1 layout with cell images (golden)', async () => {
    const cell = join(__dirname, '..', 'assets', 'templates', 'images', 'this-is-fine.jpg');
    const result = await renderMeme({
      base: { kind: 'layout', grid: [2, 1], cells: [{ image: cell }, { image: cell }], width: 600 },
      texts: [],
      output: {},
    });
    await expectGolden('layout.png', result.buffer);
  });

  it('is deterministic: identical spec, identical bytes', async () => {
    const spec = {
      base: { kind: 'template', id: 'two-buttons' },
      texts: [
        { slot: 'left', text: 'SHIP IT' },
        { slot: 'right', text: 'TEST IT' },
      ],
      output: {},
    };
    const [a, b] = await Promise.all([renderMeme(spec), renderMeme(spec)]);
    expect(a.buffer.equals(b.buffer)).toBe(true);
  });

  it('supports jpeg output and maxWidth downscaling', async () => {
    const result = await renderMeme({
      base: { kind: 'template', id: 'drake' },
      texts: [{ slot: 'yes', text: 'SMALL' }],
      output: { format: 'jpeg', maxWidth: 300 },
    });
    expect(result.width).toBe(300);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(300);
  });

  it('throws SLOT_NOT_FOUND for a bad slot', async () => {
    await expect(
      renderMeme({
        base: { kind: 'template', id: 'drake' },
        texts: [{ slot: 'bogus', text: 'X' }],
        output: {},
      }),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });
  });

  it('throws TEMPLATE_NOT_FOUND for a bad template', async () => {
    await expect(
      renderMeme({ base: { kind: 'template', id: 'bogus' }, texts: [], output: {} }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
  });

  it('throws IO_ERROR for a missing image path', async () => {
    await expect(
      renderMeme({ base: { kind: 'image', path: '/nope/missing.png' }, texts: [], output: {} }),
    ).rejects.toMatchObject({ code: 'IO_ERROR' });
  });

  it('reports overflow warnings instead of corrupting output', async () => {
    const result = await renderMeme({
      base: { kind: 'canvas', width: 60, height: 40 },
      texts: [
        {
          text: 'AN EXTREMELY LONG CAPTION THAT CANNOT POSSIBLY FIT',
          x: 0,
          y: 0,
          width: 20,
          height: 10,
        },
      ],
      output: {},
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(60);
  });

  it('supports top/middle/bottom band slots on non-template bases', async () => {
    const result = await renderMeme({
      base: { kind: 'canvas', width: 600, height: 400 },
      texts: [
        { slot: 'top', text: 'TOP' },
        { slot: 'bottom', text: 'BOTTOM' },
      ],
      output: {},
    });
    expect(result.width).toBe(600);
    await expect(
      renderMeme({
        base: { kind: 'canvas', width: 600, height: 400 },
        texts: [{ slot: 'sideways', text: 'NOPE' }],
        output: {},
      }),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });
  });

  it('rejects layout with too many cells', async () => {
    await expect(
      renderMeme({
        base: {
          kind: 'layout',
          grid: [1, 1],
          cells: [{ image: 'a.png' }, { image: 'b.png' }],
        },
        texts: [],
        output: {},
      }),
    ).rejects.toBeInstanceOf(MemeError);
  });
});
