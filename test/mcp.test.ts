import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SERVER = join(__dirname, '..', 'dist', 'mcp.js');
const built = existsSync(SERVER);

let client: Client;

describe.skipIf(!built)('MCP server (stdio integration)', () => {
  beforeAll(async () => {
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));
  });

  afterAll(async () => {
    await client.close();
  });

  it('lists the 5 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_template',
      'list_templates',
      'preview_template',
      'render_layout',
      'render_meme',
    ]);
  });

  it('list_templates returns the catalog', async () => {
    const result = await client.callTool({ name: 'list_templates', arguments: {} });
    const content = result.content as { type: string; text?: string }[];
    const list = JSON.parse(content[0]!.text!);
    expect(list.map((t: { id: string }) => t.id)).toContain('drake');
  });

  it('render_meme renders drake and returns an inline image', async () => {
    const result = await client.callTool({
      name: 'render_meme',
      arguments: {
        base: { kind: 'template', id: 'drake' },
        texts: [
          { slot: 'no', text: 'MANUAL EDITORS' },
          { slot: 'yes', text: 'AGENT CLIS' },
        ],
        output: { format: 'jpeg', maxWidth: 400 },
      },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text?: string; mimeType?: string }[];
    const meta = JSON.parse(content.find((c) => c.type === 'text')!.text!);
    expect(meta.width).toBe(400);
    const image = content.find((c) => c.type === 'image');
    expect(image?.mimeType).toBe('image/jpeg');
  });

  it('render_meme returns a typed error for a bad template', async () => {
    const result = await client.callTool({
      name: 'render_meme',
      arguments: { base: { kind: 'template', id: 'bogus' }, texts: [], output: {} },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text?: string }[];
    expect(JSON.parse(content[0]!.text!).error.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('applies a default maxWidth so results fit inline, and gates meta.base64', async () => {
    const result = await client.callTool({
      name: 'render_meme',
      arguments: {
        base: { kind: 'template', id: 'drake' },
        texts: [{ slot: 'yes', text: 'INLINE' }],
        output: {},
      },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text?: string }[];
    const meta = JSON.parse(content.find((c) => c.type === 'text')!.text!);
    expect(meta.width).toBeLessThanOrEqual(800);
    expect(meta.bytes).toBeLessThanOrEqual(1_000_000);
    if (meta.base64) expect(meta.bytes).toBeLessThanOrEqual(1_000_000);
    expect(content.some((c) => c.type === 'image')).toBe(true);
  });

  it('denies absolute output paths with PATH_DENIED (confined surface)', async () => {
    const result = await client.callTool({
      name: 'render_meme',
      arguments: {
        base: { kind: 'template', id: 'drake' },
        texts: [],
        output: { path: '/tmp/clobber.png' },
      },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text?: string }[];
    expect(JSON.parse(content[0]!.text!).error.code).toBe('PATH_DENIED');
  });

  it('denies filesystem image reads by default with PATH_DENIED', async () => {
    const result = await client.callTool({
      name: 'render_meme',
      arguments: { base: { kind: 'image', path: 'photo.png' }, texts: [], output: {} },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text?: string }[];
    expect(JSON.parse(content[0]!.text!).error.code).toBe('PATH_DENIED');
  });

  it('preview_template returns the blank template image', async () => {
    const result = await client.callTool({
      name: 'preview_template',
      arguments: { id: 'this-is-fine' },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string }[];
    expect(content.some((c) => c.type === 'image')).toBe(true);
  });
});
