import { describe, expect, it } from 'vitest';
import { edgeLabelSize, emptyModel, sizeOf, type Element, type Model, type Relation, type View } from '@aegon/core';
import { demoModel } from '../lib/demo.ts';
import { align, computeGuides, distribute, layeredLayout } from '../lib/geometry.ts';
import {
  absoluteRects,
  deriveBoundary,
  deriveEdges,
  deriveNodes,
  frameTitleRect,
  visualParentOf,
  type RelationFlowEdge,
} from './derive.ts';
import { floatingEnds, pointOnEdge, type Rect } from './edges/geometry.ts';

const none = new Set<string>();

describe('deriveNodes', () => {
  const model = demoModel();
  const landscape = model.views.landscape!;

  it('pone los grupos primero y usa posiciones relativas al grupo', () => {
    const nodes = deriveNodes(model, landscape, none);
    expect(nodes.slice(0, 2).map((n) => n.type)).toEqual(['group', 'group']);
    const hb = nodes.find((n) => n.id === 'home-banking')!;
    expect(hb.parentId).toBe('aws-us-east-1');
    expect(hb.position).toEqual({ x: 40, y: 64 }); // 0 - (-40), 184 - 120
    const abs = absoluteRects(nodes).get('home-banking')!;
    expect({ x: abs.x, y: abs.y }).toEqual({ x: 0, y: 184 });
  });

  it('reutiliza el objeto data si el elemento no cambió (nodos memoizados)', () => {
    const a = deriveNodes(model, landscape, none).find((n) => n.id === 'core-bancario')!;
    const b = deriveNodes(model, landscape, none).find((n) => n.id === 'core-bancario')!;
    expect(a.data).toBe(b.data);
  });

  it('visualParentOf ignora grupos que no están en el lienzo', () => {
    const l2 = model.views['home-banking-containers']!;
    expect(visualParentOf(model, l2, model.elements['home-banking']!)).toBeUndefined();
    expect(visualParentOf(model, landscape, model.elements['core-bancario']!)).toBe('datacenter');
  });
});

describe('deriveEdges', () => {
  const model = demoModel();

  it('en L1 dibuja relaciones implícitas agrupadas entre sistemas', () => {
    const edges = deriveEdges(model, model.views.landscape!, none, none, none);
    const implied = edges.filter((e) => e.data!.implied);
    const hbCore = implied.find((e) => e.source === 'home-banking' && e.target === 'core-bancario')!;
    // cuentas-api → core-bancario y core-client → core-bancario
    expect(hbCore.data!.relations.map((r) => r.id).sort()).toEqual(['core-client--core-bancario', 'cuentas-api--core-bancario']);
    expect(edges.find((e) => e.id === 'operador--core-bancario')!.data!.implied).toBe(false);
  });

  it('anima las dependencias del seleccionado y resalta a quienes dependen de él', () => {
    const edges = deriveEdges(model, model.views['home-banking-containers']!, new Set(['api-gateway']), none, none);
    const flow = (f: string) => edges.filter((e) => e.data!.flow === f).map((e) => e.id).sort();
    expect(flow('out')).toEqual(['api-gateway--cache', 'api-gateway--cuentas-api', 'api-gateway--pagos-api']);
    expect(flow('in')).toEqual(['app-movil--api-gateway', 'web-app--api-gateway']);
  });

  it('dibuja una sola línea por par: implícitas en ambos sentidos se vuelven bidireccionales', () => {
    const base = demoModel();
    const model = {
      ...base,
      relations: { ...base.relations, back: { id: 'back', from: 'core-bancario', to: 'cuentas-api', label: 'Notifica' } },
    };
    const edges = deriveEdges(model, model.views.landscape!, none, none, none);
    const between = edges.filter((e) => [e.source, e.target].sort().join() === 'core-bancario,home-banking');
    expect(between).toHaveLength(1);
    expect(between[0]!.data!.bidirectional).toBe(true);
  });
});

describe('ubicación de etiquetas', () => {
  // Un nodo de despliegue y dos elementos sueltos unidos por una flecha horizontal a la altura `y`.
  function crossing(y: number): { model: Model; view: View } {
    const els: Element[] = [
      { id: 'portal', kind: 'node', name: 'portal.example.com', node: { type: 'server' } },
      { id: 'dns', kind: 'infra', name: 'DNS', infra: { type: 'dns' } },
      { id: 'apim', kind: 'infra', name: 'API Manager', infra: { type: 'gateway' } },
    ];
    const rel: Relation = { id: 'dns--apim', from: 'dns', to: 'apim', label: 'Resuelve el portal' };
    const view: View = {
      id: 'despliegue',
      name: 'Despliegue',
      level: 'deployment',
      nodes: {
        portal: { x: 0, y: 0, w: 600, h: 300 },
        dns: { x: -700, y: y - 40, w: 200, h: 80 },
        apim: { x: 900, y: y - 40, w: 200, h: 80 },
      },
    };
    const model: Model = {
      ...emptyModel('m', 'M'),
      elements: Object.fromEntries(els.map((e) => [e.id, e])),
      relations: { [rel.id]: rel },
      views: { [view.id]: view },
    };
    return { model, view };
  }

  function labelRect(model: Model, view: View, edge: RelationFlowEdge): Rect {
    const rect = (id: string) => ({ x: view.nodes[id]!.x, y: view.nodes[id]!.y, ...sizeOf(model.elements[id]!, view.nodes[id]) });
    const p = pointOnEdge(edge.data!.shape, floatingEnds(rect(edge.source), rect(edge.target)), edge.data!.labelT ?? 0.5)!;
    const size = edgeLabelSize(edge.data!)!;
    return { x: p.x - size.width / 2, y: p.y - size.height / 2, w: size.width, h: size.height };
  }

  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it('corre la etiqueta que caería sobre el título de un marco', () => {
    const { model, view } = crossing(20);
    const [edge] = deriveEdges(model, view, none, none, none);
    const title = frameTitleRect(model.elements.portal!, { x: 0, y: 0, w: 600, h: 300 });
    expect(overlaps(labelRect(model, view, { ...edge!, data: { ...edge!.data!, labelT: undefined } }), title)).toBe(true);
    expect(edge!.data!.labelT).toBeDefined();
    expect(overlaps(labelRect(model, view, edge!), title)).toBe(false);
  });

  it('el resto del marco es fondo: la etiqueta queda en el medio', () => {
    const { model, view } = crossing(200);
    const [edge] = deriveEdges(model, view, none, none, none);
    expect(edge!.data!.labelT).toBeUndefined();
  });

  it('la franja del título es tan ancha como el texto y tan alta como sus líneas', () => {
    const frame = { x: 100, y: 50, w: 900, h: 400 };
    const plain: Element = { id: 'dc', kind: 'node', name: 'Datacenter central', node: { type: 'datacenter' } };
    const withIds: Element = { ...plain, addresses: ['10.0.0.0/16'] };
    const group: Element = { id: 'g', kind: 'group', name: 'AWS', group: { provider: 'aws', region: 'us-east-1' } };
    const system: Element = { id: 's', kind: 'system', name: 'Home Banking' };
    for (const el of [plain, withIds, group, system]) {
      const r = frameTitleRect(el, frame);
      expect({ x: r.x, y: r.y }).toEqual({ x: 100, y: 50 });
      expect(r.w).toBeGreaterThan(100);
      expect(r.w).toBeLessThan(frame.w / 2);
    }
    expect(frameTitleRect(plain, frame).h).toBeLessThan(frameTitleRect(withIds, frame).h);
    expect(frameTitleRect(withIds, frame).h).toBeGreaterThanOrEqual(56);
    expect(frameTitleRect(withIds, frame).h).toBeLessThanOrEqual(64);
    // Nunca más ancha que el marco.
    expect(frameTitleRect({ ...plain, name: 'x'.repeat(200) }, frame).w).toBeLessThanOrEqual(frame.w);
  });
});

describe('deriveBoundary', () => {
  it('envuelve a los hijos del scope con margen', () => {
    const model = demoModel();
    const view = model.views['pagos-api-components']!;
    const nodes = deriveNodes(model, view, none);
    const boundary = deriveBoundary(model, view, nodes)!;
    expect(boundary.id).toBe('boundary:pagos-api');
    // Componentes entre x -160..716 (core-client en 496 + 220 de ancho) → margen 40 a los lados y 56 arriba
    expect(boundary.position).toEqual({ x: -200, y: -56 });
    expect(boundary.width).toBe(716 - -160 + 80);
  });
});

describe('geometría', () => {
  it('computeGuides hace snap al borde más cercano dentro del umbral', () => {
    const { dx, dy, lines } = computeGuides({ x: 103, y: 50, w: 100, h: 40 }, [{ x: 100, y: 300, w: 120, h: 60 }], 6);
    expect(dx).toBe(-3);
    expect(dy).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ orientation: 'v', at: 100 });
  });

  it('align y distribute', () => {
    const rects = [
      { id: 'a', x: 0, y: 0, w: 100, h: 50 },
      { id: 'b', x: 30, y: 200, w: 60, h: 50 },
      { id: 'c', x: 500, y: 90, w: 100, h: 50 },
    ];
    expect(align(rects, 'left').get('b')).toEqual({ x: 0, y: 200 });
    expect(align(rects, 'vcenter').get('a')).toEqual({ x: 0, y: 100 });
    const d = distribute(rects, 'h');
    expect(d.get('b')!.x).toBeCloseTo(270);
  });

  it('layeredLayout ordena por capas siguiendo la dirección y tolera ciclos', () => {
    const rects = ['a', 'b', 'c', 'd'].map((id) => ({ id, x: 0, y: 0, w: 100, h: 50 }));
    const pos = layeredLayout(rects, [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'b' },
      { from: 'a', to: 'd' },
    ], { x: 0, y: 0 });
    expect(pos.get('a')!.y).toBe(0);
    expect(pos.get('b')!.y).toBeGreaterThan(0);
    expect(pos.get('c')!.y).toBeGreaterThan(pos.get('b')!.y);
    expect(pos.size).toBe(4);
  });
});
