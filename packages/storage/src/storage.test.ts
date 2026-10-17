import { describe, expect, it } from 'vitest';
import { MemoryStorage, applyWritePlan, readAll } from './index.ts';

describe('MemoryStorage', () => {
  it('lee todo ordenado y aplica un plan de escritura', async () => {
    const storage = new MemoryStorage([
      ['views/b.yaml', 'b'],
      ['aegon.yaml', 'a'],
      ['README.md', 'r'],
    ]);
    expect([...(await readAll(storage)).keys()]).toEqual(['README.md', 'aegon.yaml', 'views/b.yaml']);
    await applyWritePlan(storage, { writes: new Map([['views/c.yaml', 'c']]), deletes: ['views/b.yaml'] });
    expect(await storage.list()).toEqual(['README.md', 'aegon.yaml', 'views/c.yaml']);
  });
});
