import { describe, expect, it } from 'vitest';
import { applyOp } from '../ops/index.ts';
import { diffModels, revertChangeOp } from '../diff/index.ts';
import { mergeModels } from '../merge/index.ts';
import { validateModel } from '../rules/index.ts';
import { demoModel } from '../demo.ts';
import type { Flow } from '../schema/index.ts';
import {
  flowFrames,
  flowToMermaid,
  flowToText,
  frameElements,
  stepTitle,
  viewForFrame,
} from './index.ts';

const model = demoModel();
const flow = model.flows!.transferencia!;

describe('flujos', () => {
  it('se agregan, editan y eliminan con ops que se deshacen', () => {
    const extra: Flow = {
      id: 'login',
      name: 'Login',
      steps: [{ type: 'process', element: 'api-gateway', title: 'Valida el token' }],
    };
    const added = applyOp(model, { type: 'flow.add', flow: extra });
    expect(added.model.flows!.login!.name).toBe('Login');
    const renamed = applyOp(added.model, {
      type: 'flow.update',
      id: 'login',
      patch: { name: 'Inicio de sesión' },
    });
    expect(renamed.model.flows!.login!.name).toBe('Inicio de sesión');
    expect(applyOp(renamed.model, renamed.inverse).model.flows!.login!.name).toBe('Login');
    const removed = applyOp(added.model, { type: 'flow.remove', id: 'login' });
    expect(removed.model.flows!.login).toBeUndefined();
    expect(applyOp(removed.model, removed.inverse).model.flows!.login).toEqual(extra);
    // El diff lo muestra y se puede revertir.
    const changes = diffModels(model, added.model);
    expect(changes).toMatchObject([{ entity: 'flow', kind: 'added', name: 'Login' }]);
    expect(
      applyOp(added.model, revertChangeOp(model, added.model, changes[0]!)!).model.flows!.login,
    ).toBeUndefined();
  });

  it('sin flujos ni comentarios, el modelo no tiene esas claves', () => {
    let m = model;
    for (const id of Object.keys(m.flows!)) m = applyOp(m, { type: 'flow.remove', id }).model;
    expect('flows' in m).toBe(false);
  });

  it('arma los cuadros de la presentación siguiendo el camino elegido', () => {
    const frames = flowFrames(flow);
    expect(frames.map((f) => f.label)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '5A.1',
      '5A.2',
      '5A.3',
      '6',
      '7',
    ]);
    expect(frames[4]!.paths).toEqual({
      mode: 'alternate',
      names: ['Aprobada', 'Rechazada por riesgo'],
      chosen: 0,
    });
    const rejected = flowFrames(flow, { 4: 1 });
    expect(rejected.map((f) => f.label)).toEqual(['1', '2', '3', '4', '5', '5B.1', '6', '7']);
  });

  it('en caminos paralelos los pasos de igual posición van juntos', () => {
    const parallel: Flow = {
      id: 'p',
      name: 'Paralelo',
      steps: [
        {
          type: 'paths',
          mode: 'parallel',
          paths: [
            {
              name: 'Notificar',
              steps: [{ type: 'message', from: 'eventos', to: 'notificaciones' }],
            },
            {
              name: 'Auditar',
              steps: [{ type: 'process', element: 'pagos-api' }, { type: 'note' }],
            },
          ],
        },
      ],
    };
    const frames = flowFrames(parallel);
    expect(frames.map((f) => f.steps.length)).toEqual([2, 2, 1]);
    expect(frames[1]!.label).toBe('1A.1 · 1B.1');
  });

  it('elige el lienzo que muestra los elementos de cada paso (L2 o L3)', () => {
    const frames = flowFrames(flow);
    expect(viewForFrame(model, flow, frames[1]!)).toBe('home-banking-containers');
    // "Evalúa el riesgo" es entre componentes: se muestra en el L3 de Pagos API.
    expect(frameElements(frames[3]!)).toEqual(['transfer-controller', 'fraude']);
    expect(viewForFrame(model, flow, frames[3]!)).toBe('pagos-api-components');
    expect(viewForFrame(model, flow, frames[9]!)).toBeNull(); // nota: se queda donde está
  });

  it('exporta a Mermaid y a texto', () => {
    const mermaid = flowToMermaid(model, flow);
    expect(mermaid).toContain('sequenceDiagram');
    expect(mermaid).toMatch(/alt Aprobada[\s\S]*else Rechazada por riesgo[\s\S]*end/);
    expect(mermaid).toContain('->>');
    const text = flowToText(model, flow);
    expect(text).toContain('2. App móvil → API Gateway: POST /transferencias');
    expect(text).toContain('A) Aprobada');
    expect(stepTitle(model, { type: 'message', from: 'web-app', to: 'api-gateway' })).toBe('Llama');
  });

  it('valida referencias de pasos y comentarios', () => {
    expect(
      validateModel(model).filter((d) => d.entity?.type === 'flow' || d.entity?.type === 'comment'),
    ).toEqual([]);
    const broken = applyOp(model, { type: 'element.remove', id: 'fraude' }).model;
    expect(validateModel(broken).map((d) => d.code)).toContain('flow-missing-element');
  });
});

describe('comentarios', () => {
  it('se agregan con respuestas y el diff los nombra por su título o texto', () => {
    const added = applyOp(model, {
      type: 'comment.add',
      comment: {
        id: 'c-1',
        view: 'landscape',
        x: 10,
        y: 20,
        body: 'Revisar la latencia del core',
        author: 'Ana',
        at: '2026-10-18T10:00:00.000Z',
      },
    }).model;
    expect(diffModels(model, added)).toMatchObject([
      { entity: 'comment', kind: 'added', name: 'Revisar la latencia del core' },
    ]);
    const replied = applyOp(added, {
      type: 'comment.update',
      id: 'c-1',
      patch: {
        replies: [{ author: 'Luis', at: '2026-10-18T11:00:00.000Z', body: 'Medido: 120 ms p95' }],
        resolved: true,
      },
    }).model;
    expect(replied.comments!['c-1']!.replies).toHaveLength(1);
    expect(() =>
      applyOp(model, {
        type: 'comment.add',
        comment: { id: 'c-2', view: 'landscape', x: 0, y: 0, body: '', author: 'Ana', at: 'x' },
      }),
    ).toThrow();
  });

  it('el merge combina comentarios y flujos agregados de ambos lados', () => {
    const ours = applyOp(model, {
      type: 'comment.add',
      comment: { id: 'c-a', view: 'landscape', x: 0, y: 0, body: 'Nuestro', author: 'A', at: 't' },
    }).model;
    const theirs = applyOp(model, {
      type: 'flow.add',
      flow: { id: 'otro', name: 'Otro', steps: [] },
    }).model;
    const { merged, conflicts } = mergeModels(model, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.comments!['c-a']).toBeDefined();
    expect(merged.flows!.otro).toBeDefined();
  });
});
