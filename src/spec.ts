import { z } from 'zod';

const dimension = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?%$/)]);

export const TextStyleSchema = z
  .object({
    font: z.string().optional(),
    size: z.union([z.number().positive(), z.literal('auto')]).optional(),
    color: z.string().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().min(0).optional(),
    background: z.string().optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    lineHeight: z.number().positive().optional(),
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
      color: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('layout'),
      grid: z.tuple([z.number().int().positive(), z.number().int().positive()]),
      cells: z.array(z.object({ image: z.string() }).strict()),
      width: z.number().int().positive().optional(),
      gutter: z.number().int().min(0).optional(),
      color: z.string().optional(),
    })
    .strict(),
]);

export const OutputSchema = z
  .object({
    format: z.enum(['png', 'jpeg', 'gif', 'webp']).optional(),
    path: z.string().optional(),
    quality: z.number().int().min(1).max(100).optional(),
    maxWidth: z.number().int().positive().optional(),
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

export type MemeErrorCode = 'TEMPLATE_NOT_FOUND' | 'SLOT_NOT_FOUND' | 'INVALID_SPEC' | 'IO_ERROR';

export class MemeError extends Error {
  constructor(
    public readonly code: MemeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MemeError';
  }
}

export function parseMemeSpec(input: unknown): MemeSpec {
  const result = MemeSpecSchema.safeParse(input);
  if (!result.success) {
    throw new MemeError(
      'INVALID_SPEC',
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return result.data;
}
