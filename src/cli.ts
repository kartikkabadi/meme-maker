#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command, CommanderError } from 'commander';
import { getTemplate, listTemplates } from './catalog.js';
import { parseTextArgs } from './cli-args.js';
import { BUILTIN_FONTS } from './render/font.js';
import { defaultOutputName, renderMeme } from './render/renderer.js';
import { MemeError, type MemeSpec, type TextBox } from './spec.js';

// Exit cleanly when a downstream consumer closes stdout (e.g. `meme ... | head`).
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const jsonMode = process.argv.includes('--json');

const program = new Command();
program.name('meme').description('Meme maker for agents').version('0.1.0');
program.option('--templates-dir <dir>', 'load templates from a custom directory');
program.exitOverride();
program.configureOutput({ writeErr: () => {} });
program.hook('preAction', () => {
  const dir = program.opts<{ templatesDir?: string }>().templatesDir;
  if (dir) process.env.MEME_TEMPLATES_DIR = dir;
});

function output(data: unknown, json: boolean, human: () => void): void {
  if (json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else human();
}

function fail(err: unknown, json: boolean): never {
  const code = err instanceof MemeError ? err.code : 'IO_ERROR';
  const message = err instanceof Error ? err.message : String(err);
  const details = err instanceof MemeError ? err.details : undefined;
  if (json) process.stdout.write(JSON.stringify({ error: { code, message, details } }) + '\n');
  else process.stderr.write(`error [${code}]: ${message}\n`);
  process.exit(1);
}

interface RenderOpts {
  template?: string;
  image?: string;
  canvas?: string;
  bg?: string;
  text: string[];
  textFile?: string;
  out?: string;
  format?: 'png' | 'jpeg' | 'gif' | 'webp';
  quality?: string;
  maxWidth?: string;
  force?: boolean;
  strict?: boolean;
  json?: boolean;
}

function readJsonFile(path: string): unknown {
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new MemeError('INVALID_JSON', `"${path}" is not valid JSON: ${(err as Error).message}`, {
      file: path,
    });
  }
}

async function runRender(opts: RenderOpts, base: MemeSpec['base']): Promise<void> {
  const slotNames = base.kind === 'template' ? getTemplate(base.id).slots.map((s) => s.name) : [];
  let texts: TextBox[] = parseTextArgs(opts.text, slotNames);
  if (opts.textFile) {
    const parsed = readJsonFile(opts.textFile) as { texts?: TextBox[] } | TextBox[];
    texts = texts.concat(Array.isArray(parsed) ? parsed : (parsed.texts ?? []));
  }
  const spec: MemeSpec = {
    base,
    texts,
    output: {
      format: opts.format,
      quality: opts.quality ? parseInt(opts.quality, 10) : undefined,
      maxWidth: opts.maxWidth ? parseInt(opts.maxWidth, 10) : undefined,
      overwrite: opts.force,
      onDegrade: opts.strict ? 'error' : undefined,
    },
  };
  spec.output.path =
    opts.out ??
    defaultOutputName(
      spec,
      spec.output.format ??
        (base.kind === 'template' && getTemplateType(base) === 'gif' ? 'gif' : 'png'),
    );
  const result = await renderMeme(spec);
  output(
    {
      path: result.path,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
      warnings: result.warnings,
    },
    opts.json ?? false,
    () => {
      process.stdout.write(
        `wrote ${result.path} (${result.width}x${result.height} ${result.format}, ${result.bytes} bytes)\n`,
      );
      for (const w of result.warnings) process.stderr.write(`warning: ${JSON.stringify(w)}\n`);
    },
  );
}

function getTemplateType(base: MemeSpec['base']): string {
  if (base.kind !== 'template') return 'image';
  try {
    return getTemplate(base.id).type;
  } catch {
    return 'image';
  }
}

function baseFromOpts(opts: RenderOpts): MemeSpec['base'] {
  const given = [opts.template, opts.image, opts.canvas].filter((v) => v !== undefined);
  if (given.length !== 1) {
    throw new MemeError('INVALID_SPEC', 'exactly one of --template, --image, --canvas is required');
  }
  if (opts.template) return { kind: 'template', id: opts.template };
  if (opts.image) return { kind: 'image', path: opts.image };
  const m = /^(\d+)x(\d+)$/.exec(opts.canvas!);
  if (!m) throw new MemeError('INVALID_SPEC', `--canvas must be WxH, got "${opts.canvas}"`);
  return {
    kind: 'canvas',
    width: parseInt(m[1]!, 10),
    height: parseInt(m[2]!, 10),
    color: opts.bg,
  };
}

const templates = program.command('templates').description('browse the template catalog');

templates
  .command('list')
  .option('--tag <tag>', 'filter by tag')
  .option('--type <type>', 'filter by type (image|gif)')
  .option('--search <q>', 'search id/name/tags')
  .option('--json', 'JSON output')
  .action((opts: { tag?: string; type?: 'image' | 'gif'; search?: string; json?: boolean }) => {
    try {
      const list = listTemplates({ tag: opts.tag, type: opts.type, search: opts.search }).map(
        (t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          width: t.width,
          height: t.height,
          panels: t.slots.length,
          tags: t.tags,
          slots: t.slots.map((s) => ({ name: s.name, hint: s.hint })),
        }),
      );
      output(list, opts.json ?? false, () => {
        for (const t of list) {
          process.stdout.write(
            `${t.id.padEnd(24)} ${t.type.padEnd(6)} ${String(t.width) + 'x' + String(t.height)}  slots: ${t.slots.map((s) => s.name).join(', ')}\n`,
          );
        }
      });
    } catch (err) {
      fail(err, opts.json ?? false);
    }
  });

templates
  .command('show <id>')
  .option('--json', 'JSON output')
  .option('--preview <path>', 'write the blank template image to a file')
  .action(async (id: string, opts: { json?: boolean; preview?: string }) => {
    try {
      const t = getTemplate(id);
      if (opts.preview) {
        await renderMeme({
          base: { kind: 'template', id },
          texts: [],
          output: { path: opts.preview, format: t.type === 'gif' ? 'gif' : 'png' },
        });
      }
      output(t, opts.json ?? false, () => {
        process.stdout.write(
          `${t.name} (${t.id}) — ${t.type} ${t.width}x${t.height}\ntags: ${t.tags.join(', ')}\nslots:\n`,
        );
        for (const s of t.slots) {
          process.stdout.write(
            `  ${s.name.padEnd(14)} rect=[${s.rect.join(', ')}]  ${s.hint ?? ''}\n`,
          );
        }
        if (t.source) process.stdout.write(`source: ${t.source.url} (${t.source.license})\n`);
      });
    } catch (err) {
      fail(err, opts.json ?? false);
    }
  });

program
  .command('render')
  .description('render a meme from a template, image, or blank canvas')
  .option('--template <id>', 'template id')
  .option('--image <path>', 'custom base image')
  .option('--canvas <WxH>', 'blank canvas, e.g. 800x600')
  .option('--bg <color>', 'canvas background color')
  .option(
    '--text <slotOrIndex=content>',
    'text (repeatable)',
    (v: string, acc: string[]) => acc.concat(v),
    [],
  )
  .option('--text-file <path>', 'JSON file with a MemeSpec texts array')
  .option('-o, --out <path>', 'output path')
  .option('--format <fmt>', 'png|jpeg|gif|webp')
  .option('--quality <n>', 'jpeg/webp quality')
  .option('--max-width <px>', 'downscale output to max width')
  .option('--force', 'overwrite an existing output file')
  .option('--strict', 'treat degraded-render warnings as errors')
  .option('--json', 'JSON output')
  .action(async (opts: RenderOpts) => {
    try {
      await runRender(opts, baseFromOpts(opts));
    } catch (err) {
      fail(err, opts.json ?? false);
    }
  });

program
  .command('layout')
  .description('render a grid layout of images')
  .requiredOption('--grid <CxR>', 'grid size, e.g. 2x2')
  .option(
    '--cell <img>',
    'cell image path (repeatable)',
    (v: string, acc: string[]) => acc.concat(v),
    [],
  )
  .option('--gutter <px>', 'gutter size')
  .option('--bg <color>', 'background color')
  .option('--width <px>', 'total width')
  .option(
    '--text <slotOrIndex=content>',
    'text (repeatable)',
    (v: string, acc: string[]) => acc.concat(v),
    [],
  )
  .option('--text-file <path>', 'JSON file with texts array')
  .option('-o, --out <path>', 'output path')
  .option('--format <fmt>', 'png|jpeg|webp')
  .option('--quality <n>', 'jpeg/webp quality')
  .option('--max-width <px>', 'downscale output to max width')
  .option('--force', 'overwrite an existing output file')
  .option('--strict', 'treat degraded-render warnings as errors')
  .option('--json', 'JSON output')
  .action(
    async (
      opts: RenderOpts & { grid: string; cell: string[]; gutter?: string; width?: string },
    ) => {
      try {
        const m = /^(\d+)x(\d+)$/.exec(opts.grid);
        if (!m) throw new MemeError('INVALID_SPEC', `--grid must be CxR, got "${opts.grid}"`);
        await runRender(opts, {
          kind: 'layout',
          grid: [parseInt(m[1]!, 10), parseInt(m[2]!, 10)],
          cells: opts.cell.map((image) => ({ image })),
          gutter: opts.gutter ? parseInt(opts.gutter, 10) : undefined,
          width: opts.width ? parseInt(opts.width, 10) : undefined,
          color: opts.bg,
        });
      } catch (err) {
        fail(err, opts.json ?? false);
      }
    },
  );

const spec = program.command('spec').description('render from a full MemeSpec JSON');

spec
  .command('render <file>')
  .option('-o, --out <path>', 'override output path')
  .option('--force', 'overwrite an existing output file')
  .option('--strict', 'treat degraded-render warnings as errors')
  .option('--json', 'JSON output')
  .action(
    async (
      file: string,
      opts: { out?: string; force?: boolean; strict?: boolean; json?: boolean },
    ) => {
      try {
        const raw = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
        let parsed: { output?: Record<string, unknown>; base?: { kind?: string } };
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          throw new MemeError(
            'INVALID_JSON',
            `"${file}" is not valid JSON: ${(err as Error).message}`,
            { file },
          );
        }
        parsed.output = { ...(parsed.output ?? {}) };
        if (opts.out) parsed.output.path = opts.out;
        if (opts.force) parsed.output.overwrite = true;
        if (opts.strict) parsed.output.onDegrade = 'error';
        if (!parsed.output.path) {
          parsed.output.path = defaultOutputName(
            parsed as MemeSpec,
            (parsed.output.format as string | undefined) ??
              (parsed.base?.kind === 'template' &&
              getTemplateType(parsed.base as MemeSpec['base']) === 'gif'
                ? 'gif'
                : 'png'),
          );
        }
        const result = await renderMeme(parsed);
        output(
          {
            path: result.path,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
            warnings: result.warnings,
          },
          opts.json ?? false,
          () =>
            process.stdout.write(
              `wrote ${result.path ?? '(buffer)'} (${result.width}x${result.height} ${result.format})\n`,
            ),
        );
      } catch (err) {
        fail(err, opts.json ?? false);
      }
    },
  );

program
  .command('ui')
  .description('start the local web UI (gallery, editor, history)')
  .option('--port <n>', 'port to listen on (auto-picks a free port on conflict)')
  .action(async (opts: { port?: string }) => {
    try {
      const { startServer } = await import('./http.js');
      const { url } = await startServer({
        port: opts.port ? parseInt(opts.port, 10) : undefined,
      });
      // Machine-readable first line so agents/hosts can discover the port.
      process.stdout.write(JSON.stringify({ url }) + '\n');
      process.stderr.write(`meme ui listening at ${url} (Ctrl+C to stop)\n`);
    } catch (err) {
      fail(err, jsonMode);
    }
  });

program
  .command('fonts')
  .description('font utilities')
  .command('list')
  .option('--json', 'JSON output')
  .action((opts: { json?: boolean }) => {
    const fonts = Object.keys(BUILTIN_FONTS);
    output(fonts, opts.json ?? false, () => {
      for (const f of fonts) process.stdout.write(`${f}\n`);
    });
  });

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof CommanderError) {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
      process.exit(0);
    }
    fail(new MemeError('INVALID_SPEC', err.message.replace(/^error: /, '')), jsonMode);
  }
  fail(err, jsonMode);
});
