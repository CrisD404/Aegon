import { describe, expect, it } from 'vitest';
import { applyOps, type Op } from '../ops/index.ts';
import { demoModel } from '../demo.ts';
import { sampleModel } from '../test-fixtures.ts';
import { analysisDiagnostics, analyzeModel } from './index.ts';

const withOps = (ops: Op[]) => applyOps(sampleModel(), ops).model;

describe('analyzeModel', () => {
  it('el demo no tiene errores, huérfanos ni ciclos', () => {
    const a = analyzeModel(demoModel());
    expect(a.summary).toMatchObject({ errors: 0, warnings: 0, orphans: 0, cycles: 0 });
    expect(a.hotspots[0]).toMatchObject({ id: 'core-bancario', risk: 'critical' });
  });

  it('huérfanos: sin relaciones propias ni de sus hijos (los grupos no cuentan)', () => {
    const a = analyzeModel(withOps([
      { type: 'element.add', element: { id: 'solo', kind: 'system', name: 'Solo' } },
      { type: 'element.add', element: { id: 'solo-api', kind: 'container', name: 'Solo API', parent: 'solo' } },
    ]));
    expect(a.orphans.map((o) => o.id)).toEqual(['solo', 'solo-api']);
    // banking no tiene relaciones propias pero sí sus containers.
    expect(a.orphans.map((o) => o.id)).not.toContain('banking');
  });

  it('ciclos entre niveles y bidireccionales explícitas', () => {
    const cycle = analyzeModel(withOps([{ type: 'relation.add', relation: { id: 'db--web', from: 'db', to: 'web' } }]));
    expect(cycle.cycles).toEqual([{ elements: ['api', 'db', 'web'], relations: ['accounts--db', 'db--web', 'web--api'] }]);

    const mutual = analyzeModel(withOps([{ type: 'relation.update', id: 'web--api', patch: { direction: 'bidirectional' } }]));
    expect(mutual.cycles).toEqual([]);

    // Containers de sistemas distintos que se llaman mutuamente: ciclo entre sistemas.
    const systems = analyzeModel(withOps([{ type: 'relation.add', relation: { id: 'core-gw--web', from: 'core-gw', to: 'web' } }]));
    expect(systems.cycles).toEqual([{ elements: ['banking', 'core'], relations: ['api--core-gw', 'core-gw--web'] }]);
  });

  it('violaciones de estilo C4', () => {
    const a = analyzeModel(withOps([
      { type: 'relation.add', relation: { id: 'web--banking', from: 'web', to: 'banking' } },
      { type: 'relation.add', relation: { id: 'customer--db', from: 'customer', to: 'db' } },
    ]));
    expect(a.violations.map((v) => v.code).sort()).toEqual(['actor-to-store', 'ancestor-relation']);
  });

  it('relaciones sin protocolo con sugerencias (salvo llamadas en proceso)', () => {
    const a = analyzeModel(withOps([
      { type: 'element.add', element: { id: 'ledger', kind: 'component', name: 'Ledger', parent: 'api' } },
      { type: 'relation.add', relation: { id: 'accounts--ledger', from: 'accounts', to: 'ledger' } },
    ]));
    expect(a.missingProtocols.map((m) => m.relation)).toEqual(['accounts--db', 'api--core-gw', 'customer--web']);
    expect(a.missingProtocols[0]!.suggestions[0]).toBe('jdbc');
  });

  it('hotspots: riesgo, deprecados en uso y mucha dependencia', () => {
    const a = analyzeModel(withOps([{ type: 'element.update', id: 'core', patch: { status: 'deprecated' } }]));
    const core = a.hotspots.find((h) => h.id === 'core')!;
    expect(core.reasons).toEqual(['deprecado y todavía lo usan 1', '1 dependiente']);
    expect(core.dependents).toEqual(['api']);
    expect(analysisDiagnostics(a, sampleModel()).some((d) => d.code === 'risk-hotspot')).toBe(true);
  });
});
