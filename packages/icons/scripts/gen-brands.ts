// Extrae de simple-icons solo las marcas que usan los catálogos de Aegon y las escribe en
// `src/brands.generated.ts` (path SVG + color), para no empaquetar los ~3.500 íconos.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DB_ENGINES, GROUP_PROVIDER_CATALOG, MESSAGE_BROKERS, PROTOCOLS, TECHNOLOGIES } from '@aegon/core';

const require = createRequire(import.meta.url);
const simpleIcons = require('simple-icons') as Record<string, { slug?: string; title: string; hex: string; path: string }>;

const bySlug = new Map(
  Object.values(simpleIcons)
    .filter((icon) => icon && typeof icon === 'object' && icon.slug)
    .map((icon) => [icon.slug!, icon]),
);

// Marcas que usa la UI fuera de los catálogos (orígenes de workspaces).
const wanted = new Set<string>(['github', 'git']);
for (const item of [...DB_ENGINES, ...MESSAGE_BROKERS, ...PROTOCOLS, ...TECHNOLOGIES, ...GROUP_PROVIDER_CATALOG]) {
  if (!item.icon.startsWith('glyph:')) wanted.add(item.icon);
}

const found: string[] = [];
const missing: string[] = [];
const lines = [...wanted].sort().flatMap((slug) => {
  const icon = bySlug.get(slug);
  if (!icon) {
    missing.push(slug);
    return [];
  }
  found.push(slug);
  return [`  ${JSON.stringify(slug)}: { title: ${JSON.stringify(icon.title)}, hex: '${icon.hex}', path: ${JSON.stringify(icon.path)} },`];
});

const out = `// Generado por scripts/gen-brands.ts a partir de simple-icons (CC0). No editar a mano.
export interface BrandIcon {
  title: string;
  hex: string;
  path: string;
}

export const BRANDS: Readonly<Record<string, BrandIcon>> = {
${lines.join('\n')}
};
`;
const target = join(dirname(fileURLToPath(import.meta.url)), '../src/brands.generated.ts');
writeFileSync(target, out);
console.log(`✓ ${found.length} marcas → ${target}`);
if (missing.length) console.log(`  sin marca (usan monograma): ${missing.join(', ')}`);
