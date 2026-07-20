import { describe, expect, it } from 'vitest';
import { MemeError, parseMemeSpec } from '../src/spec.js';

describe('parseMemeSpec', () => {
  it('accepts a minimal template spec', () => {
    const spec = parseMemeSpec({ base: { kind: 'template', id: 'drake' }, texts: [] });
    expect(spec.base.kind).toBe('template');
    expect(spec.output).toEqual({});
  });

  it('accepts canvas and layout bases', () => {
    expect(parseMemeSpec({ base: { kind: 'canvas', width: 100, height: 50 } }).texts).toEqual([]);
    const layout = parseMemeSpec({
      base: { kind: 'layout', grid: [2, 2], cells: [{ image: 'a.png' }] },
    });
    expect(layout.base.kind).toBe('layout');
  });

  it('accepts percent placement strings', () => {
    const spec = parseMemeSpec({
      base: { kind: 'canvas', width: 100, height: 100 },
      texts: [{ text: 'hi', x: '10%', y: '5%', width: '80%' }],
    });
    expect(spec.texts[0]?.x).toBe('10%');
  });

  it('rejects unknown base kinds with INVALID_SPEC', () => {
    try {
      parseMemeSpec({ base: { kind: 'video' }, texts: [] });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MemeError);
      expect((err as MemeError).code).toBe('INVALID_SPEC');
    }
  });

  it('rejects bad style values', () => {
    expect(() =>
      parseMemeSpec({
        base: { kind: 'canvas', width: 10, height: 10 },
        texts: [{ text: 'x', style: { opacity: 2 } }],
      }),
    ).toThrowError(MemeError);
  });

  it('rejects unknown extra keys', () => {
    expect(() =>
      parseMemeSpec({ base: { kind: 'template', id: 'drake' }, texts: [], bogus: 1 }),
    ).toThrowError(MemeError);
  });
});
