import { describe, expect, it } from 'vitest';
import { viewEdges } from '../ops/commands.ts';
import { sampleModel } from '../test-fixtures.ts';
import { buildElkGraph, edgeLabelParts, edgeLabelSize, type ElkGraphNode } from './elk.ts';

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

    const ends = (n: ElkGraphNode) => (n.edges ?? []).map((e) => `${e.sources[0]}>${e.targets[0]}`).sort();
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
});
