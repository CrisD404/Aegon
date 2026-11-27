import type { Model } from '../model/index.ts';
import { SCHEMA_VERSION, type Element, type Level, type NodeLayout, type Relation } from '../schema/index.ts';
import { demoModel } from '../demo.ts';
import { BLOCK_VIEW, type Template } from './index.ts';

/**
 * Arma el modelo de un bloque: de nivel 2 por defecto (contenedores sin padre: lo heredan al
 * insertarse) o de despliegue (nodos e infraestructura sin ambiente: toman el del lienzo).
 */
function block(id: string, name: string, elements: Element[], relations: Relation[], nodes: Record<string, NodeLayout>, level: Level = 2): Model {
  return {
    workspace: { schema: SCHEMA_VERSION, id, name },
    elements: Object.fromEntries(elements.map((e) => [e.id, e])),
    relations: Object.fromEntries(relations.map((r) => [r.id, r])),
    views: { [BLOCK_VIEW]: { id: BLOCK_VIEW, name, level, nodes } },
  };
}

/**
 * Bloques de despliegue: piezas de infraestructura genéricas, sin proveedor ni direcciones (los
 * elige quien las usa). Cada marco envuelve justo a sus hijos con el margen de `FRAME_PADDING`
 * (64 arriba, 40 a los costados y abajo), así "Ajustar marcos" no los mueve; los marcos vacíos
 * miden 300×176 (o más), lo que ocupa una instancia con ese margen. Entre lo que une una flecha
 * quedan 160 de aire (110 en vertical, 200 si cruza el borde de un marco) para que la etiqueta
 * no tape nada.
 */
function deploymentBlocks(): Template[] {
  const https = { protocols: ['https'], ports: [443] };
  return [
    {
      id: 'builtin:red-subredes',
      name: 'Red con subredes y balanceador',
      description: 'Una red (VPC, VNet) con una subred pública que tiene el balanceador y una privada vacía, lista para desplegar instancias.',
      kind: 'block',
      builtin: true,
      model: block(
        'red-subredes',
        'Red con subredes y balanceador',
        [
          { id: 'red', kind: 'node', name: 'Red', node: { type: 'network' } },
          { id: 'subred-publica', kind: 'node', name: 'Subred pública', parent: 'red', node: { type: 'subnet' } },
          { id: 'subred-privada', kind: 'node', name: 'Subred privada', parent: 'red', node: { type: 'subnet' } },
          { id: 'balanceador', kind: 'infra', name: 'Balanceador', parent: 'subred-publica', infra: { type: 'load-balancer' } },
        ],
        [{ id: 'balanceador--subred-privada', from: 'balanceador', to: 'subred-privada', label: 'Balancea', ...https }],
        {
          red: { x: 0, y: 0, w: 1100, h: 280 },
          'subred-publica': { x: 40, y: 64, w: 300, h: 176 },
          balanceador: { x: 80, y: 128 },
          'subred-privada': { x: 500, y: 64, w: 560, h: 176 },
        },
        'deployment',
      ),
    },
    {
      id: 'builtin:cluster-namespaces',
      name: 'Clúster con namespaces',
      description: 'Un clúster (Kubernetes, OpenShift) con su ingress y dos namespaces vacíos a los que rutea.',
      kind: 'block',
      builtin: true,
      model: block(
        'cluster-namespaces',
        'Clúster con namespaces',
        [
          { id: 'cluster', kind: 'node', name: 'Clúster', node: { type: 'cluster' } },
          { id: 'ingress', kind: 'infra', name: 'Ingress', parent: 'cluster', infra: { type: 'ingress' } },
          { id: 'namespace-a', kind: 'node', name: 'Namespace A', parent: 'cluster', node: { type: 'namespace' } },
          { id: 'namespace-b', kind: 'node', name: 'Namespace B', parent: 'cluster', node: { type: 'namespace' } },
        ],
        [
          { id: 'ingress--namespace-a', from: 'ingress', to: 'namespace-a', label: 'Rutea', ...https },
          { id: 'ingress--namespace-b', from: 'ingress', to: 'namespace-b', label: 'Rutea', ...https },
        ],
        {
          cluster: { x: 0, y: 0, w: 720, h: 462 },
          ingress: { x: 250, y: 64 },
          'namespace-a': { x: 40, y: 246, w: 300, h: 176 },
          'namespace-b': { x: 380, y: 246, w: 300, h: 176 },
        },
        'deployment',
      ),
    },
    {
      id: 'builtin:datacenter-firewall',
      name: 'Datacenter con firewall',
      description: 'Un datacenter propio (on-premise) con el firewall por el que entra el tráfico y un servidor detrás.',
      kind: 'block',
      builtin: true,
      model: block(
        'datacenter-firewall',
        'Datacenter con firewall',
        [
          { id: 'datacenter', kind: 'node', name: 'Datacenter', node: { type: 'datacenter' } },
          { id: 'firewall', kind: 'infra', name: 'Firewall', parent: 'datacenter', infra: { type: 'firewall' } },
          { id: 'servidor', kind: 'node', name: 'Servidor', parent: 'datacenter', node: { type: 'server' } },
        ],
        [{ id: 'firewall--servidor', from: 'firewall', to: 'servidor', label: 'Permite', ...https }],
        {
          datacenter: { x: 0, y: 0, w: 760, h: 280 },
          firewall: { x: 40, y: 116 },
          servidor: { x: 420, y: 64, w: 300, h: 176 },
        },
        'deployment',
      ),
    },
    {
      id: 'builtin:borde-web',
      name: 'Borde web',
      description: 'El camino de entrada desde internet: DNS, CDN y WAF en cadena por HTTPS (443).',
      kind: 'block',
      builtin: true,
      model: block(
        'borde-web',
        'Borde web',
        [
          { id: 'dns', kind: 'infra', name: 'DNS', infra: { type: 'dns' } },
          { id: 'cdn', kind: 'infra', name: 'CDN', infra: { type: 'cdn' } },
          { id: 'waf', kind: 'infra', name: 'WAF', infra: { type: 'waf' } },
        ],
        [
          { id: 'dns--cdn', from: 'dns', to: 'cdn', label: 'Resuelve', ...https },
          { id: 'cdn--waf', from: 'cdn', to: 'waf', label: 'Reenvía', ...https },
        ],
        {
          dns: { x: 0, y: 0 },
          cdn: { x: 380, y: 0 },
          waf: { x: 760, y: 0 },
        },
        'deployment',
      ),
    },
  ];
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
    ...deploymentBlocks(),
  ];
  return cache;
}
