import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManifestSchema, MemeError, type Template } from './spec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ASSETS_DIR = join(__dirname, '..', 'assets');
export const TEMPLATES_DIR = join(ASSETS_DIR, 'templates');
export const FONTS_DIR = join(ASSETS_DIR, 'fonts');

let cachedTemplates: Template[] | null = null;
let cachedDir: string | null = null;

export function loadManifest(templatesDir: string = TEMPLATES_DIR): Template[] {
  if (cachedTemplates && cachedDir === templatesDir) return cachedTemplates;
  let raw: string;
  try {
    raw = readFileSync(join(templatesDir, 'manifest.json'), 'utf8');
  } catch (err) {
    throw new MemeError('IO_ERROR', `cannot read manifest: ${(err as Error).message}`);
  }
  const parsed = ManifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new MemeError('INVALID_SPEC', `invalid manifest: ${parsed.error.message}`);
  }
  cachedTemplates = parsed.data.templates;
  cachedDir = templatesDir;
  return cachedTemplates;
}

export interface TemplateFilter {
  type?: 'image' | 'gif';
  tag?: string;
  search?: string;
}

export function listTemplates(filter: TemplateFilter = {}, templatesDir?: string): Template[] {
  let templates = loadManifest(templatesDir);
  if (filter.type) templates = templates.filter((t) => t.type === filter.type);
  if (filter.tag) templates = templates.filter((t) => t.tags.includes(filter.tag!));
  if (filter.search) {
    const q = filter.search.toLowerCase();
    templates = templates.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }
  return templates;
}

export function getTemplate(id: string, templatesDir?: string): Template {
  const template = loadManifest(templatesDir).find((t) => t.id === id);
  if (!template) {
    const ids = loadManifest(templatesDir)
      .map((t) => t.id)
      .join(', ');
    throw new MemeError('TEMPLATE_NOT_FOUND', `unknown template "${id}"; available: ${ids}`);
  }
  return template;
}

export function templateImagePath(
  template: Template,
  templatesDir: string = TEMPLATES_DIR,
): string {
  return join(templatesDir, template.file);
}
