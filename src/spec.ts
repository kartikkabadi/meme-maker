import { z } from 'zod';
import { limits } from './limits.js';

const dimension = z.union([z.number().finite().min(0), z.string().regex(/^\d+(\.\d+)?%$/)]);

const NAMED_COLORS = new Set([
  'black',
  'silver',
  'gray',
  'grey',
  'white',
  'maroon',
  'red',
  'purple',
  'fuchsia',
  'green',
  'lime',
  'olive',
  'yellow',
  'navy',
  'blue',
  'teal',
  'aqua',
  'cyan',
  'magenta',
  'orange',
  'pink',
  'brown',
  'gold',
  'transparent',
]);

const COLOR_RE =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|1\.0)\s*)?\)$/;

export const ColorSchema = z
  .string()
  .refine((v) => COLOR_RE.test(v) || NAMED_COLORS.has(v.toLowerCase()), {
    message: 'invalid color: expected #rgb/#rrggbb/#rrggbbaa, rgb()/rgba(), or a named color',
  });

export const TextStyleSchema = z
  .object({
    font: z.string().optional(),
    size: z.union([z.number().finite().positive(), z.literal('auto')]).optional(),
    color: ColorSchema.optional(),
    stroke: ColorSchema.optional(),
    strokeWidth: z.number().finite().min(0).optional(),
    background: ColorSchema.optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    rotation: z.number().finite().optional(),
    opacity: z.number().min(0).max(1).optional(),
    lineHeight: z.number().finite().positive().optional(),
    caps: z.boolean().optional(),
  })
  .strict();

export const TextBoxSchema = z
  .object({
    slot: z.string().optional(),
    text: z.string(),
    x: dimension.optional(),
    y: dimension.optional(),
    width: dimension.optional(),
    height: dimension.optional(),
    anchor: z.enum(['top', 'middle', 'bottom']).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    style: TextStyleSchema.optional(),
    frames: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  })
  .strict();

export const BaseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('template'), id: z.string() }).strict(),
  z.object({ kind: z.literal('image'), path: z.string() }).strict(),
  z
    .object({
      kind: z.literal('canvas'),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      color: ColorSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('layout'),
      grid: z.tuple([z.number().int().positive(), z.number().int().positive()]),
      cells: z.array(z.object({ image: z.string() }).strict()),
      width: z.number().int().positive().optional(),
      gutter: z.number().int().min(0).optional(),
      color: ColorSchema.optional(),
    })
    .strict(),
]);

export const OutputSchema = z
  .object({
    format: z.enum(['png', 'jpeg', 'gif', 'webp']).optional(),
    path: z.string().optional(),
    quality: z.number().int().min(1).max(100).optional(),
    maxWidth: z.number().int().positive().optional(),
    overwrite: z.boolean().optional(),
    onDegrade: z.enum(['warn', 'error']).optional(),
  })
  .strict();

export const MemeSpecSchema = z
  .object({
    base: BaseSchema,
    texts: z.array(TextBoxSchema).default([]),
    output: OutputSchema.default({}),
  })
  .strict();

export type TextStyle = z.infer<typeof TextStyleSchema>;
export type TextBox = z.infer<typeof TextBoxSchema>;
export type MemeBase = z.infer<typeof BaseSchema>;
export type MemeOutput = z.infer<typeof OutputSchema>;
export type MemeSpec = z.infer<typeof MemeSpecSchema>;

export const TemplateSlotSchema = z
  .object({
    name: z.string(),
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    hint: z.string().optional(),
    style: TextStyleSchema.optional(),
    anchor: z.enum(['top', 'middle', 'bottom']).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
  })
  .strict();

export const TemplateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['image', 'gif']),
    file: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    tags: z.array(z.string()),
    slots: z.array(TemplateSlotSchema),
    source: z.string().optional(),
  })
  .strict();

export const ManifestSchema = z.object({ templates: z.array(TemplateSchema) }).strict();

export type TemplateSlot = z.infer<typeof TemplateSlotSchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

export type MemeErrorCode =
  | 'TEMPLATE_NOT_FOUND'
  | 'SLOT_NOT_FOUND'
  | 'INVALID_SPEC'
  | 'INVALID_JSON'
  | 'UNREADABLE_IMAGE'
  | 'UNSUPPORTED_OUTPUT'
  | 'RESOURCE_LIMIT'
  | 'PATH_DENIED'
  | 'RENDER_ERROR'
  | 'WRITE_FAILED'
  | 'IO_ERROR';

export class MemeError extends Error {
  constructor(
    public readonly code: MemeErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MemeError';
  }
}

/** Structured degraded-success warnings (DESIGN-v2 §3.2). */
export type Warning =
  | { code: 'TEXT_OVERFLOW'; box: number; fittedSize: number }
  | { code: 'UNSUPPORTED_GLYPHS'; box: number; codepoints: string[] }
  | { code: 'FRAMES_OUT_OF_RANGE'; box: number; frames: [number, number]; frameCount: number }
  | { code: 'EXTENSION_MISMATCH'; path: string; actual: string }
  | { code: 'EMPTY_TEXT'; box: number };

export function parseMemeSpec(input: unknown): MemeSpec {
  const result = MemeSpecSchema.safeParse(input);
  if (!result.success) {
    throw new MemeError(
      'INVALID_SPEC',
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      { issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    );
  }
  const spec = result.data;
  const perBox = limits.maxTextLen();
  let total = 0;
  for (const [i, box] of spec.texts.entries()) {
    total += box.text.length;
    if (box.text.length > perBox) {
      throw new MemeError('RESOURCE_LIMIT', `texts[${i}].text exceeds ${perBox} characters`, {
        limit: perBox,
        requested: box.text.length,
        kind: 'text_length',
      });
    }
  }
  const totalCap = limits.maxTotalTextLen();
  if (total > totalCap) {
    throw new MemeError('RESOURCE_LIMIT', `total text exceeds ${totalCap} characters`, {
      limit: totalCap,
      requested: total,
      kind: 'total_text_length',
    });
  }
  return spec;
}
