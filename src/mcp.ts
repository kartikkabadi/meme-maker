#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getTemplate, listTemplates } from './catalog.js';
import { limits, Semaphore } from './limits.js';
import { setPathPolicy } from './paths.js';
import { renderMeme } from './render/renderer.js';
import { BaseSchema, MemeError, OutputSchema, TextBoxSchema, type MemeSpec } from './spec.js';

// MCP is an untrusted surface: confine all file reads/writes (DESIGN-v2 §3.5).
setPathPolicy('confined');

const MAX_INLINE_BYTES = (() => {
  const n = parseInt(process.env.MEME_MAX_INLINE_BYTES ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 1_000_000;
})();

// Default downscale so flagship templates fit the inline cap.
const DEFAULT_MAX_WIDTH = (() => {
  const n = parseInt(process.env.MEME_MCP_DEFAULT_MAX_WIDTH ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 800;
})();

const semaphore = new Semaphore(limits.maxConcurrency());

const server = new McpServer({ name: 'meme-maker', version: '0.2.0' });

type ToolResult = {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
};

function errorResult(err: unknown): ToolResult {
  const code = err instanceof MemeError ? err.code : 'IO_ERROR';
  const message = err instanceof Error ? err.message : String(err);
  const details = err instanceof MemeError ? err.details : undefined;
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: { code, message, details } }) }],
    isError: true,
  };
}

function mimeType(format: string): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

async function renderTool(spec: {
  base: MemeSpec['base'];
  texts: MemeSpec['texts'];
  output: MemeSpec['output'];
}): Promise<ToolResult> {
  try {
    const output = { ...spec.output };
    if (output.maxWidth === undefined) output.maxWidth = DEFAULT_MAX_WIDTH;
    const result = await semaphore.run(() => renderMeme({ ...spec, output }));
    const inline = result.bytes <= MAX_INLINE_BYTES;
    const meta = {
      path: result.path,
      mimeType: mimeType(result.format),
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      warnings: result.warnings,
      // meta.base64 is gated by the same inline cap as the image block (D1).
      base64: result.path || !inline ? undefined : result.buffer.toString('base64'),
    };
    const content: ToolResult['content'] = [{ type: 'text', text: JSON.stringify(meta) }];
    if (inline) {
      content.push({
        type: 'image',
        data: result.buffer.toString('base64'),
        mimeType: mimeType(result.format),
      });
    }
    return { content };
  } catch (err) {
    return errorResult(err);
  }
}

server.tool(
  'list_templates',
  'List available meme templates, optionally filtered by type, tag, or search query.',
  {
    type: z.enum(['image', 'gif']).optional(),
    tag: z.string().optional(),
    search: z.string().optional(),
  },
  async (args) => {
    try {
      const list = listTemplates(args).map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        width: t.width,
        height: t.height,
        tags: t.tags,
        slots: t.slots.map((s) => ({ name: s.name, hint: s.hint })),
      }));
      return { content: [{ type: 'text', text: JSON.stringify(list) }] };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  'get_template',
  'Get full metadata for a template: slot rects, hints, and example usage.',
  { id: z.string() },
  async ({ id }) => {
    try {
      const t = getTemplate(id);
      const example = {
        base: { kind: 'template', id: t.id },
        texts: t.slots.map((s) => ({ slot: s.name, text: `<${s.hint ?? s.name}>` })),
        output: { path: `${t.id}.${t.type === 'gif' ? 'gif' : 'png'}` },
      };
      return { content: [{ type: 'text', text: JSON.stringify({ ...t, example }) }] };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  'render_meme',
  'Render a meme from a MemeSpec: template/image/canvas base plus text boxes. For template bases, use slot names from get_template. For non-template bases, the band slots "top", "middle", "bottom" position text automatically. Filesystem image paths are confined to MEME_INPUT_ROOT and disabled unless MEME_ALLOW_FS=1; outputs are confined under the output root (default ./.memes). Returns the file path (if output.path given) and the image inline when small enough (output.maxWidth defaults to 800 so results fit inline).',
  {
    base: BaseSchema,
    texts: z.array(TextBoxSchema).default([]),
    output: OutputSchema.default({}),
  },
  async (args) => renderTool(args),
);

server.tool(
  'render_layout',
  'Render a grid layout of images (cover-fit cells) with optional text overlays (band slots "top", "middle", "bottom" are supported). Cell image paths require MEME_ALLOW_FS=1 and are confined to MEME_INPUT_ROOT.',
  {
    grid: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    cells: z.array(z.object({ image: z.string() })),
    width: z.number().int().positive().optional(),
    gutter: z.number().int().min(0).optional(),
    color: z.string().optional(),
    texts: z.array(TextBoxSchema).default([]),
    output: OutputSchema.default({}),
  },
  async ({ grid, cells, width, gutter, color, texts, output }) =>
    renderTool({ base: { kind: 'layout', grid, cells, width, gutter, color }, texts, output }),
);

server.tool(
  'preview_template',
  'Render a template with no text so the agent can see it before captioning.',
  { id: z.string() },
  async ({ id }) => renderTool({ base: { kind: 'template', id }, texts: [], output: {} }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
