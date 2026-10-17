import { applyOps, type Op } from './ops/index.ts';
import { emptyModel, type Model } from './model/index.ts';

/** Workspace chico y completo para tests: L1 + L2 + L3, grupos y relaciones cruzadas. */
export function sampleModel(): Model {
  const ops: Op[] = [
    { type: 'element.add', element: { id: 'aws', kind: 'group', name: 'AWS us-east-1', group: { provider: 'aws', region: 'us-east-1' } } },
    { type: 'element.add', element: { id: 'customer', kind: 'actor', name: 'Cliente', scope: 'external' } },
    { type: 'element.add', element: { id: 'banking', kind: 'system', name: 'Home Banking', groups: ['aws'] } },
    { type: 'element.add', element: { id: 'core', kind: 'system', name: 'Core bancario', scope: 'external' } },
    { type: 'element.add', element: { id: 'web', kind: 'container', name: 'Web', parent: 'banking', technology: ['react'] } },
    { type: 'element.add', element: { id: 'api', kind: 'container', name: 'API', parent: 'banking', technology: ['java'], risk: 'high' } },
    { type: 'element.add', element: { id: 'db', kind: 'store', name: 'Banking DB', parent: 'banking', store: { engine: 'postgresql', type: 'relational' } } },
    { type: 'element.add', element: { id: 'accounts', kind: 'component', name: 'Accounts', parent: 'api' } },
    { type: 'element.add', element: { id: 'core-gw', kind: 'container', name: 'Core Gateway', parent: 'core' } },
    { type: 'relation.add', relation: { id: 'customer--web', from: 'customer', to: 'web', label: 'Usa' } },
    { type: 'relation.add', relation: { id: 'web--api', from: 'web', to: 'api', label: 'Llama', protocols: ['https'] } },
    { type: 'relation.add', relation: { id: 'accounts--db', from: 'accounts', to: 'db', label: 'Lee/escribe' } },
    { type: 'relation.add', relation: { id: 'api--core-gw', from: 'api', to: 'core-gw', label: 'Consulta saldos' } },
    {
      type: 'view.add',
      view: { id: 'landscape', name: 'Landscape', level: 1, nodes: { customer: { x: 0, y: -200 }, banking: { x: 0, y: 0 }, core: { x: 400, y: 0 }, aws: { x: -40, y: -40, w: 320, h: 200 } } },
    },
    {
      type: 'view.add',
      view: { id: 'banking-containers', name: 'Home Banking · Contenedores', level: 2, scope: 'banking', nodes: { web: { x: 0, y: 0 }, api: { x: 320, y: 0 }, db: { x: 320, y: 220 }, core: { x: 640, y: 0 } }, edges: { 'web--api': { shape: 'straight' } } },
    },
    { type: 'workspace.update', patch: { defaultView: 'landscape' } },
  ];
  return applyOps(emptyModel('demo', 'Demo'), ops).model;
}
