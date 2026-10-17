// Genera los JSON Schema del formato Aegon v2 en `docs/schema/` (para agentes de IA y editores).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { jsonSchemas } from '../src/schema/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/schema');
mkdirSync(root, { recursive: true });
for (const [name, schema] of Object.entries(jsonSchemas)) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  const file = join(root, `${name}.schema.json`);
  writeFileSync(file, `${JSON.stringify({ $id: `urn:aegon:schema:v2:${name}`, ...json }, null, 2)}\n`);
  console.log(`✓ ${file}`);
}
