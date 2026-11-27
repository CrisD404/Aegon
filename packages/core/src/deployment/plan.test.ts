import { describe, expect, it } from 'vitest';
import { analyzeModel } from '../analysis/index.ts';
import { demoModel } from '../demo.ts';
import type { Model } from '../model/index.ts';
import { applyOp, type Op } from '../ops/index.ts';
import { createViewOp } from '../ops/commands.ts';
import { validateModel } from '../rules/index.ts';
import { visualParentOf } from '../layout/index.ts';
import { isProductionEnvironment } from './index.ts';
import { copyDeploymentOp, deployAllOp, deploymentMatrix, deploymentViewsByEnvironment, undeployedInView } from './plan.ts';

const PROD = 'home-banking-despliegue-prod';
const run = (model: Model, op: Op): Model => applyOp(model, op).model;

/** La demo más un lienzo de despliegue vacío de Home Banking en ese ambiente. */
function withEmptyDeployment(env: string): { model: Model; viewId: string } {
  const base = demoModel();
  const { op, id } = createViewOp(base, `Home Banking · Despliegue ${env}`, 'deployment', 'home-banking', env);
  return { model: run(base, op), viewId: id };
}

describe('qué falta desplegar', () => {
  it('en la demo, producción está completa', () => {
    const model = demoModel();
    expect(undeployedInView(model, model.views[PROD]!)).toEqual([]);
    expect([...deploymentViewsByEnvironment(model, 'home-banking').keys()]).toEqual(['prod']);
  });

  it('un despliegue vacío lista lo que vale para ese ambiente', () => {
    const { model, viewId } = withEmptyDeployment('pre');
    const missing = undeployedInView(model, model.views[viewId]!).map((e) => e.id).sort();
    // La app móvil solo existe en QA y producción: en preproducción no falta.
    expect(missing).toEqual(['api-gateway', 'banking-db', 'cache', 'cuentas-api', 'eventos', 'pagos-api', 'web-app']);
  });
});

describe('desplegar todo', () => {
  it('crea un nodo con una instancia de cada cosa, adentro y sin avisos', () => {
    const { model: base, viewId } = withEmptyDeployment('pre');
    const result = deployAllOp(base, viewId)!;
    const model = run(base, result.op);
    const view = model.views[viewId]!;
    expect(result.ids).toHaveLength(7);
    expect(model.elements[result.node]).toMatchObject({ kind: 'node', name: 'Ambiente Preproducción', environments: ['pre'] });
    const frame = view.nodes[result.node]!;
    for (const id of result.ids) {
      const el = model.elements[id]!;
      expect(el).toMatchObject({ kind: 'instance', parent: result.node, environments: ['pre'] });
      expect(visualParentOf(model, view, el)).toBe(result.node);
      const l = view.nodes[id]!;
      expect(l.x >= frame.x + 40 && l.y >= frame.y + 64 && l.x + 220 <= frame.x + frame.w! - 40 && l.y + 72 <= frame.y + frame.h! - 40).toBe(true);
    }
    // No se pisan entre sí.
    const spots = new Set(result.ids.map((id) => `${view.nodes[id]!.x},${view.nodes[id]!.y}`));
    expect(spots.size).toBe(7);
    expect(undeployedInView(model, view)).toEqual([]);
    expect(validateModel(model).filter((d) => d.severity !== 'info')).toEqual([]);
    expect(deployAllOp(model, viewId)).toBeNull();
  });

  it('dentro de un nodo elegido, lo agranda y también a los que lo contienen', () => {
    const base = demoModel();
    // Un contenedor nuevo de Home Banking todavía no está en producción.
    const model0 = run(base, { type: 'element.add', element: { id: 'conciliador', kind: 'container', name: 'Conciliador', parent: 'home-banking' } });
    const view0 = model0.views[PROD]!;
    expect(undeployedInView(model0, view0).map((e) => e.id)).toEqual(['conciliador']);
    const result = deployAllOp(model0, PROD, 'eks-prod')!;
    const model = run(model0, result.op);
    const view = model.views[PROD]!;
    expect(result.node).toBe('eks-prod');
    expect(model.elements['conciliador-prod']).toMatchObject({ parent: 'eks-prod', environments: ['prod'] });
    // Queda debajo de lo que el clúster ya tenía, y cada marco sigue envolviendo al de adentro.
    expect(view.nodes['conciliador-prod']!.y).toBeGreaterThan(view0.nodes['pagos-api-prod']!.y + 72);
    const inside = (inner: string, outer: string) => {
      const a = view.nodes[inner]!;
      const b = view.nodes[outer]!;
      return a.x >= b.x && a.y >= b.y && a.x + (a.w ?? 220) <= b.x + b.w! && a.y + (a.h ?? 72) <= b.y + b.h!;
    };
    expect(inside('conciliador-prod', 'eks-prod')).toBe(true);
    expect(inside('eks-prod', 'subnet-privada-prod')).toBe(true);
    expect(inside('subnet-privada-prod', 'vpc-prod')).toBe(true);
    expect(inside('vpc-prod', 'aws-prod')).toBe(true);
  });
});

describe('copiar el despliegue a otro ambiente', () => {
  it('duplica lo propio del ambiente y comparte lo demás', () => {
    const base = demoModel();
    const result = copyDeploymentOp(base, PROD, 'qa')!;
    const model = run(base, result.op);
    const view = model.views[result.viewId]!;
    expect(result.viewId).toBe('home-banking-despliegue-qa');
    expect(view).toMatchObject({ level: 'deployment', environment: 'qa', scope: 'home-banking', name: 'Home Banking · Despliegue QA' });
    // Misma disposición, con los IDs del ambiente nuevo.
    expect(view.nodes['vpc-qa']).toEqual(base.views[PROD]!.nodes['vpc-prod']);
    expect(view.nodes['pagos-api-qa']).toEqual(base.views[PROD]!.nodes['pagos-api-prod']);
    expect(model.elements['vpc-qa']).toMatchObject({ kind: 'node', name: 'VPC QA', parent: 'aws-qa', environments: ['qa'] });
    expect(model.elements['pagos-api-qa']).toMatchObject({ kind: 'instance', parent: 'eks-qa', instance: { of: 'pagos-api' } });
    // Direcciones y cuenta son de cada ambiente: no se copian.
    expect('addresses' in model.elements['vpc-qa']!).toBe(false);
    expect((model.elements['aws-qa'] as { node: { account?: string } }).node.account).toBeUndefined();
    // Lo que vale para todos los ambientes se reutiliza (el datacenter y el core), igual que el actor.
    expect(view.nodes['dc-central']).toBeDefined();
    expect(view.nodes['core-bancario-prod']).toBeDefined();
    expect(view.nodes.cliente).toBeDefined();
    expect(model.elements['dc-central-qa']).toBeUndefined();
    // Los tramos de red llegan a lo copiado.
    expect(model.relations['cliente--cdn-qa']).toMatchObject({ from: 'cliente', to: 'cdn-qa', protocols: ['https'] });
    expect(model.relations['alb-qa--api-gateway-qa']).toBeDefined();
    expect(validateModel(model).filter((d) => d.severity !== 'info')).toEqual([]);
    expect(undeployedInView(model, view)).toEqual([]);
    // No se copia dos veces.
    expect(copyDeploymentOp(model, PROD, 'qa')).toBeNull();
    // Se deshace entero.
    const applied = applyOp(base, result.op);
    expect(applyOp(applied.model, applied.inverse).model.views).toEqual(base.views);
  });

  it('respeta dónde existe cada cosa y toma las réplicas de los costos del ambiente', () => {
    const base = demoModel();
    const model = run(base, copyDeploymentOp(base, PROD, 'pre')!.op);
    // La app móvil no existe en preproducción: ni la instancia ni el celular que la alojaba.
    expect(model.elements['app-movil-pre']).toBeUndefined();
    expect(model.elements['celular-pre']).toBeUndefined();
    expect(model.views['home-banking-despliegue-pre']!.nodes['celular-pre']).toBeUndefined();
    // La subred pública (que solo tiene el balanceador) y la privada sí pasan.
    expect(model.elements['subnet-publica-pre']).toBeDefined();
    expect(validateModel(model).filter((d) => d.severity !== 'info')).toEqual([]);
    expect(model.elements['api-gateway-pre']).toMatchObject({ instance: { of: 'api-gateway', replicas: 2 } });
    expect((model.elements['banking-db-pre'] as { instance: { replicas?: number } }).instance.replicas).toBeUndefined();
  });
});

describe('réplica única', () => {
  it('avisa solo en producción y solo para lo propio de riesgo alto', () => {
    const base = demoModel();
    expect(isProductionEnvironment(base, 'prod')).toBe(true);
    expect(isProductionEnvironment(base, 'pre')).toBe(false);
    expect(analyzeModel(base).violations.filter((d) => d.code === 'single-replica')).toEqual([]);

    // La base pasa a ser de riesgo alto y queda con una sola réplica en producción.
    const risky = run(
      run(base, { type: 'element.update', id: 'banking-db', patch: { risk: 'high' } }),
      { type: 'element.update', id: 'banking-db-prod', patch: { instance: { of: 'banking-db' } } },
    );
    const found = analyzeModel(risky).violations.filter((d) => d.code === 'single-replica');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'warning', entity: { type: 'element', id: 'banking-db-prod' } });
    expect(found[0]!.message).toContain('Producción');

    // La misma base en QA con una réplica es lo normal: no avisa.
    const withQa = run(risky, copyDeploymentOp(risky, PROD, 'qa')!.op);
    expect(analyzeModel(withQa).violations.filter((d) => d.code === 'single-replica')).toHaveLength(1);
  });
});

describe('comparar ambientes', () => {
  it('dice cuántas réplicas hay en cada ambiente, qué falta y qué no existe ahí', () => {
    const base = demoModel();
    const model = run(base, copyDeploymentOp(base, PROD, 'pre')!.op);
    const matrix = deploymentMatrix(model, 'home-banking');
    expect(matrix.environments.map((e) => e.id)).toEqual(['pre', 'prod']);
    const row = (id: string) => matrix.rows.find((r) => r.element.id === id)!.cells;
    expect(row('pagos-api').prod).toEqual({ state: 'deployed', replicas: 6, nodes: ['Clúster de la banca'] });
    expect(row('pagos-api').pre).toMatchObject({ state: 'deployed', replicas: 2 });
    // La app móvil no existe en preproducción: no es un faltante.
    expect(row('app-movil')).toMatchObject({ pre: { state: 'absent' }, prod: { state: 'deployed', replicas: 1 } });
    // Un contenedor nuevo falta en los dos.
    const more = run(model, { type: 'element.add', element: { id: 'conciliador', kind: 'container', name: 'Conciliador', parent: 'home-banking' } });
    expect(deploymentMatrix(more, 'home-banking').rows.find((r) => r.element.id === 'conciliador')!.cells).toEqual({ pre: { state: 'missing' }, prod: { state: 'missing' } });
  });
});
