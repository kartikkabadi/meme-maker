#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getTemplate, listTemplates } from './catalog.js';
import { renderMeme } from './render/renderer.js';
import { BaseSchema, MemeError, OutputSchema, TextBoxSchema } from './spec.js';

const MAX_INLINE_BYTES = 1_000_000;

const server = new McpServer({ name: 'meme-maker', version: '0.1.0' });

type ToolResult = {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
};

function errorResult(err: unknown): ToolResult {
  const code = err instanceof MemeError ? err.code : 'IO_ERROR';
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }],
    isError: true,
  };
}

function mimeType(format: string): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

async function renderTool(spec: unknown): Promise<ToolResult> {
  try {
    const result = await renderMeme(spec);
    const meta = {
      path: result.path,
      mimeType: mimeType(result.format),
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      warnings: result.warnings,
      base64: result.path ? undefined : result.buffer.toString('base64'),
    };
    const content: ToolResult['content'] = [{ type: 'text', text: JSON.stringify(meta) }];
    if (result.bytes <= MAX_INLINE_BYTES) {
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
  'Render a meme from a MemeSpec: template/image/canvas base plus text boxes. Returns the file path (if output.path given) and the image inline when small enough.',
  {
    base: BaseSchema,
    texts: z.array(TextBoxSchema).default([]),
    output: OutputSchema.default({}),
  },
  async (args) => renderTool(args),
);

server.tool(
  'render_layout',
  'Render a grid layout of images (cover-fit cells) with optional text overlays.',
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
