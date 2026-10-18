import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { FIXTURES, cleanupTemps, modelOnDisk, tempCopy, tempWorkspace } from '@aegon/cli/testing';
import { demoModel } from '@aegon/core';
import { sampleModel } from '../../core/src/test-fixtures.ts';
import { createAegonServer } from './server.ts';

afterAll(cleanupTemps);

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

interface Called {
  isError: boolean;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

async function connect(root: string) {
  const { server } = createAegonServer({ root });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Called> => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[]).map((c) => c.text).join('');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { isError: !!result.isError, text, json };
  };
  return { client, call, close: () => client.close() };
}

let dir: string;
let mcp: Awaited<ReturnType<typeof connect>>;

beforeEach(async () => {
  dir = tempWorkspace(sampleModel());
  mcp = await connect(dir);
});
afterEach(() => mcp.close());

describe('servidor MCP', () => {
  it('expone las herramientas con sus esquemas', async () => {
    const { tools } = await mcp.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'add_element', 'analyze', 'connect', 'create_child_view', 'create_view', 'export', 'get_element', 'get_relation',
        'get_view', 'get_workspace', 'layout_view', 'list_elements', 'list_relations', 'list_views', 'place',
        'remove_element', 'remove_relation', 'remove_view', 'search_catalog', 'set_edge_style', 'unplace', 'update_element',
        'update_relation', 'update_view', 'update_workspace', 'validate',
        'list_flows', 'get_flow', 'create_flow', 'add_flow_step', 'update_flow', 'delete_flow',
        'list_comments', 'add_comment', 'reply_comment', 'resolve_comment', 'delete_comment',
      ].sort(),
    );
    const add = tools.find((t) => t.name === 'add_element')!;
    expect(add.inputSchema.required).toEqual(['kind', 'name']);
    expect(tools.find((t) => t.name === 'get_view')!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'remove_element')!.annotations?.destructiveHint).toBe(true);
    expect(mcp.client.getInstructions()).toContain('una sola relación por par');
    expect(mcp.client.getInstructions()).toContain('add_flow_step');
    expect(tools.find((t) => t.name === 'add_flow_step')!.inputSchema.required).toEqual(['id', 'type']);
    expect(tools.find((t) => t.name === 'delete_comment')!.annotations?.destructiveHint).toBe(true);
  });
});

describe('lectura', () => {
  it('get_workspace, list_views y get_view', async () => {
    const ws = (await mcp.call('get_workspace')).json;
    expect(ws.workspace.name).toBe('Demo');
    expect(ws.counts).toMatchObject({ elements: 9, relations: 4, views: 2 });

    const views = (await mcp.call('list_views')).json;
    expect(views.defaultView).toBe('landscape');
    expect(views.views.map((v: { id: string }) => v.id)).toEqual(['banking-containers', 'landscape']);

    const view = (await mcp.call('get_view', { id: 'landscape' })).json;
    expect(view.nodes.map((n: { id: string }) => n.id)).toEqual(['aws', 'banking', 'core', 'customer']);
    // customer → web y api → core-gw se ven como relaciones implícitas entre sistemas.
    expect(view.edges).toContainEqual({ from: 'customer', to: 'banking', relations: ['customer--web'], label: 'Usa', implied: true });
    expect(view.edges).toContainEqual({ from: 'banking', to: 'core', relations: ['api--core-gw'], label: 'Consulta saldos', implied: true });
  });

  it('list_elements filtra por tipo, padre, lienzo y texto', async () => {
    const containers = (await mcp.call('list_elements', { kind: 'container' })).json;
    expect(containers.elements.map((e: { id: string }) => e.id)).toEqual(['api', 'core-gw', 'web']);
    const children = (await mcp.call('list_elements', { parent: 'Home Banking' })).json;
    expect(children.elements.map((e: { id: string }) => e.id)).toEqual(['api', 'db', 'web']);
    const roots = (await mcp.call('list_elements', { parent: '' })).json;
    expect(roots.elements.map((e: { id: string }) => e.id)).toEqual(['aws', 'banking', 'core', 'customer']);
    const inView = (await mcp.call('list_elements', { view: 'banking-containers', query: 'bank' })).json;
    expect(inView.elements).toEqual([{ id: 'db', kind: 'store', name: 'Banking DB', parent: 'banking', engine: 'postgresql' }]);
    const limited = (await mcp.call('list_elements', { limit: 2 })).json;
    expect(limited).toMatchObject({ total: 9, truncated: true });
  });

  it('get_element, list_relations y get_relation', async () => {
    const api = (await mcp.call('get_element', { id: 'api' })).json;
    expect(api.element).toMatchObject({ kind: 'container', risk: 'high' });
    expect(api.ancestors.map((a: { id: string }) => a.id)).toEqual(['banking']);
    expect(api.children.map((c: { id: string }) => c.id)).toEqual(['accounts']);
    expect(api.relations.incoming.map((r: { id: string }) => r.id)).toEqual(['web--api']);
    expect(api.file).toBe('model/elements/api.yaml');
    expect((await mcp.call('get_element', { id: 'nadie' })).isError).toBe(true);

    const rels = (await mcp.call('list_relations', { withoutProtocols: true })).json;
    expect(rels.relations.map((r: { id: string }) => r.id)).toEqual(['accounts--db', 'api--core-gw', 'customer--web']);
    const fromWeb = (await mcp.call('list_relations', { from: 'web' })).json;
    expect(fromWeb.total).toBe(1);
    const rel = (await mcp.call('get_relation', { id: 'web--api' })).json;
    expect(rel.relation.protocols).toEqual(['https']);
    expect(rel.from.name).toBe('Web');
  });

  it('search_catalog sugiere protocolos según el destino', async () => {
    const protocols = (await mcp.call('search_catalog', { catalog: 'protocols', target: 'db', limit: 3 })).json;
    expect(protocols.map((p: { id: string }) => p.id)).toEqual(['jdbc', 'sql', 'odbc']);
    const engines = (await mcp.call('search_catalog', { catalog: 'engines', query: 'postgres' })).json;
    expect(engines[0]).toMatchObject({ id: 'postgresql', type: 'relational' });
    expect((await mcp.call('search_catalog', { catalog: 'containerTypes' })).json).toContainEqual({ id: 'api', name: 'API' });
  });

  it('validate, analyze y export', async () => {
    const valid = (await mcp.call('validate')).json;
    expect(valid).toMatchObject({ ok: true, errors: 0 });
    const analysis = (await mcp.call('analyze')).json;
    expect(analysis.summary).toMatchObject({ errors: 0, orphans: 0, cycles: 0, missingProtocols: 3 });
    expect(analysis.hotspots[0]).toMatchObject({ id: 'api', risk: 'high' });
    const mermaid = await mcp.call('export', { format: 'mermaid', view: 'banking-containers' });
    expect(mermaid.text).toContain('flowchart TB');
    expect((await mcp.call('export', { format: 'structurizr' })).text).toContain('workspace "Demo"');
  });
});

describe('escritura', () => {
  it('add_element crea un container en el L2, lo ubica y lo guarda en disco', async () => {
    const r = await mcp.call('add_element', { kind: 'container', name: 'Pagos API', view: 'banking-containers', technology: ['Go'], containerType: 'api' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ ok: true, id: 'pagos-api', element: { parent: 'banking', technology: ['go'] } });
    expect(r.json.written).toEqual(['model/elements/pagos-api.yaml', 'views/banking-containers.yaml']);
    const model = await modelOnDisk(dir);
    expect(model.elements['pagos-api']).toMatchObject({ kind: 'container', parent: 'banking', containerType: 'api' });
    expect(model.views['banking-containers']!.nodes['pagos-api']).toBeDefined();
  });

  it('connect respeta una relación por par', async () => {
    const created = (await mcp.call('connect', { from: 'web', to: 'db', label: 'Lee', protocols: ['JDBC'] })).json;
    expect(created).toMatchObject({ result: 'created', id: 'web--db', relation: { protocols: ['jdbc'] } });
    const reverse = (await mcp.call('connect', { from: 'db', to: 'web' })).json;
    expect(reverse).toMatchObject({ result: 'bidirectional', id: 'web--db', relation: { direction: 'bidirectional' } });
    const same = (await mcp.call('connect', { from: 'web', to: 'db' })).json;
    expect(same).toMatchObject({ result: 'exists', written: [] });
    expect((await modelOnDisk(dir)).relations['web--db']!.direction).toBe('bidirectional');
    const group = await mcp.call('connect', { from: 'web', to: 'aws' });
    expect(group.isError).toBe(true);
    expect(group.text).toContain('[invalid-endpoint]');
  });

  it('update_element y remove_element (en cascada)', async () => {
    const updated = (await mcp.call('update_element', { id: 'api', patch: { name: 'API v2', risk: null, technology: ['Spring Boot'] } })).json;
    expect(updated.element).toMatchObject({ name: 'API v2', technology: ['spring-boot'] });
    expect(updated.element.risk).toBeUndefined();
    const bad = await mcp.call('update_element', { id: 'api', patch: { parent: 'db' } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toBe('Un container no puede estar dentro de un store [invalid-parent]');
    expect((await mcp.call('update_element', { id: 'api', patch: { kind: 'system' } })).text).toContain('[immutable-field]');

    const removed = (await mcp.call('remove_element', { id: 'api' })).json;
    expect(removed.removed.map((c: { id: string }) => c.id).sort()).toEqual(['accounts', 'accounts--db', 'api', 'api--core-gw', 'web--api']);
    expect(removed.deleted).toContain('model/elements/accounts.yaml');
    const model = await modelOnDisk(dir);
    expect(model.elements.api).toBeUndefined();
    expect(model.views['banking-containers']!.nodes.api).toBeUndefined();
  });

  it('update_relation y remove_relation', async () => {
    const r = (await mcp.call('update_relation', { id: 'customer--web', patch: { protocols: ['HTTPS'], label: 'Opera' } })).json;
    expect(r.relation).toMatchObject({ label: 'Opera', protocols: ['https'] });
    expect((await mcp.call('remove_relation', { id: 'customer--web' })).json.deleted).toEqual(['model/relations/customer--web.yaml']);
    expect((await mcp.call('remove_relation', { id: 'customer--web' })).isError).toBe(true);
  });

  it('create_child_view, create_view, update_view y remove_view', async () => {
    const l3 = (await mcp.call('create_child_view', { element: 'api' })).json;
    expect(l3).toMatchObject({ created: true, id: 'api-components' });
    expect(l3.nodes).toEqual(expect.arrayContaining(['accounts', 'web', 'db']));
    expect((await mcp.call('create_child_view', { element: 'api' })).json).toMatchObject({ created: false, id: 'api-components' });
    expect((await mcp.call('create_child_view', { element: 'db' })).isError).toBe(true);

    const l1 = (await mcp.call('create_view', { name: 'Integraciones', description: 'Sistemas externos' })).json;
    expect(l1.id).toBe('integraciones');
    await mcp.call('update_view', { id: 'integraciones', name: 'Integraciones externas' });
    expect((await modelOnDisk(dir)).views.integraciones).toMatchObject({ name: 'Integraciones externas', level: 1, description: 'Sistemas externos' });
    expect((await mcp.call('remove_view', { id: 'integraciones' })).json.deleted).toEqual(['views/integraciones.yaml']);
  });

  it('place, unplace, layout_view y set_edge_style', async () => {
    const placed = (await mcp.call('place', { view: 'landscape', elements: ['core', 'banking'], positions: { banking: { x: 10, y: 20 } } })).json;
    expect(placed.nodes).toEqual({ banking: { x: 10, y: 20 } });
    expect(placed.skipped).toEqual(['core']);
    const wrong = await mcp.call('place', { view: 'landscape', elements: ['accounts'] });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain('[invalid-placement]');

    await mcp.call('unplace', { view: 'landscape', elements: ['core'] });
    expect((await modelOnDisk(dir)).views.landscape!.nodes.core).toBeUndefined();
    const again = (await mcp.call('place', { view: 'landscape', elements: ['core'] })).json;
    expect(Object.keys(again.nodes)).toEqual(['core']);

    const laid = (await mcp.call('layout_view', { view: 'banking-containers' })).json;
    expect(laid.moved).toBeGreaterThan(0);

    await mcp.call('set_edge_style', { view: 'banking-containers', relation: 'web--api', shape: 'step' });
    expect((await modelOnDisk(dir)).views['banking-containers']!.edges).toEqual({ 'web--api': { shape: 'step' } });
    await mcp.call('set_edge_style', { view: 'banking-containers', relation: 'web--api' });
    expect((await modelOnDisk(dir)).views['banking-containers']!.edges).toBeUndefined();
  });

  it('update_workspace', async () => {
    const r = await mcp.call('update_workspace', { name: 'Banca', description: 'Arquitectura', defaultView: 'Home Banking · Contenedores' });
    expect(r.isError).toBe(false);
    expect((await modelOnDisk(dir)).workspace).toMatchObject({ name: 'Banca', description: 'Arquitectura', defaultView: 'banking-containers' });
  });

  it('toma los cambios externos del disco antes de cada herramienta', async () => {
    writeFileSync(join(dir, 'model/elements/externo.yaml'), 'id: externo\nkind: system\nname: Editado a mano\n');
    const found = (await mcp.call('get_element', { id: 'externo' })).json;
    expect(found.element.name).toBe('Editado a mano');
    await mcp.call('update_element', { id: 'externo', patch: { description: 'Desde MCP' } });
    expect(readFileSync(join(dir, 'model/elements/externo.yaml'), 'utf8')).toContain('description: Desde MCP');
  });

  it('serializa escrituras concurrentes sin perder ninguna', async () => {
    const names = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'];
    const results = await Promise.all(names.map((name) => mcp.call('add_element', { kind: 'system', name, view: 'landscape' })));
    expect(results.every((r) => !r.isError)).toBe(true);
    const model = await modelOnDisk(dir);
    for (const n of names) expect(model.elements[n.toLowerCase()]).toBeDefined();
    expect(Object.keys(model.views.landscape!.nodes)).toHaveLength(4 + names.length);
  });
});

describe('flujos', () => {
  let root: string;
  let demo: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    root = tempWorkspace(demoModel());
    demo = await connect(root);
  });
  afterEach(() => demo.close());

  it('list_flows y get_flow traen los pasos numerados como en la app', async () => {
    expect((await demo.call('get_workspace')).json.counts).toMatchObject({ flows: 1, comments: 2, openComments: 2 });
    const list = (await demo.call('list_flows')).json;
    expect(list.total).toBe(1);
    expect(list.flows[0]).toMatchObject({ id: 'transferencia', name: 'Transferencia desde la app', view: 'home-banking-containers', steps: 7 });
    expect(list.flows[0].elements).toContain('fraude');
    expect((await demo.call('list_flows', { element: 'Motor antifraude' })).json.total).toBe(1);
    expect((await demo.call('list_flows', { element: 'cuentas-api' })).json.total).toBe(0);

    const flow = (await demo.call('get_flow', { id: 'Transferencia desde la app' })).json;
    expect(flow.file).toBe('flows/transferencia.yaml');
    expect(flow.diagnostics).toEqual([]);
    expect(flow.flow.steps).toHaveLength(7);
    expect(flow.steps[0]).toEqual({ n: '1', type: 'message', title: 'Confirma la transferencia', from: 'cliente', to: 'app-movil', relation: 'cliente--app-movil' });
    // eventos → notificaciones se dibuja sobre la relación al revés (notificaciones consume del bus).
    expect(flow.steps[5]).toMatchObject({ n: '6', from: 'eventos', to: 'notificaciones', relation: 'notificaciones--eventos' });
    const paths = flow.steps[4];
    expect(paths).toMatchObject({ n: '5', type: 'paths', mode: 'alternate', title: '¿Se aprueba?' });
    expect(paths.paths.map((p: { letter: string; name: string }) => `${p.letter} ${p.name}`)).toEqual(['A Aprobada', 'B Rechazada por riesgo']);
    expect(paths.paths[0].steps[1]).toMatchObject({ n: '5A.2', title: 'Registra el movimiento', from: 'core-client', to: 'core-bancario' });
    expect(flow.text).toContain('5B.1. Pagos API → Eventos de pagos: Publica pagos.rechazados');
    expect((await demo.call('get_flow', { id: 'nada' })).text).toContain('[not-found]');
  });

  it('create_flow y add_flow_step arman un flujo con una bifurcación', async () => {
    const created = (
      await demo.call('create_flow', {
        name: 'Alta de cliente',
        description: 'Onboarding digital',
        view: 'Home Banking · Contenedores',
        steps: [{ type: 'message', from: 'Cliente', to: 'App móvil', title: 'Completa el alta' }],
      })
    ).json;
    expect(created).toMatchObject({ ok: true, id: 'alta-de-cliente', warnings: [], written: ['flows/alta-de-cliente.yaml'] });
    expect(created.steps[0]).toMatchObject({ n: '1', relation: 'cliente--app-movil' });

    const add = (args: Record<string, unknown>) => demo.call('add_flow_step', { id: 'alta-de-cliente', ...args });
    expect((await add({ type: 'message', from: 'app-movil', to: 'api-gateway', title: 'POST /clientes' })).json.step).toBe('2');
    expect((await add({ type: 'process', element: 'Cuentas API', title: 'Valida los datos' })).json.step).toBe('3');
    expect((await add({ type: 'paths', title: '¿Pasa KYC?', paths: ['Aprobado', 'Rechazado'] })).json.step).toBe('4');
    expect((await add({ path: '4A', type: 'message', from: 'cuentas-api', to: 'banking-db', title: 'Guarda el cliente' })).json.step).toBe('4A.1');
    expect((await add({ path: '4b', type: 'note', title: 'Se avisa por mail' })).json.step).toBe('4B.1');
    expect((await add({ type: 'goto', flow: 'Transferencia desde la app' })).json.step).toBe('5');
    expect((await add({ type: 'note', title: 'Inicio', position: 1 })).json.step).toBe('1');

    // Un mensaje sin relación entre sus extremos se guarda, con un aviso.
    const loose = (await add({ path: '5A', type: 'message', from: 'cliente', to: 'banking-db' })).json;
    expect(loose).toMatchObject({ step: '5A.2', totalSteps: 6 });
    expect(loose.added).toEqual({ n: '5A.2', type: 'message', title: 'Cliente → Banking DB', from: 'cliente', to: 'banking-db', relation: null });
    expect(loose.warnings[0]).toContain('No hay relación entre "Cliente" y "Banking DB"');

    const flow = (await modelOnDisk(root)).flows!['alta-de-cliente']!;
    expect(flow).toMatchObject({ name: 'Alta de cliente', description: 'Onboarding digital', view: 'home-banking-containers' });
    expect(flow.steps.map((s) => s.type)).toEqual(['note', 'message', 'message', 'process', 'paths', 'goto']);
    expect(flow.steps[4]).toEqual({
      type: 'paths',
      mode: 'alternate',
      title: '¿Pasa KYC?',
      paths: [
        {
          name: 'Aprobado',
          steps: [
            { type: 'message', from: 'cuentas-api', to: 'banking-db', title: 'Guarda el cliente' },
            { type: 'message', from: 'cliente', to: 'banking-db' },
          ],
        },
        { name: 'Rechazado', steps: [{ type: 'note', title: 'Se avisa por mail' }] },
      ],
    });
    expect((await demo.call('validate')).json).toMatchObject({ ok: true, errors: 0, warnings: 0 });
  });

  it('add_flow_step rechaza pasos inválidos sin tocar el disco', async () => {
    const before = await modelOnDisk(root);
    const add = (args: Record<string, unknown>) => demo.call('add_flow_step', { id: 'transferencia', ...args });
    expect((await add({ type: 'message', from: 'cliente' })).text).toBe('Un paso message necesita `to` [invalid-step]');
    expect((await add({ type: 'process', element: 'nadie' })).text).toContain('No existe el elemento "nadie"');
    expect((await add({ type: 'goto', flow: 'otro' })).text).toContain('No existe el flujo "otro"');
    expect((await add({ type: 'message', from: 'cliente', to: 'app-movil', relation: 'no-existe' })).text).toContain('[not-found]');
    expect((await add({ type: 'note', path: '9A' })).text).toContain('no tiene paso 9 [not-found]');
    expect((await add({ type: 'note', path: '2A' })).text).toContain('no es una bifurcación [invalid-path]');
    expect((await add({ type: 'note', path: '5C' })).text).toContain('no tiene camino C');
    expect((await add({ type: 'note', path: 'A5' })).text).toContain('[invalid-path]');
    expect((await add({ type: 'paths', path: '5A', paths: ['X'] })).text).toContain('[invalid-step]');
    expect((await add({ type: 'paths' })).text).toContain('necesita `paths`');
    expect(await modelOnDisk(root)).toEqual(before);
  });

  it('update_flow edita y reemplaza los pasos; delete_flow avisa los goto rotos', async () => {
    const r = (await demo.call('update_flow', { id: 'transferencia', name: 'Transferencia', description: null, view: 'landscape' })).json;
    expect(r.summary).toBe('Flujo "Transferencia desde la app" actualizado (name, description, view)');
    let flow = (await modelOnDisk(root)).flows!.transferencia!;
    expect(flow).toMatchObject({ name: 'Transferencia', view: 'landscape' });
    expect(flow.description).toBeUndefined();

    const { flow: current } = (await demo.call('get_flow', { id: 'transferencia' })).json;
    const steps = current.steps.slice(0, 3).reverse();
    const replaced = (await demo.call('update_flow', { id: 'transferencia', steps })).json;
    expect(replaced.steps.map((s: { n: string; title: string }) => `${s.n} ${s.title}`)).toEqual([
      '1 Rutea al servicio de pagos',
      '2 POST /transferencias',
      '3 Confirma la transferencia',
    ]);
    flow = (await modelOnDisk(root)).flows!.transferencia!;
    expect(flow.steps[1]).toEqual(current.steps[1]);
    expect((await demo.call('update_flow', { id: 'transferencia' })).text).toContain('[empty-patch]');

    await demo.call('create_flow', { name: 'Aviso', steps: [{ type: 'goto', flow: 'transferencia' }] });
    const deleted = (await demo.call('delete_flow', { id: 'Transferencia' })).json;
    expect(deleted.deleted).toEqual(['flows/transferencia.yaml']);
    expect(deleted.warnings[0]).toContain('El flujo "Aviso" (aviso)');
    expect((await modelOnDisk(root)).flows!.transferencia).toBeUndefined();
    const valid = (await demo.call('validate')).json;
    expect(valid.diagnostics.map((d: { code: string }) => d.code)).toEqual(['flow-missing-element']);
    expect((await demo.call('delete_flow', { id: 'transferencia' })).isError).toBe(true);
  });
});

describe('comentarios', () => {
  let root: string;
  let demo: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    root = tempWorkspace(demoModel());
    demo = await connect(root);
  });
  afterEach(() => demo.close());

  it('list_comments filtra por lienzo, elemento y estado', async () => {
    const all = (await demo.call('list_comments')).json;
    expect(all).toMatchObject({ total: 2, open: 2, resolved: 0 });
    expect(all.comments.map((c: { id: string }) => c.id)).toEqual(['c-migrar-aurora', 'c-pasarela']);
    expect(all.comments[0]).toMatchObject({
      view: 'home-banking-containers',
      viewName: 'Home Banking · Contenedores',
      element: 'banking-db',
      elementName: 'Banking DB',
      resolved: false,
      icon: 'question',
      color: 'violet',
      author: 'Arquitectura',
      replies: [{ author: 'Equipo Canales', body: 'Lo evaluamos el próximo trimestre; primero hay que medir los IOPS.' }],
    });
    expect((await demo.call('list_comments', { view: 'Landscape' })).json.comments.map((c: { id: string }) => c.id)).toEqual(['c-pasarela']);
    expect((await demo.call('list_comments', { element: 'Banking DB' })).json.total).toBe(1);
    expect((await demo.call('list_comments', { status: 'resolved' })).json.total).toBe(0);
  });

  it('add_comment ancla al elemento en su lienzo y se ubica solo', async () => {
    const first = (await demo.call('add_comment', { element: 'Pagos API', body: '¿Escala con el pico de fin de mes?', icon: 'question', title: 'Capacidad' })).json;
    expect(first.id).toMatch(/^c-[a-z0-9]+$/);
    expect(first.written).toEqual([`comments/${first.id}.yaml`]);
    expect(first.comment).toMatchObject({
      view: 'home-banking-containers',
      element: 'pagos-api',
      icon: 'question',
      color: 'accent',
      title: 'Capacidad',
      author: 'Agente de IA',
      resolved: false,
      replies: [],
    });
    const second = (await demo.call('add_comment', { element: 'pagos-api', body: 'Otro', author: 'Claude' })).json;
    let model = await modelOnDisk(root);
    // Esquina superior derecha del nodo (220 de ancho); el segundo, un poco más abajo.
    expect(model.comments![first.id]).toMatchObject({ x: 196, y: -14, body: '¿Escala con el pico de fin de mes?' });
    expect(model.comments![second.id]).toMatchObject({ x: 196, y: 26, author: 'Claude' });
    expect(Date.parse(model.comments![first.id]!.at)).not.toBeNaN();

    const loose = (await demo.call('add_comment', { view: 'landscape', body: 'Falta el proveedor de identidad', color: 'warn' })).json;
    const right = Math.max(...Object.values(model.views.landscape!.nodes).map((n) => n.x + (n.w ?? 220)));
    model = await modelOnDisk(root);
    expect(model.comments![loose.id]).toMatchObject({ view: 'landscape', x: right + 40, color: 'warn' });
    expect(model.comments![loose.id]!.element).toBeUndefined();

    const at = (await demo.call('add_comment', { view: 'landscape', element: 'Cliente', x: 10, y: 20, body: 'Acá' })).json;
    expect((await modelOnDisk(root)).comments![at.id]).toMatchObject({ element: 'cliente', x: 10, y: 20 });
    expect((await demo.call('validate')).json).toMatchObject({ ok: true, warnings: 0 });
  });

  it('add_comment explica lo que falta', async () => {
    expect((await demo.call('add_comment', { body: 'Sin lugar' })).text).toContain('[invalid-comment]');
    expect((await demo.call('add_comment', { view: 'landscape', element: 'pagos-api', body: 'x' })).text).toBe(
      '"Pagos API" no está ubicado en el lienzo landscape [not-in-view]',
    );
    expect((await demo.call('add_comment', { view: 'landscape', body: 'x', x: 3 })).text).toContain('[invalid-position]');
    expect((await demo.call('add_comment', { view: 'nada', body: 'x' })).text).toContain('No existe el lienzo "nada"');
  });

  it('reply_comment, resolve_comment y delete_comment', async () => {
    const reply = (await demo.call('reply_comment', { id: 'c-pasarela', body: 'Hay un ticket abierto con el proveedor', author: 'Ana' })).json;
    expect(reply.comment.replies).toHaveLength(1);
    expect(reply.comment.replies[0]).toMatchObject({ author: 'Ana', body: 'Hay un ticket abierto con el proveedor' });
    expect((await demo.call('reply_comment', { id: 'c-migrar-aurora', body: 'Medido' })).json.comment.replies[1].author).toBe('Agente de IA');

    const resolved = (await demo.call('resolve_comment', { id: 'c-pasarela' })).json;
    expect(resolved).toMatchObject({ summary: 'Comentario c-pasarela resuelto', written: ['comments/c-pasarela.yaml'] });
    expect((await modelOnDisk(root)).comments!['c-pasarela']!.resolved).toBe(true);
    expect((await demo.call('resolve_comment', { id: 'c-pasarela' })).json).toMatchObject({ summary: 'El comentario c-pasarela ya estaba resuelto', written: [] });
    expect((await demo.call('list_comments', { status: 'open' })).json.comments.map((c: { id: string }) => c.id)).toEqual(['c-migrar-aurora']);

    await demo.call('resolve_comment', { id: 'c-pasarela', resolved: false });
    expect((await modelOnDisk(root)).comments!['c-pasarela']!.resolved).toBeUndefined();

    expect((await demo.call('delete_comment', { id: 'c-pasarela' })).json.deleted).toEqual(['comments/c-pasarela.yaml']);
    expect((await demo.call('delete_comment', { id: 'c-pasarela' })).text).toBe('No existe el comentario "c-pasarela" [not-found]');
    expect((await demo.call('reply_comment', { id: 'nada', body: 'x' })).isError).toBe(true);
  });
});

describe('fixtures', () => {
  it('lee el demo de fixtures/ y edita una copia', async () => {
    const demo = await connect(join(FIXTURES, 'demo'));
    expect((await demo.call('validate')).json).toMatchObject({ ok: true, errors: 0, warnings: 0 });
    expect((await demo.call('get_workspace')).json.counts).toMatchObject({ elements: 20, relations: 18, views: 3 });
    expect((await demo.call('analyze')).json.summary).toMatchObject({ errors: 0, orphans: 0, cycles: 0 });
    await demo.close();

    const root = tempCopy('demo');
    const copy = await connect(root);
    const added = (await copy.call('add_element', { kind: 'container', name: 'Conciliador', view: 'home-banking-containers', technology: ['java', 'spring-boot'], containerType: 'worker' })).json;
    expect(added.element.parent).toBe('home-banking');
    expect((await copy.call('connect', { from: 'conciliador', to: 'Banking DB', protocols: ['jdbc'] })).json.result).toBe('created');
    expect((await copy.call('validate')).json.ok).toBe(true);
    await copy.close();
    expect((await modelOnDisk(root)).relations['conciliador--banking-db']).toBeDefined();
  });

  it('explica cuando la carpeta no es un workspace', async () => {
    const none = await connect(join(FIXTURES, '..', 'docs'));
    const r = await none.call('get_workspace');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('no es un workspace de Aegon');
    await none.close();
  });
});

describe('stdio', () => {
  it('el binario crea un contenedor y lo conecta (como lo haría Claude Code)', async () => {
    const root = tempWorkspace(sampleModel());
    const transport = new StdioClientTransport({ command: process.execPath, args: [MAIN, '--workspace', root], stderr: 'pipe' });
    const client = new Client({ name: 'stdio-test', version: '0.0.0' });
    await client.connect(transport);
    const text = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0]!.text);
    };
    const added = await text('add_element', { kind: 'container', name: 'Notificaciones', view: 'banking-containers', technology: ['nodejs'] });
    expect(added.id).toBe('notificaciones');
    const connected = await text('connect', { from: 'notificaciones', to: 'api', label: 'Consulta clientes', protocols: ['rest'] });
    expect(connected.result).toBe('created');
    await client.close();

    const model = await modelOnDisk(root);
    expect(model.elements.notificaciones).toMatchObject({ parent: 'banking' });
    expect(model.relations['notificaciones--api']).toMatchObject({ label: 'Consulta clientes', protocols: ['rest'] });
  });
});
