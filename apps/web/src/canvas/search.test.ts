import { describe, expect, it } from 'vitest';
import { demoModel } from '@aegon/core';
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
