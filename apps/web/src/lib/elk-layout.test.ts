import { describe, expect, it } from 'vitest';
import { applyOp, demoModel, sizeOf, type Model } from '@aegon/core';
import { elkArrangeOp } from './elk-layout.ts';

function rectsOf(model: Model, viewId: string) {
  const view = model.views[viewId]!;
  return Object.fromEntries(
    Object.entries(view.nodes).map(([id, l]) => [id, { ...l, ...sizeOf(model.elements[id]!, l), kind: model.elements[id]!.kind }]),
  );
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('auto-layout con ELK', () => {
  it('ordena un lienzo L2 sin superposiciones, con el actor arriba y anclado donde estaba', async () => {
    const model = demoModel();
    const before = rectsOf(model, 'home-banking-containers');
    const op = await elkArrangeOp(model, 'home-banking-containers');
    expect(op?.type).toBe('view.place');
    const next = applyOp(model, op!).model;
    const after = rectsOf(next, 'home-banking-containers');
    const leaves = Object.entries(after).filter(([, r]) => r.kind !== 'group');
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) expect(overlaps(leaves[i]![1], leaves[j]![1]), `${leaves[i]![0]} / ${leaves[j]![0]}`).toBe(false);
    }
    const minY = Math.min(...leaves.map(([, r]) => r.y));
    expect(after.cliente!.y).toBe(minY);
    expect(Math.min(...leaves.map(([, r]) => r.x))).toBe(Math.min(...Object.values(before).filter((r) => r.kind !== 'group').map((r) => r.x)));
  });

  it('los grupos envuelven a sus miembros después de ordenar', async () => {
    const model = demoModel();
    const op = await elkArrangeOp(model, 'landscape');
    const next = applyOp(model, op!).model;
    const after = rectsOf(next, 'landscape');
    const groups = Object.entries(after).filter(([, r]) => r.kind === 'group');
    expect(groups.length).toBeGreaterThan(0);
    for (const [gid, g] of groups) {
      const members = Object.keys(after).filter((id) => next.elements[id]!.groups?.includes(gid));
      for (const m of members) {
        const r = after[m]!;
        expect(r.x >= g.x && r.y >= g.y && r.x + r.w <= g.x + g.w && r.y + r.h <= g.y + g.h, `${m} dentro de ${gid}`).toBe(true);
      }
    }
  });

  it('con una selección solo mueve esos elementos', async () => {
    const model = demoModel();
    const view = model.views['home-banking-containers']!;
    const ids = ['web-app', 'app-movil', 'api-gateway'];
    const op = await elkArrangeOp(model, view.id, ids);
    expect(op?.type).toBe('view.place');
    const moved = Object.keys((op as { nodes: Record<string, unknown> }).nodes);
    expect(moved.every((id) => ids.includes(id))).toBe(true);
  });
});
