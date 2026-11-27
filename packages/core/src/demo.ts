import { applyOps, type Op } from './ops/index.ts';
import { emptyModel, type Model } from './model/index.ts';

/** Workspace de ejemplo para el primer arranque: una banca digital con L1, L2, L3 y el despliegue de producción. */
export function demoModel(id = 'banca-digital'): Model {
  const el = (element: Extract<Op, { type: 'element.add' }>['element']): Op => ({ type: 'element.add', element });
  const rel = (relation: Extract<Op, { type: 'relation.add' }>['relation']): Op => ({ type: 'relation.add', relation });

  const ops: Op[] = [
    el({ id: 'aws-us-east-1', kind: 'group', name: 'AWS', group: { provider: 'aws', region: 'us-east-1' } }),
    el({ id: 'datacenter', kind: 'group', name: 'Datacenter central', group: { provider: 'onprem', region: 'Buenos Aires' } }),
    el({ id: 'cliente', kind: 'actor', name: 'Cliente', role: 'Persona o empresa con cuenta', scope: 'external' }),
    el({ id: 'operador', kind: 'actor', name: 'Operador de soporte', role: 'Mesa de ayuda' }),
    el({
      id: 'home-banking', kind: 'system', name: 'Home Banking',
      description: 'Consulta de cuentas, transferencias y pagos para clientes.',
      groups: ['aws-us-east-1'], technology: ['react', 'java'], risk: 'high', owner: 'Equipo Canales', tags: ['pci', 'canal-digital'],
    }),
    el({
      id: 'notificaciones', kind: 'system', name: 'Notificaciones',
      description: 'Envía e-mails, SMS y push a los clientes.', groups: ['aws-us-east-1'], technology: ['nodejs'], risk: 'low',
    }),
    el({
      id: 'core-bancario', kind: 'system', name: 'Core bancario',
      description: 'Sistema de registro de cuentas y movimientos.', scope: 'external', groups: ['datacenter'], technology: ['dotnet'], risk: 'critical',
    }),
    el({
      id: 'pasarela-pagos', kind: 'system', name: 'Pasarela de pagos',
      description: 'Procesador externo de tarjetas.', scope: 'external', risk: 'medium',
    }),
    // L2 — Home Banking
    el({ id: 'web-app', kind: 'container', name: 'Web App', parent: 'home-banking', containerType: 'web', technology: ['react', 'typescript'], description: 'SPA para clientes.' }),
    el({ id: 'app-movil', kind: 'container', name: 'App móvil', parent: 'home-banking', containerType: 'mobile', technology: ['flutter'], description: 'iOS y Android.' }),
    el({ id: 'api-gateway', kind: 'container', name: 'API Gateway', parent: 'home-banking', containerType: 'api', technology: ['kong'], description: 'Autenticación, rate limiting y ruteo.' }),
    el({ id: 'cuentas-api', kind: 'container', name: 'Cuentas API', parent: 'home-banking', containerType: 'service', technology: ['java', 'spring-boot'], risk: 'medium', description: 'Saldos, movimientos y extractos.' }),
    el({ id: 'pagos-api', kind: 'container', name: 'Pagos API', parent: 'home-banking', containerType: 'service', technology: ['go'], risk: 'high', description: 'Transferencias y pagos con tarjeta.' }),
    el({ id: 'banking-db', kind: 'store', name: 'Banking DB', parent: 'home-banking', store: { engine: 'postgresql', type: 'relational', version: '16', managed: 'aws-rds' }, description: 'Clientes, beneficiarios y preferencias.' }),
    el({ id: 'cache', kind: 'store', name: 'Caché de sesiones', parent: 'home-banking', store: { engine: 'redis', type: 'cache' } }),
    el({ id: 'eventos', kind: 'bus', name: 'Eventos de pagos', parent: 'home-banking', bus: { broker: 'kafka', type: 'stream', topics: ['pagos.autorizados', 'pagos.rechazados'] }, description: 'Eventos de dominio de pagos.' }),
    // L3 — Pagos API
    el({ id: 'transfer-controller', kind: 'component', name: 'Transfer Controller', parent: 'pagos-api', technology: ['go'], description: 'Endpoints REST de transferencias.' }),
    el({ id: 'fraude', kind: 'component', name: 'Motor antifraude', parent: 'pagos-api', technology: ['go'], risk: 'high', description: 'Reglas y scoring en línea.' }),
    el({ id: 'pagos-repo', kind: 'component', name: 'Pagos Repository', parent: 'pagos-api', technology: ['go'] }),
    el({ id: 'core-client', kind: 'component', name: 'Core Client', parent: 'pagos-api', technology: ['go'], description: 'Adaptador gRPC hacia el core bancario.' }),

    rel({ id: 'cliente--web-app', from: 'cliente', to: 'web-app', label: 'Opera sus cuentas', protocols: ['https'] }),
    rel({ id: 'cliente--app-movil', from: 'cliente', to: 'app-movil', label: 'Opera desde el celular' }),
    rel({ id: 'operador--core-bancario', from: 'operador', to: 'core-bancario', label: 'Consulta clientes' }),
    rel({ id: 'web-app--api-gateway', from: 'web-app', to: 'api-gateway', label: 'Llama', protocols: ['https'] }),
    rel({ id: 'app-movil--api-gateway', from: 'app-movil', to: 'api-gateway', label: 'Llama', protocols: ['https'] }),
    rel({ id: 'api-gateway--cuentas-api', from: 'api-gateway', to: 'cuentas-api', label: 'Rutea', protocols: ['rest'] }),
    rel({ id: 'api-gateway--pagos-api', from: 'api-gateway', to: 'pagos-api', label: 'Rutea', protocols: ['rest'] }),
    rel({ id: 'api-gateway--cache', from: 'api-gateway', to: 'cache', label: 'Sesiones', protocols: ['resp'] }),
    rel({ id: 'cuentas-api--banking-db', from: 'cuentas-api', to: 'banking-db', label: 'Lee y escribe', protocols: ['jdbc'] }),
    rel({ id: 'transfer-controller--fraude', from: 'transfer-controller', to: 'fraude', label: 'Evalúa riesgo' }),
    rel({ id: 'transfer-controller--pagos-repo', from: 'transfer-controller', to: 'pagos-repo', label: 'Persiste' }),
    rel({ id: 'pagos-repo--banking-db', from: 'pagos-repo', to: 'banking-db', label: 'Lee y escribe', protocols: ['jdbc'] }),
    rel({ id: 'transfer-controller--core-client', from: 'transfer-controller', to: 'core-client', label: 'Debita / acredita' }),
    rel({ id: 'core-client--core-bancario', from: 'core-client', to: 'core-bancario', label: 'Movimientos', protocols: ['grpc'] }),
    rel({ id: 'pagos-api--pasarela-pagos', from: 'pagos-api', to: 'pasarela-pagos', label: 'Cobra tarjetas', protocols: ['https'] }),
    rel({ id: 'pagos-api--eventos', from: 'pagos-api', to: 'eventos', label: 'Publica pagos', protocols: ['kafka'] }),
    rel({ id: 'notificaciones--eventos', from: 'notificaciones', to: 'eventos', label: 'Consume eventos', protocols: ['kafka'] }),
    rel({ id: 'cuentas-api--core-bancario', from: 'cuentas-api', to: 'core-bancario', label: 'Consulta saldos', protocols: ['soap'] }),

    {
      type: 'view.add',
      view: {
        id: 'landscape', name: 'Landscape', level: 1, description: 'Contexto de la banca digital.',
        nodes: {
          'aws-us-east-1': { x: -40, y: 120, w: 640, h: 240 },
          datacenter: { x: 760, y: 120, w: 320, h: 240 },
          cliente: { x: 156, y: -120 },
          operador: { x: 816, y: -120 },
          'home-banking': { x: 0, y: 184 },
          notificaciones: { x: 320, y: 184 },
          'core-bancario': { x: 800, y: 184 },
          'pasarela-pagos': { x: 400, y: 480 },
        },
      },
    },
    {
      type: 'view.add',
      view: {
        id: 'home-banking-containers', name: 'Home Banking · Contenedores', level: 2, scope: 'home-banking',
        nodes: {
          cliente: { x: 176, y: -300 },
          'web-app': { x: 0, y: 0 },
          'app-movil': { x: 320, y: 0 },
          'api-gateway': { x: 160, y: 200 },
          cache: { x: 520, y: 200 },
          'cuentas-api': { x: 0, y: 400 },
          'pagos-api': { x: 320, y: 400 },
          'banking-db': { x: 8, y: 600 },
          eventos: { x: 328, y: 600 },
          'core-bancario': { x: -400, y: 400 },
          'pasarela-pagos': { x: 760, y: 400 },
          notificaciones: { x: 760, y: 600 },
        },
      },
    },
    {
      type: 'view.add',
      view: {
        id: 'pagos-api-components', name: 'Pagos API · Componentes', level: 3, scope: 'pagos-api',
        nodes: {
          'api-gateway': { x: 160, y: -260 },
          'transfer-controller': { x: 168, y: 0 },
          fraude: { x: -160, y: 200 },
          'pagos-repo': { x: 168, y: 200 },
          'core-client': { x: 496, y: 200 },
          'banking-db': { x: 168, y: 460 },
          'core-bancario': { x: 488, y: 460 },
        },
      },
    },
    { type: 'workspace.update', patch: { defaultView: 'landscape', description: 'Workspace de ejemplo de Aegon.', organization: 'Aegon Demo' } },

    // FinOps: ambientes, presupuestos y costos mensuales estimados (USD).
    {
      type: 'workspace.update',
      patch: {
        environments: [
          { id: 'dev', name: 'Desarrollo' },
          { id: 'qa', name: 'QA' },
          { id: 'pre', name: 'Preproducción' },
          { id: 'prod', name: 'Producción' },
        ],
        finops: { currency: 'USD', tagKeys: ['cost-center', 'project'], budgets: { dev: 800, qa: 900, pre: 2500, prod: 9000 } },
      },
    },
    ...finops(),
    ...deployment(),
    ...flowsAndComments(),
  ];
  return applyOps(emptyModel(id, 'Banca digital (demo)'), ops).model;
}

type Costs = Record<string, { monthly: number; replicas?: number; sku?: string }>;

function finops(): Op[] {
  const set = (id: string, costs: Costs, extra: { tags?: Record<string, string>; environments?: string[] } = {}): Op => ({
    type: 'element.update',
    id,
    patch: { finops: { costs, ...(extra.tags ? { tags: extra.tags } : {}) }, ...(extra.environments ? { environments: extra.environments } : {}) },
  });
  const tags = (id: string, value: Record<string, string>): Op => ({ type: 'element.update', id, patch: { finops: { tags: value } } });
  return [
    tags('home-banking', { 'cost-center': 'CC-1200', project: 'home-banking' }),
    set('aws-us-east-1', { dev: { monthly: 90 }, qa: { monthly: 90 }, pre: { monthly: 180 }, prod: { monthly: 640, sku: 'VPC + NAT + CloudWatch' } }, { tags: { 'cost-center': 'CC-0900', project: 'plataforma' } }),
    set('notificaciones', { dev: { monthly: 20 }, qa: { monthly: 20 }, prod: { monthly: 310, sku: 'SES + SNS' } }, {
      tags: { 'cost-center': 'CC-1450', project: 'notificaciones' },
      environments: ['dev', 'qa', 'prod'],
    }),
    set('web-app', { dev: { monthly: 40 }, qa: { monthly: 40 }, pre: { monthly: 80 }, prod: { monthly: 320, sku: 'S3 + CloudFront' } }),
    set('app-movil', { qa: { monthly: 20 }, prod: { monthly: 120, sku: 'Firebase' } }, { environments: ['qa', 'prod'] }),
    set('api-gateway', { dev: { monthly: 60 }, qa: { monthly: 60 }, pre: { monthly: 180, replicas: 2 }, prod: { monthly: 540, replicas: 3, sku: 'Kong Konnect' } }),
    set('cuentas-api', { dev: { monthly: 90 }, qa: { monthly: 90 }, pre: { monthly: 250, replicas: 2, sku: 'm6i.large' }, prod: { monthly: 980, replicas: 4, sku: 'm6i.large' } }),
    set('pagos-api', { dev: { monthly: 110 }, qa: { monthly: 110 }, pre: { monthly: 320, replicas: 2, sku: 'c6i.xlarge' }, prod: { monthly: 1450, replicas: 6, sku: 'c6i.xlarge' } }),
    set('banking-db', { dev: { monthly: 70 }, qa: { monthly: 70 }, pre: { monthly: 420, sku: 'db.r6g.large' }, prod: { monthly: 1800, replicas: 2, sku: 'db.r6g.xlarge' } }),
    set('cache', { qa: { monthly: 30 }, pre: { monthly: 90 }, prod: { monthly: 260, sku: 'cache.r6g.large' } }, { environments: ['qa', 'pre', 'prod'] }),
    set('eventos', { dev: { monthly: 120 }, qa: { monthly: 120 }, pre: { monthly: 400 }, prod: { monthly: 1250, replicas: 3, sku: 'MSK kafka.m5.large' } }),
  ];
}

/**
 * Despliegue de producción de Home Banking: la SPA detrás de un CDN, la API en un clúster dentro
 * de una subred privada, los datos administrados al lado y el core en el datacenter. Las
 * relaciones lógicas (API → base, API → core) no se repiten: el lienzo las proyecta sobre las
 * instancias.
 */
function deployment(): Op[] {
  const prod = ['prod'];
  const el = (element: Extract<Op, { type: 'element.add' }>['element']): Op => ({ type: 'element.add', element });
  const rel = (relation: Extract<Op, { type: 'relation.add' }>['relation']): Op => ({ type: 'relation.add', relation });
  const instance = (of: string, parent: string, replicas?: number): Op =>
    el({ id: `${of}-prod`, kind: 'instance', name: '', parent, environments: prod, instance: replicas ? { of, replicas } : { of } });
  const named = (op: Op, name: string): Op => (op.type === 'element.add' ? { ...op, element: { ...op.element, name } } : op);
  return [
    el({ id: 'celular', kind: 'node', name: 'Celular del cliente', node: { type: 'device' }, technology: ['flutter'], environments: prod }),
    el({ id: 'aws-prod', kind: 'node', name: 'AWS · cuenta de producción', node: { type: 'cloud', provider: 'aws', region: 'us-east-1', account: 'banca-prod' }, environments: prod }),
    el({ id: 'vpc-prod', kind: 'node', name: 'VPC producción', parent: 'aws-prod', node: { type: 'network', provider: 'aws' }, addresses: ['10.20.0.0/16'], environments: prod }),
    el({ id: 'subnet-publica-prod', kind: 'node', name: 'Subred pública', parent: 'vpc-prod', node: { type: 'subnet', provider: 'aws' }, addresses: ['10.20.0.0/24'], environments: prod }),
    el({ id: 'subnet-privada-prod', kind: 'node', name: 'Subred privada', parent: 'vpc-prod', node: { type: 'subnet', provider: 'aws' }, addresses: ['10.20.10.0/23'], environments: prod }),
    el({ id: 'eks-prod', kind: 'node', name: 'Clúster de la banca', parent: 'subnet-privada-prod', node: { type: 'cluster', provider: 'kubernetes', size: 'm6i.xlarge', instances: 3 }, technology: ['kubernetes'], environments: prod, risk: 'high' }),
    el({ id: 'dc-central', kind: 'node', name: 'Datacenter central', node: { type: 'datacenter', provider: 'onprem', region: 'Buenos Aires' } }),
    el({ id: 'cdn-prod', kind: 'infra', name: 'CDN', parent: 'aws-prod', infra: { type: 'cdn' }, technology: ['cloudfront'], addresses: ['banca.example.com'], environments: prod }),
    el({ id: 'alb-prod', kind: 'infra', name: 'Balanceador público', parent: 'subnet-publica-prod', infra: { type: 'load-balancer' }, technology: ['aws-alb'], addresses: ['api.banca.example.com:443'], environments: prod }),
    named(instance('app-movil', 'celular'), 'App móvil'),
    named(instance('web-app', 'aws-prod'), 'Web App'),
    named(instance('api-gateway', 'eks-prod', 3), 'API Gateway'),
    named(instance('cuentas-api', 'eks-prod', 4), 'Cuentas API'),
    named(instance('pagos-api', 'eks-prod', 6), 'Pagos API'),
    named(instance('banking-db', 'subnet-privada-prod', 2), 'Banking DB'),
    named(instance('cache', 'subnet-privada-prod'), 'Caché de sesiones'),
    named(instance('eventos', 'subnet-privada-prod', 3), 'Eventos de pagos'),
    el({ id: 'core-bancario-prod', kind: 'instance', name: 'Core bancario', parent: 'dc-central', instance: { of: 'core-bancario' } }),

    // El camino de red: lo que entra por internet pasa por el CDN y el balanceador.
    rel({ id: 'cliente--cdn-prod', from: 'cliente', to: 'cdn-prod', label: 'Navega', protocols: ['https'], ports: [443] }),
    rel({ id: 'cdn-prod--web-app-prod', from: 'cdn-prod', to: 'web-app-prod', label: 'Sirve la SPA', protocols: ['https'] }),
    rel({ id: 'cdn-prod--alb-prod', from: 'cdn-prod', to: 'alb-prod', label: 'Origen de la API', protocols: ['https'], ports: [443] }),
    rel({ id: 'alb-prod--api-gateway-prod', from: 'alb-prod', to: 'api-gateway-prod', label: 'Balancea', protocols: ['https'], ports: [8443] }),

    {
      type: 'view.add',
      view: {
        id: 'home-banking-despliegue-prod',
        name: 'Home Banking · Despliegue Producción',
        level: 'deployment',
        scope: 'home-banking',
        environment: 'prod',
        description: 'Dónde corre cada parte de Home Banking en producción.',
        nodes: {
          cliente: { x: -560, y: 120 },
          celular: { x: -600, y: 300, w: 300, h: 180 },
          'app-movil-prod': { x: -560, y: 380 },
          'aws-prod': { x: -200, y: 0, w: 1560, h: 740 },
          'cdn-prod': { x: -160, y: 240 },
          'web-app-prod': { x: -160, y: 440 },
          'vpc-prod': { x: 120, y: 80, w: 1200, h: 620 },
          'subnet-publica-prod': { x: 160, y: 170, w: 300, h: 490 },
          'alb-prod': { x: 200, y: 370 },
          'subnet-privada-prod': { x: 500, y: 170, w: 780, h: 490 },
          'eks-prod': { x: 540, y: 250, w: 300, h: 370 },
          'api-gateway-prod': { x: 580, y: 330 },
          'cuentas-api-prod': { x: 580, y: 416 },
          'pagos-api-prod': { x: 580, y: 502 },
          'banking-db-prod': { x: 1000, y: 330 },
          'cache-prod': { x: 1000, y: 416 },
          'eventos-prod': { x: 1000, y: 502 },
          'dc-central': { x: 1480, y: 220, w: 300, h: 200 },
          'core-bancario-prod': { x: 1520, y: 300 },
          'pasarela-pagos': { x: 1520, y: 520 },
        },
      },
    },
  ];
}

/** Un flujo de ejemplo (cruza L2 y L3 y tiene una bifurcación) y dos comentarios. */
function flowsAndComments(): Op[] {
  return [
    {
      type: 'flow.add',
      flow: {
        id: 'transferencia',
        name: 'Transferencia desde la app',
        description: 'Desde que el cliente confirma una transferencia en la app hasta que recibe la notificación.',
        view: 'home-banking-containers',
        steps: [
          { type: 'message', from: 'cliente', to: 'app-movil', title: 'Confirma la transferencia' },
          { type: 'message', from: 'app-movil', to: 'api-gateway', title: 'POST /transferencias', description: 'Body: `{ origen, destino, importe }`, con el token OIDC en el header.' },
          { type: 'message', from: 'api-gateway', to: 'pagos-api', title: 'Rutea al servicio de pagos' },
          { type: 'message', from: 'transfer-controller', to: 'fraude', title: 'Evalúa el riesgo', description: 'Scoring en línea: arriba de 0,8 se rechaza.' },
          {
            type: 'paths',
            mode: 'alternate',
            title: '¿Se aprueba?',
            paths: [
              {
                name: 'Aprobada',
                steps: [
                  { type: 'message', from: 'transfer-controller', to: 'core-client', title: 'Debita la cuenta origen' },
                  { type: 'message', from: 'core-client', to: 'core-bancario', title: 'Registra el movimiento' },
                  { type: 'message', from: 'pagos-api', to: 'eventos', title: 'Publica pagos.autorizados' },
                ],
              },
              { name: 'Rechazada por riesgo', steps: [{ type: 'message', from: 'pagos-api', to: 'eventos', title: 'Publica pagos.rechazados' }] },
            ],
          },
          { type: 'message', from: 'eventos', to: 'notificaciones', title: 'Consume el evento' },
          { type: 'note', title: 'Fin', description: 'El cliente recibe un push con el resultado.' },
        ],
      },
    },
    {
      type: 'comment.add',
      comment: {
        id: 'c-migrar-aurora',
        view: 'home-banking-containers',
        element: 'banking-db',
        x: 196,
        y: -14,
        icon: 'question',
        color: 'violet',
        body: '¿Migramos a Aurora Serverless? En producción ya pasa los USD 1.800 por mes.',
        author: 'Arquitectura',
        at: '2026-10-15T14:20:00.000Z',
        replies: [{ author: 'Equipo Canales', at: '2026-10-16T09:05:00.000Z', body: 'Lo evaluamos el próximo trimestre; primero hay que medir los IOPS.' }],
      },
    },
    {
      type: 'comment.add',
      comment: {
        id: 'c-pasarela',
        view: 'landscape',
        x: 650,
        y: 470,
        icon: 'warning',
        color: 'warn',
        title: 'Dependencia crítica',
        body: 'La pasarela de pagos no tiene contingencia: si cae, no se pueden cobrar tarjetas.',
        author: 'Arquitectura',
        at: '2026-10-16T11:00:00.000Z',
      },
    },
  ];
}
