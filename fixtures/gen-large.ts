// Genera un workspace grande en `fixtures/large/` (ignorado por git) para probar escala:
//   pnpm gen:large            → abrirlo en la app con "Abrir carpeta…"
// También mide cuánto tarda serializar y parsear el formato YAML.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateModel } from '@aegon/core';
import { parseWorkspace, serializeWorkspace } from '@aegon/format-yaml';
import { largeModel } from '../apps/web/src/lib/large.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), 'large');
const model = largeModel();
const counts = { elements: Object.keys(model.elements).length, relations: Object.keys(model.relations).length, views: Object.keys(model.views).length };

let t = performance.now();
const files = serializeWorkspace(model);
const serializeMs = performance.now() - t;
t = performance.now();
const { diagnostics } = parseWorkspace(files);
const parseMs = performance.now() - t;
const errors = [...diagnostics, ...validateModel(model)].filter((d) => d.severity === 'error');

rmSync(root, { recursive: true, force: true });
for (const [path, content] of files) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
console.log(`✓ ${files.size} archivos en ${root}`);
console.log(`  ${counts.elements} elementos · ${counts.relations} relaciones · ${counts.views} lienzos`);
console.log(`  serializar ${serializeMs.toFixed(0)} ms · parsear+validar ${parseMs.toFixed(0)} ms · errores: ${errors.length}`);
