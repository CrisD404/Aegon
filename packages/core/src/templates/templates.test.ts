import { describe, expect, it } from 'vitest';
import type { Model } from '../model/index.ts';
import { applyOp } from '../ops/index.ts';
import { createViewOp, sizeOf } from '../ops/commands.ts';
import { fitFramesOp, visualParentOf } from '../layout/index.ts';
import { validateModel } from '../rules/index.ts';
import { sampleModel } from '../test-fixtures.ts';
import { demoModel } from '../demo.ts';
import {
  BLOCK_VIEW,
  blockProblem,
  builtinTemplates,
  instantiateBlockOp,
  templateFromSelection,
  templateFromWorkspace,
  templateStats,
  workspaceFromTemplate,
} from './index.ts';

const errors = (m: Parameters<typeof validateModel>[0]) => validateModel(m).filter((d) => d.severity === 'error');

const C4_BLOCKS = ['builtin:api-gateway', 'builtin:event-driven', 'builtin:web-api-db'];
const DEPLOYMENT_BLOCKS = ['builtin:red-subredes', 'builtin:cluster-namespaces', 'builtin:datacenter-firewall', 'builtin:borde-web'];
const builtin = (id: string) => builtinTemplates().find((t) => t.id === id)!;

describe('templates incluidos', () => {
  it('son válidos y los bloques de C4 se insertan en L2', () => {
    const builtins = builtinTemplates();
    expect(builtins.map((t) => [t.id, t.kind])).toEqual([
      ['builtin:banca-digital', 'workspace'],
      ...C4_BLOCKS.map((id) => [id, 'block']),
      ...DEPLOYMENT_BLOCKS.map((id) => [id, 'block']),
    ]);
    const model = demoModel();
    for (const t of C4_BLOCKS.map(builtin)) {
      expect(templateStats(t).level).toBe(2);
      const { op, ids } = instantiateBlockOp(model, t, 'home-banking-containers', { x: 2000, y: 0 });
      const next = applyOp(model, op).model;
      expect(errors(next)).toEqual([]);
      for (const id of ids) expect(next.elements[id]!.parent).toBe('home-banking');
    }
  });
});

describe('instantiateBlockOp', () => {
  const gateway = builtinTemplates().find((t) => t.id === 'builtin:api-gateway')!;

  it('genera IDs nuevos sin pisar los existentes y centra el bloque en un lugar libre', () => {
    const model = demoModel();
    const at = { x: 4000, y: 4000 };
    const { op, ids } = instantiateBlockOp(model, gateway, 'home-banking-containers', at);
    const next = applyOp(model, op).model;
    // "API Gateway" ya existe en el demo → api-gateway-2.
    expect(ids).toContain('api-gateway-2');
    expect(next.elements['api-gateway']!.name).toBe('API Gateway');
    expect(next.relations['api-gateway-2--servicio-a']).toBeDefined();
    const placed = ids.map((id) => next.views['home-banking-containers']!.nodes[id]!);
    const xs = placed.map((p) => p.x);
    expect(Math.min(...xs) + Math.max(...xs) + 220).toBeCloseTo(2 * at.x, -1);
    // Insertarlo dos veces no choca.
    const again = applyOp(next, instantiateBlockOp(next, gateway, 'home-banking-containers', { x: 900, y: 0 }).op).model;
    expect(again.elements['api-gateway-3']).toBeDefined();
  });

  it('no pisa los nodos que ya están en el lienzo', () => {
    const model = demoModel();
    const view = model.views['home-banking-containers']!;
    const target = view.nodes['pagos-api']!;
    const { op, ids } = instantiateBlockOp(model, gateway, view.id, { x: target.x, y: target.y });
    const next = applyOp(model, op).model;
    const nodes = next.views[view.id]!.nodes;
    const box = (id: string) => ({ ...nodes[id]!, ...sizeOf(next.elements[id]!, nodes[id]) });
    const inserted = ids.map(box);
    const existing = Object.keys(view.nodes).map(box);
    for (const a of inserted) {
      for (const b of existing) {
        const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlaps, `${JSON.stringify(a)} pisa ${JSON.stringify(b)}`).toBe(false);
      }
    }
  });

  it('no se inserta un bloque de contenedores en un lienzo L1', () => {
    const model = demoModel();
    expect(blockProblem(gateway, model.views.landscape!)).toMatch(/contenedores \(L2\)/);
    expect(() => instantiateBlockOp(model, gateway, 'landscape', { x: 0, y: 0 })).toThrow(/contenedores/);
  });
});

describe('bloques de despliegue', () => {
  const PROD = 'home-banking-despliegue-prod';
  type Box = { x: number; y: number; w: number; h: number };
  /** Errores y avisos de la validación: lo que insertar un bloque no debe sumar. */
  const problems = (m: Model) => validateModel(m).filter((d) => d.severity !== 'info').map((d) => `${d.code} ${d.entity?.id}`);
  const boxOf = (m: Model, viewId: string, id: string): Box => {
    const layout = m.views[viewId]!.nodes[id]!;
    return { x: layout.x, y: layout.y, ...sizeOf(m.elements[id]!, layout) };
  };
  const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inside = (inner: Box, outer: Box) =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

  /** Cada nodo ubicado está dentro del marco que lo contiene y los hermanos no se pisan. */
  function expectTidy(m: Model, viewId: string) {
    const view = m.views[viewId]!;
    const ids = Object.keys(view.nodes);
    const parent = new Map(ids.map((id) => [id, visualParentOf(m, view, m.elements[id]!)]));
    for (const id of ids) {
      const p = parent.get(id);
      if (p) expect(inside(boxOf(m, viewId, id), boxOf(m, viewId, p)), `${id} se sale de ${p}`).toBe(true);
      for (const other of ids) {
        if (other <= id || parent.get(other) !== p) continue;
        expect(overlap(boxOf(m, viewId, id), boxOf(m, viewId, other)), `${id} pisa ${other}`).toBe(false);
      }
    }
  }

  /** El demo con un lienzo de despliegue de QA vacío. */
  function qaCanvas(): { model: Model; view: string } {
    const model = demoModel();
    const { op, id } = createViewOp(model, 'Despliegue QA', 'deployment', undefined, 'qa');
    return { model: applyOp(model, op).model, view: id };
  }

  it('cada bloque incluido queda en el ambiente del lienzo, anidado, con su layout y sin avisos', () => {
    for (const template of DEPLOYMENT_BLOCKS.map(builtin)) {
      const { model, view } = qaCanvas();
      const src = template.model;
      const layout = src.views[BLOCK_VIEW]!.nodes;
      expect(templateStats(template).level).toBe('deployment');
      // Genéricos: solo nodos e infraestructura, sin proveedor, direcciones ni ambiente.
      for (const el of Object.values(src.elements)) {
        expect(['node', 'infra']).toContain(el.kind);
        expect(el).not.toHaveProperty('node.provider');
        expect(el).not.toHaveProperty('addresses');
        expect(el).not.toHaveProperty('environments');
      }

      const at = { x: 500, y: 300 };
      const { op, ids } = instantiateBlockOp(model, template, view, at);
      const next = applyOp(model, op).model;
      // Ni errores ni avisos nuevos, y nada (tampoco informativo) sobre lo insertado.
      expect(problems(next), template.name).toEqual(problems(model));
      const added = new Set([...ids, ...Object.keys(next.relations).filter((id) => !model.relations[id])]);
      expect(validateModel(next).filter((d) => d.entity && added.has(d.entity.id))).toEqual([]);

      // Un elemento nuevo por cada uno del bloque, todos en el ambiente del lienzo.
      expect(ids).toHaveLength(Object.keys(src.elements).length);
      const created = new Map(Object.values(src.elements).map((el) => [el.id, ids.find((id) => next.elements[id]!.name === el.name)!]));
      for (const id of ids) expect(next.elements[id]!.environments).toEqual(['qa']);
      // La jerarquía del bloque se conserva; lo de primer nivel queda suelto en el lienzo.
      for (const el of Object.values(src.elements)) {
        expect(next.elements[created.get(el.id)!]!.parent).toBe(el.parent ? created.get(el.parent) : undefined);
      }

      // El layout relativo queda intacto, centrado en el punto pedido.
      const boxes = Object.entries(layout).map(([id, l]) => ({ ...l, ...sizeOf(src.elements[id]!, l) }));
      const origin = {
        x: Math.round(at.x - Math.max(...boxes.map((b) => b.x + b.w)) / 2),
        y: Math.round(at.y - Math.max(...boxes.map((b) => b.y + b.h)) / 2),
      };
      const nodes = next.views[view]!.nodes;
      expect(Object.keys(nodes).sort()).toEqual([...ids].sort());
      for (const [id, l] of Object.entries(layout)) expect(nodes[created.get(id)!]).toEqual({ ...l, x: origin.x + l.x, y: origin.y + l.y });
      // Los marcos envuelven justo a sus hijos ("Ajustar marcos" no tiene nada que hacer) y nada se pisa.
      expect(fitFramesOp(next, view), template.name).toBeNull();
      expectTidy(next, view);

      // Las relaciones de red del bloque unen a los elementos nuevos.
      expect(added.size - ids.length).toBe(Object.keys(src.relations).length);
      for (const rel of Object.values(src.relations)) {
        expect(next.relations[`${created.get(rel.from)}--${created.get(rel.to)}`]).toMatchObject({ protocols: ['https'], ports: [443] });
      }
    }
  });

  it('genera IDs únicos: insertarlo otra vez no pisa lo anterior', () => {
    const { model, view } = qaCanvas();
    const red = builtin('builtin:red-subredes');
    const first = instantiateBlockOp(model, red, view, { x: 0, y: 0 });
    const one = applyOp(model, first.op).model;
    expect([...first.ids].sort()).toEqual(['balanceador', 'red', 'subred-privada', 'subred-publica']);

    const second = instantiateBlockOp(one, red, view, { x: 0, y: 0 }, { nest: false });
    const two = applyOp(one, second.op).model;
    expect([...second.ids].sort()).toEqual(['balanceador-2', 'red-2', 'subred-privada-2', 'subred-publica-2']);
    expect(two.elements['balanceador-2']!.parent).toBe('subred-publica-2');
    expect(two.relations['balanceador-2--subred-privada-2']).toMatchObject({ from: 'balanceador-2', to: 'subred-privada-2' });
    expect(two.elements.red).toEqual(one.elements.red);
    expectTidy(two, view);

    // "datacenter" ya es un grupo del demo: el nodo del bloque recibe otro ID.
    expect(instantiateBlockOp(model, builtin('builtin:datacenter-firewall'), view, { x: 0, y: 0 }).ids).toContain('datacenter-2');
  });

  it('dentro de un nodo del lienzo queda como hijo suyo, donde se soltó, si entra', () => {
    const { model: base, view } = qaCanvas();
    const model = applyOp(base, {
      type: 'batch',
      ops: [
        { type: 'element.add', element: { id: 'nube', kind: 'node', name: 'Nube', node: { type: 'cloud' } } },
        { type: 'view.place', view, nodes: { nube: { x: 0, y: 0, w: 1800, h: 1000 } } },
      ],
    }).model;
    const dc = builtin('builtin:datacenter-firewall');
    const one = applyOp(model, instantiateBlockOp(model, dc, view, { x: 900, y: 500 }).op).model;
    expect(one.elements['datacenter-2']).toMatchObject({ parent: 'nube', environments: ['qa'] });
    expect(one.elements.firewall!.parent).toBe('datacenter-2');
    expect(one.views[view]!.nodes['datacenter-2']).toEqual({ x: 520, y: 360, w: 760, h: 280 });
    expect(one.views[view]!.nodes.nube).toEqual(model.views[view]!.nodes.nube);

    // Otro al lado: busca lugar libre dentro del mismo nodo, sin pisar al anterior ni agrandarlo.
    const two = applyOp(one, instantiateBlockOp(one, dc, view, { x: 900, y: 700 }).op).model;
    expect(two.elements['datacenter-3']!.parent).toBe('nube');
    expect(two.views[view]!.nodes.nube).toEqual(model.views[view]!.nodes.nube);
    expectTidy(two, view);
    expect(problems(two)).toEqual(problems(model));
  });

  it('si no entra, el nodo y los marcos que lo contienen crecen para seguir envolviéndolo', () => {
    const model = demoModel();
    const before = model.views[PROD]!.nodes;
    // La subred privada del demo (780×490) ya tiene un clúster y tres instancias.
    const subnet = before['subnet-privada-prod']!;
    const { op } = instantiateBlockOp(model, builtin('builtin:cluster-namespaces'), PROD, { x: subnet.x + 700, y: subnet.y + 440 });
    const next = applyOp(model, op).model;
    expect(next.elements.cluster).toMatchObject({ parent: 'subnet-privada-prod', environments: ['prod'] });
    expect(next.elements.ingress!.parent).toBe('cluster');
    expect(next.elements['namespace-a']!.parent).toBe('cluster');
    expect(problems(next)).toEqual(problems(model));
    expectTidy(next, PROD);
    // Crecen sin moverse la subred, la VPC y la nube; lo que ya contenían queda donde estaba.
    for (const frame of ['subnet-privada-prod', 'vpc-prod', 'aws-prod']) {
      const a = boxOf(model, PROD, frame);
      const b = boxOf(next, PROD, frame);
      expect([b.x, b.y]).toEqual([a.x, a.y]);
      expect(b.w >= a.w && b.h > a.h, frame).toBe(true);
    }
    for (const id of ['eks-prod', 'banking-db-prod', 'alb-prod', 'subnet-publica-prod', 'cdn-prod']) expect(next.views[PROD]!.nodes[id]).toEqual(before[id]);
  });

  it('lo que estaba al lado de un nodo que crece se corre para hacerle lugar', () => {
    const model = demoModel();
    const dc = model.views[PROD]!.nodes['dc-central']!;
    const { op, ids } = instantiateBlockOp(model, builtin('builtin:borde-web'), PROD, { x: dc.x + 150, y: dc.y + 150 });
    const next = applyOp(model, op).model;
    for (const id of ids) expect(next.elements[id]).toMatchObject({ parent: 'dc-central', environments: ['prod'] });
    expect(problems(next)).toEqual(problems(model));
    expectTidy(next, PROD);
    // La pasarela de pagos estaba 100 debajo del datacenter: baja con él en lugar de quedar tapada.
    const grown = boxOf(next, PROD, 'dc-central');
    expect(grown.h).toBeGreaterThan(dc.h!);
    expect(next.views[PROD]!.nodes['pasarela-pagos']).toEqual({ ...model.views[PROD]!.nodes['pasarela-pagos']!, y: grown.y + grown.h + 100 });
    // Lo que no estaba en el camino no se toca.
    expect(next.views[PROD]!.nodes['aws-prod']).toEqual(model.views[PROD]!.nodes['aws-prod']);
  });

  it('con nest: false va suelto aunque el punto caiga dentro de un nodo', () => {
    const model = demoModel();
    const dc = model.views[PROD]!.nodes['dc-central']!;
    const { op, ids } = instantiateBlockOp(model, builtin('builtin:borde-web'), PROD, { x: dc.x + 150, y: dc.y + 150 }, { nest: false });
    const next = applyOp(model, op).model;
    for (const id of ids) expect(next.elements[id]!.parent).toBeUndefined();
    expect(next.views[PROD]!.nodes['dc-central']).toEqual(dc);
    expectTidy(next, PROD);

    // Tampoco se anida en un nodo que no existe en el ambiente del lienzo (la nube de producción
    // ubicada en uno de QA): lo insertado quedaría en un ambiente donde su nodo no está.
    const { model: base, view } = qaCanvas();
    const qa = applyOp(base, { type: 'view.place', view, nodes: { 'aws-prod': { x: 0, y: 0, w: 1600, h: 900 } } }).model;
    const loose = applyOp(qa, instantiateBlockOp(qa, builtin('builtin:borde-web'), view, { x: 800, y: 450 }).op).model;
    expect(loose.elements.dns).toMatchObject({ environments: ['qa'] });
    expect(loose.elements.dns!.parent).toBeUndefined();
    expect(problems(loose)).toEqual(problems(qa));
    expectTidy(loose, view);
  });

  it('van solo en lienzos de despliegue, y ahí no entran los bloques de C4', () => {
    const model = demoModel();
    const deployment = model.views[PROD]!;
    for (const t of DEPLOYMENT_BLOCKS.map(builtin)) {
      expect(blockProblem(t, deployment)).toBeNull();
      for (const id of ['landscape', 'home-banking-containers', 'pagos-api-components']) {
        expect(blockProblem(t, model.views[id]!)).toMatch(/lienzo de despliegue/);
        expect(() => instantiateBlockOp(model, t, id, { x: 0, y: 0 })).toThrow(/despliegue/);
      }
    }
    for (const t of C4_BLOCKS.map(builtin)) {
      expect(blockProblem(t, deployment)).toMatch(/contenedores \(L2\)/);
      expect(() => instantiateBlockOp(model, t, PROD, { x: 0, y: 0 })).toThrow(/contenedores/);
    }
    // Un bloque de L1 con un actor y un sistema (tipos que un despliegue sí ubica) tampoco entra.
    const context = templateFromSelection(model, 'landscape', ['cliente', 'pasarela-pagos'], { id: 'contexto', name: 'Contexto' });
    expect(blockProblem(context, model.views.landscape!)).toBeNull();
    expect(blockProblem(context, deployment)).toMatch(/contexto \(L1\)/);
  });

  it('un bloque guardado desde un despliegue pasa al ambiente del lienzo donde se inserta', () => {
    const { model, view } = qaCanvas();
    const saved = templateFromSelection(model, PROD, ['cliente', 'cdn-prod', 'alb-prod'], { id: 'borde', name: 'Borde de la banca' });
    expect(templateStats(saved).level).toBe('deployment');
    expect(blockProblem(saved, model.views.landscape!)).toMatch(/lienzo de despliegue/);
    const { op } = instantiateBlockOp(model, saved, view, { x: 0, y: 0 });
    const next = applyOp(model, op).model;
    // La infraestructura era de producción; el actor vale para todos los ambientes y así sigue.
    expect(next.elements.cdn!.environments).toEqual(['qa']);
    expect(next.elements['balanceador-publico']!.environments).toEqual(['qa']);
    expect(next.elements['cliente-2']!.environments).toBeUndefined();
    expect(next.relations['cdn--balanceador-publico']).toBeDefined();
    expect(problems(next)).toEqual(problems(model));
  });
});

describe('templateFromSelection', () => {
  it('captura descendientes, relaciones internas, layout relativo y lienzos de detalle', () => {
    const model = sampleModel();
    // En L1: el sistema banking arrastra sus contenedores, componentes y el lienzo L2.
    const t = templateFromSelection(model, 'landscape', ['banking', 'customer'], { id: 'mi-template', name: 'Banca' });
    expect(t.kind).toBe('block');
    expect(Object.keys(t.model.elements).sort()).toEqual(['accounts', 'api', 'banking', 'customer', 'db', 'web']);
    expect(t.model.elements.banking!.groups).toBeUndefined(); // el grupo AWS no se seleccionó
    expect(Object.keys(t.model.relations).sort()).toEqual(['accounts--db', 'customer--web', 'web--api']);
    expect(t.model.views[BLOCK_VIEW]!.nodes).toEqual({ banking: { x: 0, y: 200 }, customer: { x: 0, y: 0 } });
    expect(t.model.views['banking-containers']!.nodes.core).toBeUndefined();

    // Al insertarlo en otro workspace se recrean el sistema, su jerarquía y su lienzo L2.
    const target = demoModel();
    const { op, ids } = instantiateBlockOp(target, t, 'landscape', { x: 0, y: 900 });
    const next = applyOp(target, op).model;
    expect(errors(next)).toEqual([]);
    expect(ids).toContain('home-banking-2');
    expect(next.elements.api!.parent).toBeDefined();
    const childView = Object.values(next.views).find((v) => v.scope === 'home-banking-2');
    expect(childView?.level).toBe(2);
  });

  it('sin selección válida es un error', () => {
    expect(() => templateFromSelection(sampleModel(), 'landscape', ['nope'], { id: 'x', name: 'X' })).toThrow(/al menos un elemento/);
  });
});

describe('templates de workspace', () => {
  it('un workspace nuevo desde un template conserva todo menos la identidad', () => {
    const t = templateFromWorkspace(demoModel(), { id: 'mi-base', name: 'Mi base' });
    const ws = workspaceFromTemplate(t, { id: 'nuevo', name: 'Proyecto nuevo' });
    expect(ws.workspace).toMatchObject({ id: 'nuevo', name: 'Proyecto nuevo', defaultView: 'landscape' });
    expect(Object.keys(ws.elements).length).toBe(Object.keys(demoModel().elements).length);
    expect(errors(ws)).toEqual([]);
  });
});
