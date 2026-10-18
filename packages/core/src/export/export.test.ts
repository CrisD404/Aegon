import { describe, expect, it } from 'vitest';
import { applyOp } from '../ops/index.ts';
import { demoModel } from '../demo.ts';
import { sampleModel } from '../test-fixtures.ts';
import { exportModel, toJson, toMermaid, toPlantUml, toStructurizr } from './index.ts';

describe('exportadores', () => {
  it('Mermaid: marco del sistema, formas por tipo, implícitas punteadas y externos', () => {
    const text = toMermaid(sampleModel(), 'banking-containers');
    expect(text).toContain('subgraph banking["Home Banking · Sistema"]');
    expect(text).toContain('db[("<b>Banking DB</b><br/>[Base de datos: PostgreSQL]")]');
    expect(text).toContain('web -->|"Llama<br/>[HTTPS]"| api');
    expect(text).toContain('api -.->|"Consulta saldos"| core');
    expect(text).toContain('class core external');
  });

  it('Mermaid evita palabras reservadas como ID', () => {
    const model = applyOp(sampleModel(), { type: 'element.add', element: { id: 'end', kind: 'system', name: 'Fin' } }).model;
    const withNode = applyOp(model, { type: 'view.place', view: 'landscape', nodes: { end: { x: 0, y: 0 } } }).model;
    expect(toMermaid(withNode, 'landscape')).toContain('end_["<b>Fin</b>');
  });

  it('C4-PlantUML: macros por tipo y nivel, límites y relaciones bidireccionales', () => {
    const model = applyOp(demoModel(), { type: 'relation.update', id: 'web-app--api-gateway', patch: { direction: 'bidirectional' } }).model;
    const text = toPlantUml(model, 'home-banking-containers');
    expect(text).toContain('System_Boundary(home_banking, "Home Banking") {');
    expect(text).toContain('ContainerQueue(eventos, "Eventos de pagos", "Apache Kafka"');
    expect(text).toContain('Person_Ext(cliente, "Cliente", "Persona o empresa con cuenta")');
    expect(text).toContain('BiRel(web_app, api_gateway, "Llama", "HTTPS")');
    expect(text.trimEnd().endsWith('@enduml')).toBe(true);
  });

  it('Structurizr: jerarquía, grupos, sin relaciones padre-hijo y vistas por nivel', () => {
    const model = applyOp(demoModel(), { type: 'relation.add', relation: { id: 'web-app--home-banking', from: 'web-app', to: 'home-banking' } }).model;
    const text = toStructurizr(model);
    expect(text).toContain('group "AWS" {');
    expect(text).toMatch(/home_banking = softwareSystem "Home Banking" .* \{\n\s+api_gateway = container/);
    expect(text).toContain('pagos_api = container "Pagos API"');
    expect(text).toContain('transfer_controller = component "Transfer Controller"');
    expect(text).not.toContain('web_app -> home_banking');
    expect(text).toContain('systemLandscape "landscape" "Landscape" {');
    expect(text).toContain('component pagos_api "pagos-api-components"');
  });

  it('JSON con todo el modelo ordenado', () => {
    const parsed = JSON.parse(toJson(sampleModel()));
    expect(parsed.elements.map((e: { id: string }) => e.id)).toEqual(['accounts', 'api', 'aws', 'banking', 'core', 'core-gw', 'customer', 'db', 'web']);
    expect(JSON.parse(toJson(sampleModel(), 'landscape')).views).toHaveLength(1);
  });

  it('errores claros: lienzo inexistente o formato desconocido', () => {
    expect(() => exportModel(sampleModel(), 'mermaid', { view: 'nada' })).toThrow('No existe el lienzo "nada"');
    expect(() => exportModel(sampleModel(), 'svg' as never)).toThrow('Formato desconocido');
  });
});
