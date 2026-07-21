import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

describe('cli error handling', () => {
  it('prints help (not an error) when run without arguments', () => {
    const r = run([]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('Usage: meme');
    expect(r.stderr).not.toContain('(outputHelp)');
  });

  it('rejects an invalid --type filter', () => {
    const r = run(['templates', 'list', '--type', 'video']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--type must be "image" or "gif"');
  });

  it('rejects non-object spec JSON with INVALID_SPEC', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meme-cli-'));
    for (const [name, body] of [
      ['null.json', 'null'],
      ['arr.json', '[]'],
      ['num.json', '42'],
    ] as const) {
      const file = join(dir, name);
      writeFileSync(file, body);
      const r = run(['spec', 'render', file]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('INVALID_SPEC');
      expect(r.stderr).toContain('must contain a MemeSpec JSON object');
    }
  });

  it('reports a schema error for a spec missing base', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meme-cli-'));
    const file = join(dir, 'empty.json');
    writeFileSync(file, '{}');
    const r = run(['spec', 'render', file]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('base: Required');
  });

  it('rejects a --text-file that is not an array or object', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meme-cli-'));
    const file = join(dir, 'texts.json');
    writeFileSync(file, 'null');
    const r = run(['render', '--template', 'drake', '--text-file', file]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('must contain a JSON array');
  });
});
