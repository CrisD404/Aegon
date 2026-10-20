import { describe, expect, it } from 'vitest';
import { viewEdges } from '../ops/commands.ts';
import { emptyModel, type Model } from '../model/index.ts';
import type { Element, Relation, View } from '../schema/index.ts';
import { sampleModel } from '../test-fixtures.ts';
import { buildElkGraph, edgeLabelParts, edgeLabelSize, type ElkGraphNode } from './elk.ts';

const ends = (n: ElkGraphNode) => (n.edges ?? []).map((e) => `${e.sources[0]}>${e.targets[0]}`).sort();

/** Despliegue con dos marcos de primer nivel (datacenter y nube) y un camino de red que los cruza. */
function deploymentModel(): Model {
  const els: Element[] = [
    { id: 'usuario', kind: 'actor', name: 'Usuario' },
    { id: 'sys', kind: 'system', name: 'Sistema' },
    { id: 'web', kind: 'container', name: 'Web', parent: 'sys' },
    { id: 'db', kind: 'store', name: 'DB', parent: 'sys', store: { engine: 'postgresql' } },
    { id: 'dc', kind: 'node', name: 'Datacenter', node: { type: 'datacenter' } },
    { id: 'ingress', kind: 'infra', name: 'Ingress', parent: 'dc', infra: { type: 'ingress' } },
    { id: 'web-qa', kind: 'instance', name: 'Web', parent: 'dc', instance: { of: 'web' } },
    { id: 'nube', kind: 'node', name: 'Nube', node: { type: 'cloud' } },
    { id: 'lb', kind: 'infra', name: 'LB', parent: 'nube', infra: { type: 'load-balancer' } },
    { id: 'db-qa', kind: 'instance', name: 'DB', parent: 'nube', instance: { of: 'db' } },
  ];
  const rels: Relation[] = [
    { id: 'usuario--ingress', from: 'usuario', to: 'ingress', label: 'Entra', protocols: ['https'] },
    { id: 'ingress--web-qa', from: 'ingress', to: 'web-qa', label: 'Enruta' },
    { id: 'web-qa--lb', from: 'web-qa', to: 'lb', label: 'Sale a la nube' },
    { id: 'lb--db-qa', from: 'lb', to: 'db-qa', label: 'Balancea' },
  ];
  const view: View = {
    id: 'd',
    name: 'Despliegue',
    level: 'deployment',
    nodes: {
      usuario: { x: 0, y: 0 },
      dc: { x: 300, y: -60, w: 700, h: 200 },
      ingress: { x: 340, y: 0 },
      'web-qa': { x: 700, y: 0 },
      nube: { x: 1100, y: -60, w: 700, h: 200 },
      lb: { x: 1140, y: 0 },
      'db-qa': { x: 1500, y: 0 },
    },
  };
  return {
    ...emptyModel('demo', 'Demo'),
    elements: Object.fromEntries(els.map((e) => [e.id, e])),
    relations: Object.fromEntries(rels.map((r) => [r.id, r])),
    views: { d: view },
  };
}

describe('ELK', () => {
  it('la etiqueta de una flecha: texto como en el lienzo y tamaño estimado', () => {
    const model = sampleModel();
    const edges = viewEdges(model, model.views['banking-containers']!);
    const call = edges.find((e) => e.relations[0]!.id === 'web--api')!;
    expect(edgeLabelParts(call)).toEqual({ label: 'Llama', tech: 'HTTPS' });
    const short = edgeLabelSize(call)!;
    expect(short.width).toBeLessThan(80);
    expect(short.height).toBeGreaterThan(30); // dos líneas: texto y protocolo

    const long = edgeLabelSize({
      ...call,
      relations: [{ ...call.relations[0]!, label: 'Consulta el estado de la atención de cada sucursal en tiempo real' }],
    })!;
    // Hasta el máximo del lienzo (200 px): el texto salta de línea.
    expect(long.width).toBeGreaterThan(160);
    expect(long.width).toBeLessThanOrEqual(200);
    expect(long.height).toBeGreaterThan(short.height + 20);
    expect(edgeLabelSize({ relations: [], implied: false })).toBeNull();
  });

  it('L2: lo del sistema va dentro de su límite y cada flecha en el marco que contiene a sus extremos', () => {
    const model = sampleModel();
    const plan = buildElkGraph(model, model.views['banking-containers']!)!;
    const root = plan.graph;
    const boundary = root.children!.find((c) => c.id === '__boundary')!;
    expect(boundary.children!.map((c) => c.id).sort()).toEqual(['api', 'db', 'web']);
    expect(root.children!.map((c) => c.id)).toContain('core');

    expect(ends(boundary)).toEqual(['api>db', 'web>api']);
    expect(ends(root)).toEqual(['api>core']);
    // ELK ignora las etiquetas sin texto: todas lo llevan, con el tamaño estimado.
    for (const e of [...boundary.edges!, ...root.edges!]) {
      expect(e.labels![0]!.text).toBeTruthy();
      expect(e.labels![0]!.width).toBeGreaterThan(0);
    }
    // El límite es un marco auxiliar: no se reubica como un elemento del lienzo.
    expect(plan.targets).not.toContain('__boundary');
  });

  it('despliegue: cada marco de primer nivel es una franja y la raíz las apila', () => {
    const model = deploymentModel();
    const view = model.views['d']!;
    const root = buildElkGraph(model, view)!.graph;
    expect(root.layoutOptions).toMatchObject({ 'elk.hierarchyHandling': 'SEPARATE_CHILDREN', 'elk.direction': 'RIGHT' });
    const lane = (id: string) => root.children!.find((c) => c.id === id)!;
    for (const id of ['dc', 'nube']) {
      expect(lane(id).layoutOptions).toMatchObject({ 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.direction': 'RIGHT' });
    }
    expect(ends(lane('dc'))).toEqual(['ingress>web-qa']);
    expect(ends(lane('nube'))).toEqual(['lb>db-qa']);
    // Las que cruzan entre franjas, o entran desde afuera, no van a ELK: las traza el lienzo.
    expect(ends(root)).toEqual([]);

    // Con un solo marco no hay franjas: todo se ordena junto, como antes.
    const nodes = Object.fromEntries(Object.entries(view.nodes).filter(([id]) => !['nube', 'lb', 'db-qa'].includes(id)));
    const single = buildElkGraph(model, { ...view, nodes })!.graph;
    expect(single.layoutOptions!['elk.hierarchyHandling']).toBe('INCLUDE_CHILDREN');
    expect(ends(single)).toEqual(['usuario>ingress']);
  });

  it('despliegue dentro de un único marco: se baja por los marcos únicos hasta las franjas', () => {
    // Red (con un firewall suelto) → Zona → datacenter y nube: las franjas son las de adentro.
    const base = deploymentModel();
    const model: Model = {
      ...base,
      elements: {
        ...base.elements,
        red: { id: 'red', kind: 'node', name: 'Red', node: { type: 'network' } },
        zona: { id: 'zona', kind: 'node', name: 'Zona', parent: 'red', node: { type: 'zone' } },
        fw: { id: 'fw', kind: 'infra', name: 'Firewall', parent: 'red', infra: { type: 'firewall' } },
        dc: { ...base.elements['dc']!, parent: 'zona' },
        nube: { ...base.elements['nube']!, parent: 'zona' },
      },
      relations: {
        ...base.relations,
        'usuario--fw': { id: 'usuario--fw', from: 'usuario', to: 'fw', label: 'VPN' },
        'fw--ingress': { id: 'fw--ingress', from: 'fw', to: 'ingress', label: 'Filtra' },
      },
    };
    const view: View = {
      ...base.views['d']!,
      nodes: {
        ...base.views['d']!.nodes,
        red: { x: 200, y: -200, w: 1700, h: 500 },
        zona: { x: 260, y: -100, w: 1600, h: 360 },
        fw: { x: 240, y: -160 },
      },
    };
    const root = buildElkGraph(model, view)!.graph;
    const red = root.children!.find((c) => c.id === 'red')!;
    const zona = red.children!.find((c) => c.id === 'zona')!;
    const lane = (id: string) => zona.children!.find((c) => c.id === id)!;
    // La raíz y los marcos atravesados empaquetan lo que tienen adentro, como la raíz.
    expect(root.layoutOptions!['elk.hierarchyHandling']).toBe('SEPARATE_CHILDREN');
    for (const frame of [red, zona]) {
      expect(frame.layoutOptions).toMatchObject({
        'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
        'elk.direction': 'RIGHT',
        'elk.aspectRatio': '1.6',
        'elk.spacing.componentComponent': '96',
        'elk.padding': '[top=64,left=40,bottom=40,right=40]',
      });
    }
    for (const id of ['dc', 'nube']) {
      expect(lane(id).layoutOptions!['elk.hierarchyHandling']).toBe('INCLUDE_CHILDREN');
    }
    expect(ends(lane('dc'))).toEqual(['ingress>web-qa']);
    expect(ends(lane('nube'))).toEqual(['lb>db-qa']);
    // Entre franjas, desde afuera o desde lo suelto de un marco atravesado: las traza el lienzo.
    expect(ends(root)).toEqual([]);
    expect(ends(red)).toEqual([]);
    expect(ends(zona)).toEqual([]);

    // Si los marcos únicos llegan hasta las hojas, no hay franjas: una sola tira, como antes.
    const nodes = Object.fromEntries(
      Object.entries(view.nodes).filter(([id]) => !['nube', 'lb', 'db-qa'].includes(id)),
    );
    const chain = buildElkGraph(model, { ...view, nodes })!.graph;
    expect(chain.layoutOptions!['elk.hierarchyHandling']).toBe('INCLUDE_CHILDREN');
    const chainRed = chain.children!.find((c) => c.id === 'red')!;
    expect(chainRed.layoutOptions!['elk.hierarchyHandling']).toBeUndefined();
    expect(ends(chain)).toEqual(['usuario>fw', 'usuario>ingress']);
    expect(ends(chainRed)).toEqual(['fw>ingress']);
  });
});
