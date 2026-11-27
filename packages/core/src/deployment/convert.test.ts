import { describe, expect, it } from 'vitest';
import { demoModel } from '../demo.ts';
import type { Model } from '../model/index.ts';
import { applyOp, type Op } from '../ops/index.ts';
import { createElementOp, createViewOp, duplicateOp, livesOnlyIn, sizeOf } from '../ops/commands.ts';
import { validateModel } from '../rules/index.ts';
import { FRAME_PADDING, growFramesOp, visualParentOf } from '../layout/index.ts';
import { instancesOf } from './index.ts';
import { convertToInstanceOp, convertToNodeOp, createDeployedOp, detailInstanceOp, directSystemsIn, nodeConversionProblem, undeployedPartsOf } from './convert.ts';

const PROD = 'home-banking-despliegue-prod';
const run = (model: Model, op: Op): Model => applyOp(model, op).model;
const errors = (model: Model) => validateModel(model).filter((d) => d.severity === 'error');

/** Un despliegue sin sistema (el de un equipo de infraestructura): un datacenter, una subred y dos "sistemas" puestos directo. */
function infraDeployment(): { model: Model; viewId: string } {
  let model = demoModel();
  const view = createViewOp(model, 'Despliegue Producción', 'deployment', undefined, 'prod');
  model = run(model, view.op);
  const add = (kind: 'node' | 'system' | 'infra', name: string, at: { x: number; y: number }, fields: Record<string, unknown> = {}) => {
    const { op, id } = createElementOp(model, { kind, name, view: view.id, at, fields });
    model = run(model, op);
    return id;
  };
  const dc = add('node', 'Datacenter principal', { x: 0, y: 0 }, { node: { type: 'datacenter' } });
  model = run(model, { type: 'view.place', view: view.id, nodes: { [dc]: { x: 0, y: 0, w: 900, h: 500 } } });
  const subnet = add('node', 'Red de servidores', { x: 40, y: 80 }, { node: { type: 'subnet' }, parent: dc, addresses: ['10.0.20.0/24'] });
  model = run(model, { type: 'view.place', view: view.id, nodes: { [subnet]: { x: 40, y: 80, w: 600, h: 360 } } });
  // Lo que la persona puso como sistema porque todavía no sabía que un servidor es un nodo.
  add('system', 'Controlador de dominio', { x: 80, y: 160 }, { description: 'Directorio, nombres y hora' });
  add('system', 'Servidor de archivos', { x: 340, y: 160 });
  add('infra', 'Firewall perimetral', { x: 700, y: 160 }, { infra: { type: 'firewall' }, parent: dc });
  model = run(model, { type: 'relation.add', relation: { id: 'servidor-de-archivos--controlador-de-dominio', from: 'servidor-de-archivos', to: 'controlador-de-dominio', label: 'Autentica', protocols: ['ldap'], ports: [389] } });
  model = run(model, { type: 'relation.add', relation: { id: 'firewall-perimetral--controlador-de-dominio', from: 'firewall-perimetral', to: 'controlador-de-dominio', label: 'Resuelve nombres', protocols: ['dns'], ports: [53] } });
  return { model, viewId: view.id };
}

describe('sistemas puestos directo en un despliegue', () => {
  it('se detectan los propios, no los externos', () => {
    const { model, viewId } = infraDeployment();
    expect(directSystemsIn(model, model.views[viewId]!).map((e) => e.id)).toEqual(['controlador-de-dominio', 'servidor-de-archivos']);
    // En la demo, la pasarela es un tercero: va directo y está bien.
    const demo = demoModel();
    expect(directSystemsIn(demo, demo.views[PROD]!)).toEqual([]);
  });

  it('convertir en nodo conserva ID, nombre, relaciones y lugar, y queda dentro de la subred', () => {
    const { model: base, viewId } = infraDeployment();
    const result = convertToNodeOp(base, viewId, ['controlador-de-dominio', 'servidor-de-archivos'])!;
    expect(result.skipped).toEqual([]);
    const model = run(base, result.op!);
    const dc = model.elements['controlador-de-dominio']!;
    expect(dc.kind).toBe('node');
    expect(dc.name).toBe('Controlador de dominio');
    expect(dc.description).toBe('Directorio, nombres y hora');
    expect(dc.parent).toBe('red-de-servidores');
    expect(dc.environments).toEqual(['prod']);
    expect(model.relations['servidor-de-archivos--controlador-de-dominio']?.ports).toEqual([389]);
    expect(model.relations['firewall-perimetral--controlador-de-dominio']?.protocols).toEqual(['dns']);
    const layout = model.views[viewId]!.nodes['controlador-de-dominio']!;
    expect({ x: layout.x, y: layout.y }).toEqual({ x: 80, y: 160 });
    expect(visualParentOf(model, model.views[viewId]!, dc)).toBe('red-de-servidores');
    expect(errors(model)).toEqual([]);
    // Ya acepta dirección de red.
    const withIp = run(model, { type: 'element.update', id: dc.id, patch: { addresses: ['10.0.20.15'] } });
    expect((withIp.elements[dc.id] as { addresses?: string[] }).addresses).toEqual(['10.0.20.15']);
  });

  it('convertir en nodo deja el mismo rectángulo y no toca nada más del lienzo', () => {
    const { model: base, viewId } = infraDeployment();
    const before = base.views[viewId]!.nodes;
    const result = convertToNodeOp(base, viewId, ['controlador-de-dominio'])!;
    const after = run(base, result.op!).views[viewId]!.nodes;
    // Sin tamaño propio un nodo sería un marco grande: queda con el que tenía el sistema.
    expect(after['controlador-de-dominio']).toEqual({ x: 80, y: 160, ...sizeOf(base.elements['controlador-de-dominio']!, before['controlador-de-dominio']) });
    for (const id of Object.keys(before)) if (id !== 'controlador-de-dominio') expect(after[id]).toEqual(before[id]);
  });

  it('un tamaño dado a mano se conserva al convertir, en nodo o en instancia', () => {
    const { model: start, viewId } = infraDeployment();
    const base = run(start, { type: 'view.place', view: viewId, nodes: { 'controlador-de-dominio': { x: 80, y: 160, w: 300, h: 96 } } });
    const node = run(base, convertToNodeOp(base, viewId, ['controlador-de-dominio'])!.op!);
    expect(node.views[viewId]!.nodes['controlador-de-dominio']).toEqual({ x: 80, y: 160, w: 300, h: 96 });
    const converted = convertToInstanceOp(base, viewId, ['controlador-de-dominio'])!;
    const instance = run(base, converted.op);
    expect(instance.views[viewId]!.nodes[converted.ids[0]!]).toEqual({ x: 80, y: 160, w: 300, h: 96 });
    // Lo demás del lienzo queda como estaba.
    for (const [id, layout] of Object.entries(base.views[viewId]!.nodes)) if (id !== 'controlador-de-dominio') expect(instance.views[viewId]!.nodes[id]).toEqual(layout);
  });

  it('se deshace en un paso y vuelve exactamente al modelo anterior', () => {
    const { model: base, viewId } = infraDeployment();
    const result = convertToNodeOp(base, viewId, ['controlador-de-dominio'])!;
    const applied = applyOp(base, result.op!);
    expect(applyOp(applied.model, applied.inverse).model).toEqual(base);
  });

  it('lo que ya es software no se convierte en nodo, y dice por qué', () => {
    const model = demoModel();
    expect(nodeConversionProblem(model, 'home-banking')).toMatch(/contenedores/);
    expect(nodeConversionProblem(model, 'core-bancario')).toMatch(/desplegado/);
    const result = convertToNodeOp(model, PROD, ['pasarela-pagos'])!;
    expect(result.op).toBeNull();
    expect(result.skipped[0]!.reason).toMatch(/Landscape|lienzo/);
  });

  it('convertir en instancia deja el sistema en el modelo y pasa las relaciones de red a la instancia', () => {
    const { model: base, viewId } = infraDeployment();
    const result = convertToInstanceOp(base, viewId, ['controlador-de-dominio'])!;
    const model = run(base, result.op);
    const inst = model.elements[result.ids[0]!]!;
    expect(inst.kind).toBe('instance');
    expect(inst.parent).toBe('red-de-servidores');
    expect(model.elements['controlador-de-dominio']!.kind).toBe('system');
    const view = model.views[viewId]!;
    expect(view.nodes['controlador-de-dominio']).toBeUndefined();
    expect(view.nodes[inst.id]).toEqual({ x: 80, y: 160 });
    // La del firewall es de red: ahora llega a la instancia. La otra es entre sistemas: queda lógica.
    expect(model.relations['firewall-perimetral--controlador-de-dominio']!.to).toBe(inst.id);
    expect(model.relations['servidor-de-archivos--controlador-de-dominio']!.to).toBe('controlador-de-dominio');
    expect(errors(model)).toEqual([]);
  });
});

describe('software que nace desplegado', () => {
  it('en un lienzo sin sistema crea el sistema y su instancia dentro del nodo', () => {
    const { model: base, viewId } = infraDeployment();
    const result = createDeployedOp(base, viewId, { what: 'service', name: 'Servicio de nombres', at: { x: 300, y: 320 }, fields: { technology: ['dns-server'] } })!;
    const model = run(base, result.op);
    expect(model.elements[result.of]!.kind).toBe('system');
    const inst = model.elements[result.id]!;
    expect(inst).toMatchObject({ kind: 'instance', name: 'Servicio de nombres', parent: 'red-de-servidores', environments: ['prod'] });
    expect(instancesOf(model, result.of, 'prod').map((e) => e.id)).toEqual([result.id]);
    expect(errors(model)).toEqual([]);
  });

  it('en el lienzo de un sistema crea un contenedor suyo, y una base va como base', () => {
    const base = demoModel();
    const service = createDeployedOp(base, PROD, { what: 'service', name: 'Motor de reportes', at: { x: 700, y: 600 } })!;
    let model = run(base, service.op);
    expect(model.elements[service.of]).toMatchObject({ kind: 'container', parent: 'home-banking' });
    expect(model.elements[service.id]!.parent).toBe('eks-prod');
    const store = createDeployedOp(model, PROD, { what: 'store', name: 'Reportes DB', at: { x: 1100, y: 600 } })!;
    model = run(model, store.op);
    expect(model.elements[store.of]).toMatchObject({ kind: 'store', parent: 'home-banking' });
    expect(errors(model)).toEqual([]);
  });
});

describe('detallar un sistema en sus contenedores', () => {
  it('reemplaza la instancia del sistema por una de cada parte sin desplegar', () => {
    let model = demoModel();
    const view = createViewOp(model, 'Home Banking · Despliegue QA', 'deployment', undefined, 'qa');
    model = run(model, view.op);
    const host = createElementOp(model, { kind: 'node', name: 'Servidor QA', view: view.id, at: { x: 0, y: 0 }, fields: { node: { type: 'server' } } });
    model = run(model, host.op);
    model = run(model, { type: 'view.place', view: view.id, nodes: { [host.id]: { x: 0, y: 0, w: 900, h: 500 } } });
    const direct = convertToInstanceOp(run(model, { type: 'view.place', view: view.id, nodes: { 'home-banking': { x: 60, y: 100 } } }), view.id, ['home-banking']);
    expect(direct).not.toBeNull();
    model = run(run(model, { type: 'view.place', view: view.id, nodes: { 'home-banking': { x: 60, y: 100 } } }), direct!.op);
    const instance = direct!.ids[0]!;
    const parts = undeployedPartsOf(model, 'home-banking', 'qa').map((e) => e.id);
    expect(parts).toContain('pagos-api');
    const result = detailInstanceOp(model, view.id, instance)!;
    model = run(model, result.op);
    expect(model.elements[instance]).toBeUndefined();
    expect(result.ids).toHaveLength(parts.length);
    for (const id of result.ids) {
      expect(model.elements[id]).toMatchObject({ kind: 'instance', parent: host.id, environments: ['qa'] });
      expect(model.views[view.id]!.nodes[id]).toBeDefined();
    }
    expect(undeployedPartsOf(model, 'home-banking', 'qa')).toEqual([]);
    expect(detailInstanceOp(model, view.id, result.ids[0]!)).toBeNull();
    expect(errors(model)).toEqual([]);
  });
});

describe('marcos que crecen para contener lo nuevo', () => {
  it('agranda el nodo y los que lo contienen, hacia abajo y a la derecha, sin tocar lo demás', () => {
    const { model: base, viewId } = infraDeployment();
    const added = createElementOp(base, { kind: 'node', name: 'Servidor de aplicaciones', view: viewId, at: { x: 500, y: 380 }, fields: { node: { type: 'vm' }, parent: 'red-de-servidores' } });
    let model = run(base, added.op);
    model = run(model, { type: 'view.place', view: viewId, nodes: { [added.id]: { x: 500, y: 380, w: 300, h: 180 } } });
    const grow = growFramesOp(model, viewId, [added.id])!;
    model = run(model, grow);
    const view = model.views[viewId]!;
    const subnet = { ...view.nodes['red-de-servidores']!, ...sizeOf(model.elements['red-de-servidores']!, view.nodes['red-de-servidores']) };
    const dc = { ...view.nodes['datacenter-principal']!, ...sizeOf(model.elements['datacenter-principal']!, view.nodes['datacenter-principal']) };
    expect({ x: subnet.x, y: subnet.y }).toEqual({ x: 40, y: 80 });
    expect(subnet.x + subnet.w).toBe(500 + 300 + FRAME_PADDING.side);
    expect(subnet.y + subnet.h).toBe(380 + 180 + FRAME_PADDING.bottom);
    expect(dc.x + dc.w).toBeGreaterThanOrEqual(subnet.x + subnet.w + FRAME_PADDING.side);
    expect(dc.y + dc.h).toBeGreaterThanOrEqual(subnet.y + subnet.h + FRAME_PADDING.bottom);
    // Ya los contiene: no hay nada más que hacer.
    expect(growFramesOp(model, viewId, [added.id])).toBeNull();
  });
});

describe('duplicar y borrar en un lienzo', () => {
  it('duplicar un nodo copia lo que tiene adentro, dentro de la copia y al costado', () => {
    const base = demoModel();
    const { op, ids } = duplicateOp(base, PROD, ['eks-prod']);
    const model = run(base, op);
    const copyId = ids.find((id) => model.elements[id]!.kind === 'node')!;
    const copy = model.elements[copyId]!;
    expect(copy.name).toBe(`${base.elements['eks-prod']!.name} (copia)`);
    expect(copy.parent).toBe(base.elements['eks-prod']!.parent);
    const inside = ids.filter((id) => model.elements[id]!.parent === copyId);
    expect(inside).toHaveLength(3);
    const view = model.views[PROD]!;
    const original = view.nodes['eks-prod']!;
    expect(view.nodes[copyId]!.x).toBeGreaterThanOrEqual(original.x + original.w!);
    expect(view.nodes[copyId]!.y).toBe(original.y);
    for (const id of inside) expect(view.nodes[id]!.x).toBeGreaterThan(view.nodes[copyId]!.x);
    expect(errors(model)).toEqual([]);
  });

  it('lo que vive solo en un lienzo se puede borrar del modelo; lo compartido, no', () => {
    const model = demoModel();
    // El balanceador solo existe en el despliegue de producción.
    expect(livesOnlyIn(model, PROD, 'alb-prod')).toBe(true);
    // El cliente está también en el Landscape; un sistema desplegado tiene instancias.
    expect(livesOnlyIn(model, PROD, 'cliente')).toBe(false);
    expect(livesOnlyIn(model, 'landscape', 'core-bancario')).toBe(false);
  });
});
