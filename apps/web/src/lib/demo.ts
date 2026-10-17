import { applyOps, emptyModel, type Model, type Op } from '@aegon/core';

/** Workspace de ejemplo para el primer arranque: una banca digital con L1, L2 y L3. */
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
  ];
  return applyOps(emptyModel(id, 'Banca digital (demo)'), ops).model;
}
