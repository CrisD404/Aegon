import { describe, expect, it } from 'vitest';
import { applyOp, demoModel } from '@aegon/core';
import { focusSet, searchMatches } from './search.ts';

describe('búsqueda en el lienzo', () => {
  const model = demoModel();
  const view = model.views['home-banking-containers']!;

  it('busca por nombre sin importar acentos ni mayúsculas, y por tecnología', () => {
    expect(searchMatches(model, view, 'APP MOVIL')).toEqual(['app-movil']);
    expect(searchMatches(model, view, 'kong')).toEqual(['api-gateway']);
    expect(searchMatches(model, view, '')).toEqual([]);
  });

  it('todas las palabras tienen que aparecer y el orden es de lectura', () => {
    const apis = searchMatches(model, view, 'api');
    expect(apis.length).toBeGreaterThan(2);
    const ys = apis.map((id) => view.nodes[id]!.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(searchMatches(model, view, 'api pagos')).toEqual(['pagos-api']);
  });

  it('en despliegue busca por IP, ID del recurso y lo que despliega una instancia', () => {
    const dep = applyOp(model, {
      type: 'batch',
      ops: [
        { type: 'element.add', element: { id: 'egress', kind: 'infra', name: 'Egress', infra: { type: 'egress' }, addresses: ['10.20.30.85', '10.20.30.133'] } },
        { type: 'element.add', element: { id: 'vpc', kind: 'node', name: 'VPC', node: { type: 'network', size: 'm5.2xlarge' }, resource: 'vpc-0a1b2c3d' } },
        { type: 'element.add', element: { id: 'web-qa', kind: 'instance', name: 'pod-web', instance: { of: 'web-app' } } },
        { type: 'view.add', view: { id: 'dep', name: 'Despliegue', level: 'deployment', environment: 'qa', nodes: { egress: { x: 0, y: 0 }, vpc: { x: 0, y: 200 }, 'web-qa': { x: 300, y: 0 } } } },
      ],
    }).model;
    const v = dep.views.dep!;
    expect(searchMatches(dep, v, '10.20.30.133')).toEqual(['egress']);
    expect(searchMatches(dep, v, 'vpc-0a1b')).toEqual(['vpc']);
    expect(searchMatches(dep, v, 'm5.2xlarge')).toEqual(['vpc']);
    expect(searchMatches(dep, v, 'web-app')).toEqual(['web-qa']);
  });

  it('el foco toma la selección y sus vecinos directos', () => {
    const edges = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'b-c', source: 'b', target: 'c' },
      { id: 'c-d', source: 'c', target: 'd' },
    ];
    const set = focusSet(['b'], edges);
    expect([...set.nodes].sort()).toEqual(['a', 'b', 'c']);
    expect([...set.edges].sort()).toEqual(['a-b', 'b-c']);
  });
});
