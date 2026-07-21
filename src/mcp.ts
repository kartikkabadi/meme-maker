#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getTemplate, listTemplates } from './catalog.js';
import { limits, Semaphore } from './limits.js';
import { setPathPolicy } from './paths.js';
import { renderMeme } from './render/renderer.js';
import {
  BaseSchema,
  MemeError,
  type MemeErrorCode,
  OutputSchema,
  TextBoxSchema,
  type MemeSpec,
} from './spec.js';

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

const server = new McpServer({ name: 'meme-maker', version: '0.3.0' });

type ToolResult = {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
};

const FIX_HINTS: Partial<Record<MemeErrorCode, string>> = {
  TEMPLATE_NOT_FOUND: 'Call list_templates to see valid template ids.',
  SLOT_NOT_FOUND: 'Call get_template with this template id to see its slot names.',
  INVALID_SPEC: 'Check the field paths in details.issues against the tool input schema.',
  RESOURCE_LIMIT: 'Reduce the value below the limit shown in details.',
  PATH_DENIED:
    'Use a relative output path (written under the output root), or omit output.path to get the image inline.',
  UNSUPPORTED_OUTPUT: 'Animated (gif) bases require output.format "gif"; omit format to use it.',
};

function errorResult(err: unknown): ToolResult {
  const code = err instanceof MemeError ? err.code : 'IO_ERROR';
  const message = err instanceof Error ? err.message : String(err);
  const details = err instanceof MemeError ? err.details : undefined;
  const fix = FIX_HINTS[code];
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: { code, message, details, fix } }) }],
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
      format: result.format,
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
  'List available meme templates. Returns a JSON array of { id, name, type, width, height, tags, slots } where slots is [{ name, hint }]. Use a slot name in render_meme texts[].slot to place text in that region. Call get_template for full slot rects and a ready-to-use example.',
  {
    type: z.enum(['image', 'gif']).optional().describe('Filter by template type.'),
    tag: z.string().optional().describe('Filter to templates carrying this tag (exact match).'),
    search: z
      .string()
      .optional()
      .describe('Case-insensitive substring match on template id, name, and tags.'),
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
  'Get full metadata for one template: slot rects ([x, y, width, height] in pixels), per-slot hints/styles, and an example. The example is a complete, copy-paste-ready render_meme argument object — replace each texts[].text placeholder with your caption and call render_meme.',
  { id: z.string().describe('Template id from list_templates (e.g. "drake").') },
  async ({ id }) => {
    try {
      const t = getTemplate(id);
      const example = {
        base: { kind: 'template', id: t.id },
        texts: t.slots.map((s) => ({
          slot: s.name,
          text: `REPLACE WITH ${(s.hint ?? s.name).toUpperCase()}`,
        })),
        output: {},
      };
      return { content: [{ type: 'text', text: JSON.stringify({ ...t, example }) }] };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  'render_meme',
  'Render a meme from a MemeSpec: template/image/canvas base plus text boxes. For template bases, use slot names from get_template (e.g. texts: [{ "slot": "top", "text": "MY CAPTION" }]); get_template returns a copy-paste-ready example. For non-template bases, the band slots "top", "middle", "bottom" position text automatically. Filesystem image paths are confined to MEME_INPUT_ROOT and disabled unless MEME_ALLOW_FS=1; relative output paths are written under the output root (default ./.memes). Returns JSON metadata { path, mimeType, width, height, bytes, warnings } plus the rendered image inline when small enough (output.maxWidth defaults to 800 so results fit inline).',
  {
    base: BaseSchema.describe(
      'What to draw on: { kind: "template", id } | { kind: "image", path } | { kind: "canvas", width, height, color? } | { kind: "layout", grid, cells, ... }.',
    ),
    texts: z
      .array(TextBoxSchema)
      .default([])
      .describe(
        'Text overlays. Each needs text plus either a slot name (preferred) or explicit x/y/width/height (numbers or "%" strings).',
      ),
    output: OutputSchema.default({}).describe(
      'Output options: format (png|jpeg|gif|webp), path (relative; omit to get the image inline only), quality, maxWidth, overwrite, onDegrade.',
    ),
  },
  async (args) => renderTool(args),
);

server.tool(
  'render_layout',
  'Render a grid layout of images (cover-fit cells) with optional text overlays (band slots "top", "middle", "bottom" are supported). Cell image paths require MEME_ALLOW_FS=1 and are confined to MEME_INPUT_ROOT. Returns the same metadata + inline image as render_meme.',
  {
    grid: z
      .tuple([z.number().int().positive(), z.number().int().positive()])
      .describe('[columns, rows], e.g. [2, 2] for a 2x2 grid.'),
    cells: z
      .array(z.object({ image: z.string() }))
      .describe('Images filling the grid left-to-right, top-to-bottom; each cover-fits its cell.'),
    width: z.number().int().positive().optional().describe('Total layout width in pixels.'),
    gutter: z.number().int().min(0).optional().describe('Spacing between cells in pixels.'),
    color: z.string().optional().describe('Background/gutter color.'),
    texts: z
      .array(TextBoxSchema)
      .default([])
      .describe('Text overlays; use band slots "top", "middle", "bottom" or explicit coordinates.'),
    output: OutputSchema.default({}).describe('Output options; same as render_meme.'),
  },
  async ({ grid, cells, width, gutter, color, texts, output }) =>
    renderTool({ base: { kind: 'layout', grid, cells, width, gutter, color }, texts, output }),
);

server.tool(
  'preview_template',
  'Render a template with no text so the agent can see it before captioning. Returns the blank template as an inline image.',
  { id: z.string().describe('Template id from list_templates.') },
  async ({ id }) => renderTool({ base: { kind: 'template', id }, texts: [], output: {} }),
);

const transport = new StdioServerTransport();
// Malformed JSON on stdin surfaces here via the transport; log and keep serving.
server.server.onerror = (err) => {
  console.error(`[meme-maker-mcp] ${err instanceof Error ? err.message : String(err)}`);
};
await server.connect(transport);
