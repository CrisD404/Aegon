import { describe, expect, it } from 'vitest';
import { placeableElements, placementProblem, validateModel } from './index.ts';
import { sampleModel } from '../test-fixtures.ts';
import { slugify, uniqueId } from '../ids/index.ts';
import { searchCatalog, suggestProtocols, DB_ENGINES, MESSAGE_BROKERS, TECHNOLOGIES } from '../catalog/index.ts';
import type { Model } from '../model/index.ts';

describe('validateModel', () => {
  it('el modelo de ejemplo no tiene errores', () => {
    const errors = validateModel(sampleModel()).filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('detecta referencias colgantes y scopes inválidos (YAML editado a mano)', () => {
    const model = sampleModel();
    const broken: Model = {
      ...model,
      elements: { ...model.elements, web: { ...model.elements.web!, parent: 'nope' } },
      relations: { ...model.relations, bad: { id: 'bad', from: 'api', to: 'ghost' } },
      views: { ...model.views, l3: { id: 'l3', name: 'L3', level: 3, scope: 'banking', nodes: { ghost: { x: 0, y: 0 } } } },
    };
    const codes = validateModel(broken).map((d) => d.code);
    expect(codes).toEqual(expect.arrayContaining(['missing-parent', 'missing-endpoint', 'invalid-scope', 'missing-node']));
  });

  it('avisa containers sin sistema y elementos fuera de todo lienzo', () => {
    const model = sampleModel();
    const next: Model = {
      ...model,
      elements: { ...model.elements, lone: { id: 'lone', kind: 'container', name: 'Suelto' } },
    };
    const lone = validateModel(next).filter((d) => d.entity?.id === 'lone').map((d) => d.code);
    expect(lone).toEqual(['orphan-child', 'not-in-view']);
  });
});

describe('placement', () => {
  it('respeta los tipos por nivel y no permite ubicar el scope', () => {
    const model = sampleModel();
    const l1 = model.views.landscape!;
    const l2 = model.views['banking-containers']!;
    expect(placementProblem(model, l1, model.elements.api!)).not.toBeNull();
    expect(placementProblem(model, l2, model.elements.banking!)).not.toBeNull();
    expect(placementProblem(model, l2, model.elements.customer!)).toBeNull();
    expect(placeableElements(model, l2).map((e) => e.id)).toEqual(['aws', 'core-gw', 'customer']);
  });
});

describe('ids y catálogo', () => {
  it('slugify normaliza acentos y símbolos', () => {
    expect(slugify('Pasarela de Pagos (v2)')).toBe('pasarela-de-pagos-v2');
    expect(slugify('Ñandú  Ágil')).toBe('nandu-agil');
    expect(slugify('***', 'system')).toBe('system');
  });

  it('uniqueId agrega sufijos', () => {
    const taken = new Set(['api', 'api-2']);
    expect(uniqueId('api', (id) => taken.has(id))).toBe('api-3');
  });

  it('searchCatalog prioriza coincidencias exactas y keywords', () => {
    expect(searchCatalog(DB_ENGINES, 'postgres')[0]!.id).toBe('postgresql');
    expect(searchCatalog(DB_ENGINES, 'mongo')[0]!.id).toBe('mongodb');
  });

  it('cada cosa en su catálogo: sin brokers ni motores entre las tecnologías', () => {
    const tech = new Set(TECHNOLOGIES.map((t) => t.id));
    for (const id of ['kafka', 'rabbitmq', 'postgresql', 'https', 'grpc', 'jdbc']) expect(tech.has(id)).toBe(false);
    expect(DB_ENGINES.some((e) => ['kafka', 'rabbitmq', 'sqs'].includes(e.id))).toBe(false);
    expect(MESSAGE_BROKERS.map((b) => b.id)).toEqual(expect.arrayContaining(['kafka', 'rabbitmq', 'sqs', 'pubsub']));
  });

  it('suggestProtocols ordena según el destino', () => {
    const pg = { id: 'db', kind: 'store', name: 'DB', store: { engine: 'postgresql' } } as const;
    expect(suggestProtocols(pg, '', 3).map((p) => p.id)).toEqual(['jdbc', 'sql', 'odbc']);
    const kafka = { id: 'bus', kind: 'bus', name: 'Bus', bus: { broker: 'kafka' } } as const;
    expect(suggestProtocols(kafka, '', 1)[0]!.id).toBe('kafka');
    const rabbit = { id: 'bus', kind: 'bus', name: 'Bus', bus: { broker: 'rabbitmq' } } as const;
    expect(suggestProtocols(rabbit, '', 1)[0]!.id).toBe('amqp');
    const api = { id: 'api', kind: 'container', name: 'API', containerType: 'api' } as const;
    expect(suggestProtocols(api, '', 3).map((p) => p.group)).toEqual(['web', 'web', 'web']);
    // Hacia una base de datos la mensajería va al final.
    const all = suggestProtocols(pg, '', 100);
    expect(all.findIndex((p) => p.group === 'messaging')).toBeGreaterThan(all.findIndex((p) => p.group === 'web'));
  });
});
