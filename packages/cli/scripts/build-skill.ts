// Empaqueta la CLI en un solo archivo (`skills/aegon/bin/aegon.mjs`) para la skill de agentes:
// corre con `node` a secas, sin pnpm, sin el monorepo y sin TypeScript. Uso: `pnpm build:skill`.
//
// El bundler es rolldown, que ya llega con vite 8 (dependencia de vitest): no se agrega nada al
// lockfile. El resultado es determinista (sin fechas ni rutas absolutas), así un rebuild sin
// cambios en el código no ensucia el diff.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const entry = join(root, 'packages/cli/src/main.ts');
const outFile = join(root, 'skills/aegon/bin/aegon.mjs');

/** Paquetes de terceros que quedan dentro del bundle y el paquete del monorepo que los declara. */
const THIRD_PARTY: Readonly<Record<string, string>> = { elkjs: 'packages/cli', yaml: 'packages/format-yaml', zod: 'packages/core' };

interface PackageJson {
  name?: string;
  version: string;
  license?: string;
  repository?: string | { url?: string };
}

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as PackageJson;

/** `rolldown` no es dependencia directa de nadie: se llega por vitest → vite → rolldown. */
function resolveRolldown(): string {
  try {
    const vitest = createRequire(join(root, 'package.json')).resolve('vitest/package.json');
    const vite = createRequire(vitest).resolve('vite/package.json');
    return createRequire(vite).resolve('rolldown');
  } catch {
    throw new Error('No encontré rolldown (llega con vite 8, vía vitest). Corré `pnpm install` en la raíz del repo.');
  }
}

/** `package.json` de una dependencia, subiendo desde su punto de entrada hasta la raíz del paquete. */
function packageOf(name: string, from: string): PackageJson {
  let dir = dirname(createRequire(join(root, from, 'package.json')).resolve(name));
  for (;;) {
    try {
      const pkg = readJson(join(dir, 'package.json'));
      if (pkg.name === name) return pkg;
    } catch {
      // Sin package.json en esta carpeta: se sigue subiendo.
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No encontré el package.json de ${name}`);
    dir = parent;
  }
}

/** Una línea por paquete para el encabezado: versión, licencia y dónde está el código fuente. */
function notice(name: string, from: string): string {
  const pkg = packageOf(name, from);
  const repo = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '');
  const url = repo
    .replace(/^github:/, 'https://github.com/')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');
  return `//   ${name} ${pkg.version} · ${pkg.license ?? 'licencia sin declarar'}${url ? ` · ${url}` : ''}`;
}

const cliVersion = readJson(join(root, 'packages/cli/package.json')).version;
const banner = [
  '#!/usr/bin/env node',
  `// aegon ${cliVersion} · CLI de Aegon (arquitectura C4 como código) en un solo archivo. Licencia MIT.`,
  '// GENERADO con `pnpm build:skill` desde packages/cli: no lo edites a mano.',
  '// Incluye código de terceros, cada uno bajo su licencia:',
  ...Object.entries(THIRD_PARTY).map(([name, from]) => notice(name, from)),
].join('\n');

const { rolldown } = (await import(pathToFileURL(resolveRolldown()).href)) as typeof import('rolldown');
// `node20`: baja la sintaxis más nueva para que el archivo no dependa del Node 24 del monorepo.
const bundle = await rolldown({ input: entry, platform: 'node', logLevel: 'warn', transform: { target: 'node20' } });
// Un solo archivo: el `import()` de elkjs (el motor de `aegon layout`) queda adentro.
const { output } = await bundle.generate({ format: 'esm', codeSplitting: false, comments: { annotation: false } });
await bundle.close();
const chunk = output[0];
if (output.length !== 1 || chunk.type !== 'chunk') throw new Error(`Esperaba un solo archivo y salieron ${output.length}`);

// Un único shebang (el de main.ts se descarta), fin de línea LF y sin espacios al final.
const code = chunk.code
  .replace(/^#!.*\n/, '')
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+$/gm, '');
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${banner}\n${code.endsWith('\n') ? code : `${code}\n`}`);

// Humo: el archivo generado tiene que correr solo, fuera del monorepo.
const version = execFileSync(process.execPath, [outFile, '--version'], { cwd: dirname(outFile), encoding: 'utf8' }).trim();
if (version !== cliVersion) throw new Error(`El bundle respondió "${version}" y se esperaba "${cliVersion}"`);
console.log(`✓ ${relative(root, outFile).replaceAll('\\', '/')} (${Math.round(statSync(outFile).size / 1024)} KB, aegon ${version})`);
