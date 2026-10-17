import { describe, expect, it } from 'vitest';
import { demoModel } from '../lib/demo.ts';
import { align, computeGuides, distribute, layeredLayout } from '../lib/geometry.ts';
import { absoluteRects, deriveBoundary, deriveEdges, deriveNodes, visualParentOf } from './derive.ts';

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
