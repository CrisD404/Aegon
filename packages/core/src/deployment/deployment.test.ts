import { describe, expect, it } from 'vitest';
import { applyOp } from '../ops/index.ts';
import { allViewEdges, createViewOp, newInstance } from '../ops/commands.ts';
import { emptyModel, type Model } from '../model/index.ts';
import type { Element, Relation } from '../schema/index.ts';
import { placementProblem, validateModel } from '../rules/index.ts';
import { analyzeModel } from '../analysis/index.ts';
import { arrangeViewOp, freePositions } from '../layout/index.ts';
import { toMermaid, toPlantUml, toStructurizr } from '../export/index.ts';
import { relationTechnology } from '../catalog/index.ts';
import { instancesOf, projectedEdges } from './index.ts';

/** Mini Home Banking: dos contenedores y una base, desplegados en QA detrás de un ingress y un egress. */
function deploymentModel(): Model {
  const els: Element[] = [
    { id: 'usuario', kind: 'actor', name: 'Usuario' },
    { id: 'idp', kind: 'system', name: 'Entra ID', scope: 'external' },
    { id: 'home-banking', kind: 'system', name: 'Home Banking' },
    { id: 'web', kind: 'container', name: 'Web', parent: 'home-banking', containerType: 'web', technology: ['react'] },
    { id: 'api', kind: 'container', name: 'API', parent: 'home-banking', containerType: 'api' },
    { id: 'db', kind: 'store', name: 'DB', parent: 'home-banking', store: { engine: 'sqlserver' } },
    { id: 'dc', kind: 'node', name: 'Datacenter', node: { type: 'datacenter', provider: 'onprem' } },
    { id: 'ocp', kind: 'node', name: 'OCP', parent: 'dc', node: { type: 'cluster' }, technology: ['openshift'] },
    { id: 'ns', kind: 'node', name: 'BANCA', parent: 'ocp', node: { type: 'namespace' }, environments: ['qa'], addresses: ['10.128.4.34'] },
    { id: 'ingress', kind: 'infra', name: 'Ingress QA', parent: 'ocp', infra: { type: 'ingress' }, environments: ['qa'], addresses: ['banca-qa.apps.example:8080'] },
    { id: 'egress', kind: 'infra', name: 'Egress QA', parent: 'ocp', infra: { type: 'egress' }, environments: ['qa'] },
    { id: 'sql', kind: 'node', name: 'SQL', parent: 'dc', node: { type: 'server' }, addresses: ['192.168.50.32'] },
    { id: 'web-qa', kind: 'instance', name: 'Web', parent: 'ns', instance: { of: 'web' }, environments: ['qa'] },
    { id: 'api-qa', kind: 'instance', name: 'API', parent: 'ns', instance: { of: 'api', replicas: 2 }, environments: ['qa'] },
    { id: 'db-qa', kind: 'instance', name: 'BANCAQA', parent: 'sql', instance: { of: 'db' }, environments: ['qa'] },
  ];
  const rels: Relation[] = [
    { id: 'usuario--web', from: 'usuario', to: 'web', label: 'Usa', protocols: ['https'], ports: [8080] },
    { id: 'web--api', from: 'web', to: 'api', label: 'Consume', protocols: ['http'] },
    { id: 'api--db', from: 'api', to: 'db', label: 'Lee y escribe', protocols: ['tds'], ports: [1433] },
    { id: 'web--idp', from: 'web', to: 'idp', label: 'Autentica', protocols: ['oidc'] },
    // Camino de red explícito.
    { id: 'usuario--ingress', from: 'usuario', to: 'ingress', protocols: ['https'], ports: [8080] },
    { id: 'ingress--web-qa', from: 'ingress', to: 'web-qa', protocols: ['https'] },
    { id: 'api-qa--egress', from: 'api-qa', to: 'egress', ports: [443, 80] },
    { id: 'egress--db-qa', from: 'egress', to: 'db-qa' },
  ];
  const model: Model = {
    ...emptyModel('demo', 'Demo'),
    workspace: { ...emptyModel('demo', 'Demo').workspace, environments: [{ id: 'qa', name: 'QA' }, { id: 'prod', name: 'Producción' }] },
    elements: Object.fromEntries(els.map((e) => [e.id, e])),
    relations: Object.fromEntries(rels.map((r) => [r.id, r])),
  };
  const nodes = {
    usuario: { x: 0, y: -200 },
    idp: { x: 600, y: -200 },
    dc: { x: -40, y: -64, w: 900, h: 700 },
    ocp: { x: 0, y: 0, w: 600, h: 500 },
    ns: { x: 40, y: 160, w: 300, h: 300 },
    ingress: { x: 40, y: 64 },
    egress: { x: 380, y: 300 },
    sql: { x: 640, y: 0, w: 220, h: 200 },
    'web-qa': { x: 80, y: 224 },
    'api-qa': { x: 80, y: 360 },
    'db-qa': { x: 660, y: 64 },
  };
  return { ...model, views: { 'despliegue-qa': { id: 'despliegue-qa', name: 'Despliegue QA', level: 'deployment', environment: 'qa', scope: 'home-banking', nodes } } };
}

describe('despliegue', () => {
  it('proyecta las relaciones lógicas sobre las instancias, salvo que haya un camino de red explícito', () => {
    const model = deploymentModel();
    const view = model.views['despliegue-qa']!;
    const edges = allViewEdges(model, view);
    const projected = edges.filter((e) => e.projected).map((e) => `${e.from}>${e.to}:${e.relations.map((r) => r.id).join(',')}`);
    // usuario → web (camino por el ingress) y api → db (por el egress) no se repiten.
    expect(projected).toEqual(['web-qa>api-qa:web--api', 'web-qa>idp:web--idp']);
    expect(edges.filter((e) => !e.projected).map((e) => `${e.from}>${e.to}`).sort()).toEqual(
      ['api-qa>egress', 'egress>db-qa', 'ingress>web-qa', 'usuario>ingress'].sort(),
    );
  });

  it('un nodo colapsado representa a sus instancias', () => {
    const model = deploymentModel();
    const view = model.views['despliegue-qa']!;
    const nodes = { ...view.nodes };
    delete nodes['web-qa'];
    delete nodes['api-qa'];
    const collapsed = { ...view, nodes };
    const edges = projectedEdges(model, collapsed, allViewEdges(model, collapsed).filter((e) => !e.projected));
    expect(edges.map((e) => `${e.from}>${e.to}`)).toEqual(['ns>idp']);
  });

  it('valida instancias, ambientes y lienzos de despliegue', () => {
    let model = deploymentModel();
    expect(validateModel(model).filter((d) => d.severity !== 'info')).toEqual([]);
    model = applyOp(model, { type: 'element.add', element: { id: 'huerfana', kind: 'instance', name: 'Huérfana', instance: { of: 'web-qa' } } }).model;
    model = applyOp(model, { type: 'element.update', id: 'db-qa', patch: { environments: ['qa', 'prod'] } }).model;
    model = applyOp(model, { type: 'element.update', id: 'ns', patch: { environments: ['qa'] } }).model;
    model = applyOp(model, { type: 'element.update', id: 'web-qa', patch: { environments: ['prod'] } }).model;
    const codes = validateModel(model).map((d) => `${d.code}:${d.entity?.id}`);
    expect(codes).toContain('orphan-instance:huerfana');
    expect(codes).toContain('invalid-instance-target:huerfana');
    expect(codes).toContain('environment-mismatch:web-qa');
    expect(codes).toContain('invalid-placement:despliegue-qa');
    const noEnv = applyOp(model, { type: 'view.add', view: { id: 'd2', name: 'Sin ambiente', level: 'deployment', nodes: {} } }).model;
    expect(validateModel(noEnv).some((d) => d.code === 'missing-environment')).toBe(true);
  });

  it('solo ubica en el lienzo lo que vale para su ambiente', () => {
    const model = deploymentModel();
    const view = model.views['despliegue-qa']!;
    const prodOnly = { ...model.elements['web-qa']!, environments: ['prod'] } as Element;
    expect(placementProblem(model, view, prodOnly)).toMatch(/no está desplegado/);
    expect(placementProblem(model, view, model.elements.web!)).toMatch(/no se puede ubicar/);
  });

  it('analyze: tráfico sin cifrar y contenedores sin instancia en el ambiente', () => {
    const model = deploymentModel();
    const out = analyzeModel(model);
    expect(out.violations.filter((d) => d.code === 'plaintext').map((d) => d.entity?.id).sort()).toEqual(['api-qa--egress', 'web--api']);
    expect(out.violations.some((d) => d.code === 'not-deployed')).toBe(false);
    const withWorker = applyOp(model, { type: 'element.add', element: { id: 'worker', kind: 'container', name: 'Worker', parent: 'home-banking' } }).model;
    expect(analyzeModel(withWorker).violations.filter((d) => d.code === 'not-deployed').map((d) => d.entity?.id)).toEqual(['worker']);
    // Los nodos no son huérfanos; las instancias heredan las relaciones de lo que despliegan.
    expect(out.orphans.map((o) => o.id)).toEqual([]);
  });

  it('newInstance y createViewOp de despliegue', () => {
    const model = deploymentModel();
    const inst = newInstance(model, 'web', { parent: 'ns', environment: 'qa' });
    expect(inst).toMatchObject({ id: 'web-qa-2', kind: 'instance', name: 'Web', parent: 'ns', environments: ['qa'], instance: { of: 'web' } });
    expect(instancesOf(model, 'api', 'qa').map((e) => e.id)).toEqual(['api-qa']);
    const { op } = createViewOp(model, 'Despliegue Prod', 'deployment', 'home-banking', 'prod');
    expect(op).toMatchObject({ type: 'view.add', view: { level: 'deployment', environment: 'prod', scope: 'home-banking' } });
  });

  it('puertos en la tecnología de la relación', () => {
    expect(relationTechnology({ protocols: ['https'], ports: [443, 80] })).toBe('HTTPS :443, :80');
    expect(relationTechnology({ ports: [1433] })).toBe(':1433');
    expect(relationTechnology({})).toBe('');
  });

  it('layout jerárquico: los marcos envuelven a sus hijos sin pisarse', () => {
    const model = deploymentModel();
    const op = arrangeViewOp(model, 'despliegue-qa')!;
    const nodes = applyOp(model, op).model.views['despliegue-qa']!.nodes;
    const inside = (child: string, parent: string) => {
      const c = nodes[child]!;
      const p = nodes[parent]!;
      return c.x >= p.x && c.y >= p.y && c.x + (c.w ?? 220) <= p.x + p.w! && c.y + (c.h ?? 72) <= p.y + p.h!;
    };
    for (const [child, parent] of [['ocp', 'dc'], ['ns', 'ocp'], ['web-qa', 'ns'], ['api-qa', 'ns'], ['ingress', 'ocp'], ['db-qa', 'sql'], ['sql', 'dc']]) {
      expect(inside(child!, parent!), `${child} dentro de ${parent}`).toBe(true);
    }
    // El actor queda arriba del datacenter.
    expect(nodes.usuario!.y + 72).toBeLessThanOrEqual(nodes.dc!.y);
  });

  it('freePositions ubica dentro del nodo padre y lo agranda', () => {
    const model = applyOp(deploymentModel(), { type: 'element.add', element: { id: 'worker-qa', kind: 'instance', name: 'Worker', parent: 'ns', instance: { of: 'api' } } }).model;
    const pos = freePositions(model, 'despliegue-qa', ['worker-qa']);
    const ns = model.views['despliegue-qa']!.nodes.ns!;
    expect(pos['worker-qa']!.x).toBe(ns.x + 40);
    expect(pos['worker-qa']!.y).toBeGreaterThan(model.views['despliegue-qa']!.nodes['api-qa']!.y);
    expect(pos.ns!.h).toBeGreaterThan(ns.h!);
  });

  it('exporta el despliegue a Structurizr, PlantUML y Mermaid', () => {
    const model = deploymentModel();
    const dsl = toStructurizr(model);
    expect(dsl).toContain('deploymentEnvironment "QA" {');
    expect(dsl).toMatch(/= deploymentNode "BANCA" "10\.128\.4\.34" "Namespace \/ proyecto|= deploymentNode "BANCA" "10\.128\.4\.34" "namespace"/);
    expect(dsl).toContain('= containerInstance');
    expect(dsl).toContain('= infrastructureNode "Ingress QA"');
    expect(dsl).toMatch(/deployment \w+ "QA" "despliegue-qa"/);
    const puml = toPlantUml(model, 'despliegue-qa');
    expect(puml).toContain('!include <C4/C4_Deployment>');
    expect(puml).toContain('Deployment_Node(');
    expect(puml).toContain('Node(');
    const mmd = toMermaid(model, 'despliegue-qa');
    expect(mmd).toContain('subgraph');
    expect(mmd).toContain('HTTPS :8080');
  });
});
