import type { Model } from '../model/index.ts';
import { SCHEMA_VERSION, type Element, type NodeLayout, type Relation } from '../schema/index.ts';
import { demoModel } from '../demo.ts';
import { BLOCK_VIEW, type Template } from './index.ts';

/** Arma el modelo de un bloque de nivel 2 (contenedores sin padre: lo heredan al insertarse). */
function block(id: string, name: string, elements: Element[], relations: Relation[], nodes: Record<string, NodeLayout>): Model {
  return {
    workspace: { schema: SCHEMA_VERSION, id, name },
    elements: Object.fromEntries(elements.map((e) => [e.id, e])),
    relations: Object.fromEntries(relations.map((r) => [r.id, r])),
    views: { [BLOCK_VIEW]: { id: BLOCK_VIEW, name, level: 2, nodes } },
  };
}

let cache: Template[] | null = null;

/** Templates incluidos con Aegon. */
export function builtinTemplates(): Template[] {
  cache ??= [
    {
      id: 'builtin:banca-digital',
      name: 'Banca digital',
      description: 'Workspace de ejemplo completo: contexto, contenedores y componentes de una banca digital.',
      kind: 'workspace',
      builtin: true,
      model: demoModel(),
    },
    {
      id: 'builtin:api-gateway',
      name: 'API Gateway y servicios',
      description: 'Gateway con proveedor de identidad (OIDC), dos servicios de dominio y su base de datos.',
      kind: 'block',
      builtin: true,
      model: block(
        'api-gateway',
        'API Gateway y servicios',
        [
          { id: 'gateway', kind: 'container', name: 'API Gateway', containerType: 'api', technology: ['kong'], description: 'Autenticación, rate limiting y ruteo.' },
          { id: 'idp', kind: 'container', name: 'Proveedor de identidad', containerType: 'service', technology: ['keycloak'], description: 'Emite y valida tokens (OIDC).' },
          { id: 'servicio-a', kind: 'container', name: 'Servicio A', containerType: 'service', technology: ['java', 'spring-boot'] },
          { id: 'servicio-b', kind: 'container', name: 'Servicio B', containerType: 'service', technology: ['nodejs'] },
          { id: 'db', kind: 'store', name: 'Base de datos', store: { engine: 'postgresql', type: 'relational' } },
        ],
        [
          { id: 'gateway--idp', from: 'gateway', to: 'idp', label: 'Valida tokens', protocols: ['oidc'] },
          { id: 'gateway--servicio-a', from: 'gateway', to: 'servicio-a', label: 'Rutea', protocols: ['rest'] },
          { id: 'gateway--servicio-b', from: 'gateway', to: 'servicio-b', label: 'Rutea', protocols: ['rest'] },
          { id: 'servicio-a--db', from: 'servicio-a', to: 'db', label: 'Lee y escribe', protocols: ['jdbc'] },
        ],
        {
          gateway: { x: 160, y: 0 },
          idp: { x: 480, y: 0 },
          'servicio-a': { x: 0, y: 180 },
          'servicio-b': { x: 320, y: 180 },
          db: { x: 0, y: 360 },
        },
      ),
    },
    {
      id: 'builtin:event-driven',
      name: 'Event-driven con Kafka',
      description: 'Un productor publica en un bus Kafka y dos consumidores reaccionan; uno proyecta a su base.',
      kind: 'block',
      builtin: true,
      model: block(
        'event-driven',
        'Event-driven con Kafka',
        [
          { id: 'productor', kind: 'container', name: 'Productor', containerType: 'service' },
          { id: 'bus', kind: 'bus', name: 'Eventos de dominio', bus: { broker: 'kafka', type: 'stream', topics: ['dominio.eventos'] } },
          { id: 'consumidor-1', kind: 'container', name: 'Consumidor 1', containerType: 'worker' },
          { id: 'consumidor-2', kind: 'container', name: 'Consumidor 2', containerType: 'worker' },
          { id: 'proyeccion', kind: 'store', name: 'Proyección', store: { engine: 'mongodb', type: 'document' } },
        ],
        [
          { id: 'productor--bus', from: 'productor', to: 'bus', label: 'Publica', protocols: ['kafka'] },
          { id: 'consumidor-1--bus', from: 'consumidor-1', to: 'bus', label: 'Consume', protocols: ['kafka'] },
          { id: 'consumidor-2--bus', from: 'consumidor-2', to: 'bus', label: 'Consume', protocols: ['kafka'] },
          { id: 'consumidor-1--proyeccion', from: 'consumidor-1', to: 'proyeccion', label: 'Proyecta', protocols: ['mongodb-wire'] },
        ],
        {
          productor: { x: 0, y: 90 },
          bus: { x: 320, y: 90 },
          'consumidor-1': { x: 640, y: 0 },
          'consumidor-2': { x: 640, y: 180 },
          proyeccion: { x: 960, y: 0 },
        },
      ),
    },
    {
      id: 'builtin:web-api-db',
      name: 'Web, API y base de datos',
      description: 'El clásico de tres capas: SPA, API, base relacional y caché.',
      kind: 'block',
      builtin: true,
      model: block(
        'web-api-db',
        'Web, API y base de datos',
        [
          { id: 'web', kind: 'container', name: 'Web App', containerType: 'web', technology: ['react', 'typescript'] },
          { id: 'api', kind: 'container', name: 'API', containerType: 'api', technology: ['nodejs'] },
          { id: 'db', kind: 'store', name: 'Base de datos', store: { engine: 'postgresql', type: 'relational' } },
          { id: 'cache', kind: 'store', name: 'Caché', store: { engine: 'redis', type: 'cache' } },
        ],
        [
          { id: 'web--api', from: 'web', to: 'api', label: 'Llama', protocols: ['https'] },
          { id: 'api--db', from: 'api', to: 'db', label: 'Lee y escribe', protocols: ['sql'] },
          { id: 'api--cache', from: 'api', to: 'cache', label: 'Cachea', protocols: ['resp'] },
        ],
        {
          web: { x: 160, y: 0 },
          api: { x: 160, y: 180 },
          db: { x: 0, y: 360 },
          cache: { x: 320, y: 360 },
        },
      ),
    },
  ];
  return cache;
}
