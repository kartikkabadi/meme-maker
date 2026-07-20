/**
 * Manifest generator (DESIGN-v2 §6.2): scans assets/templates/{images,gifs},
 * reads each template's `<id>.meta.json` sidecar (name, tags, category, slots,
 * source), derives file path and dimensions from the media file, and emits the
 * merged, schema-validated assets/templates/manifest.json.
 *
 * Usage: npm run build:manifest
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { z } from 'zod';
import { ManifestSchema, TemplateSlotSchema, TemplateSourceSchema } from '../src/spec.js';
import type { Template } from '../src/spec.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES_DIR = join(ROOT, 'assets', 'templates');

const SidecarSchema = z
  .object({
    name: z.string(),
    tags: z.array(z.string()),
    category: z.string().optional(),
    slots: z.array(TemplateSlotSchema),
    source: TemplateSourceSchema.optional(),
  })
  .strict();

const MEDIA_EXT: Record<string, 'image' | 'gif'> = {
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.gif': 'gif',
};

async function collect(subdir: 'images' | 'gifs'): Promise<Template[]> {
  const dir = join(TEMPLATES_DIR, subdir);
  const entries = readdirSync(dir).sort();
  const templates: Template[] = [];
  for (const entry of entries) {
    const ext = entry.slice(entry.lastIndexOf('.')).toLowerCase();
    const type = MEDIA_EXT[ext];
    if (!type) continue;
    const id = entry.slice(0, entry.lastIndexOf('.'));
    const metaPath = join(dir, `${id}.meta.json`);
    let sidecarRaw: string;
    try {
      sidecarRaw = readFileSync(metaPath, 'utf8');
    } catch {
      throw new Error(`missing sidecar ${subdir}/${id}.meta.json for ${subdir}/${entry}`);
    }
    const sidecar = SidecarSchema.parse(JSON.parse(sidecarRaw));
    const meta = await sharp(join(dir, entry)).metadata();
    if (!meta.width || !meta.height) throw new Error(`cannot read dimensions of ${entry}`);
    templates.push({
      id,
      name: sidecar.name,
      type,
      file: `${subdir}/${entry}`,
      width: meta.width,
      height: meta.height,
      tags: sidecar.tags,
      ...(sidecar.category ? { category: sidecar.category } : {}),
      slots: sidecar.slots,
      ...(sidecar.source ? { source: sidecar.source } : {}),
    });
  }
  return templates;
}

async function main(): Promise<void> {
  const templates = [...(await collect('images')), ...(await collect('gifs'))];
  const ids = new Set<string>();
  for (const t of templates) {
    if (ids.has(t.id)) throw new Error(`duplicate template id "${t.id}"`);
    ids.add(t.id);
  }
  const manifest = ManifestSchema.parse({ templates });
  const outPath = join(TEMPLATES_DIR, 'manifest.json');
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const images = templates.filter((t) => t.type === 'image').length;
  console.log(
    `wrote ${outPath}: ${templates.length} templates (${images} images, ${templates.length - images} gifs)`,
  );
}

await main();
