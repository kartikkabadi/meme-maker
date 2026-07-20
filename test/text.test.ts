import { describe, expect, it } from 'vitest';
import { loadFont } from '../src/render/font.js';
import { fitText, measureText, wrapText } from '../src/render/text.js';

const font = loadFont('anton');

describe('measureText', () => {
  it('is monotonic in text length and size', () => {
    expect(measureText('AB', font, 20)).toBeGreaterThan(measureText('A', font, 20));
    expect(measureText('A', font, 40)).toBeCloseTo(measureText('A', font, 20) * 2, 6);
  });

  it('is deterministic', () => {
    expect(measureText('HELLO WORLD', font, 32)).toBe(measureText('HELLO WORLD', font, 32));
  });
});

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(wrapText('HI', font, 20, 500)).toEqual(['HI']);
  });

  it('wraps long text into multiple lines that each fit', () => {
    const lines = wrapText('THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG', font, 20, 150);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureText(line, font, 20)).toBeLessThanOrEqual(150);
    }
    expect(lines.join(' ')).toBe('THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG');
  });

  it('respects explicit newlines', () => {
    expect(wrapText('A\nB', font, 20, 500)).toEqual(['A', 'B']);
  });

  it('puts an overlong word on its own line', () => {
    const lines = wrapText('HI SUPERCALIFRAGILISTIC', font, 20, 50);
    expect(lines).toContain('SUPERCALIFRAGILISTIC');
  });
});

describe('fitText', () => {
  const rect = { x: 0, y: 0, width: 400, height: 200 };

  it('picks a size whose wrapped text fits the rect', () => {
    const fitted = fitText('SOME MEDIUM LENGTH CAPTION', font, rect, 1.1);
    expect(fitted.overflow).toBe(false);
    expect(fitted.lines.length * fitted.lineHeightPx).toBeLessThanOrEqual(rect.height);
    for (const line of fitted.lines) {
      expect(measureText(line, font, fitted.size)).toBeLessThanOrEqual(rect.width);
    }
  });

  it('gives short text a larger size than long text', () => {
    const short = fitText('HI', font, rect, 1.1);
    const long = fitText('A MUCH LONGER CAPTION THAT NEEDS WRAPPING ACROSS LINES', font, rect, 1.1);
    expect(short.size).toBeGreaterThan(long.size);
  });

  it('flags overflow at minimum size', () => {
    const tiny = { x: 0, y: 0, width: 10, height: 10 };
    const fitted = fitText('IMPOSSIBLY LONG TEXT FOR A TINY BOX', font, tiny, 1.1);
    expect(fitted.overflow).toBe(true);
  });

  it('respects a fixed size', () => {
    const fitted = fitText('HI', font, rect, 1.1, 24);
    expect(fitted.size).toBe(24);
  });
});
