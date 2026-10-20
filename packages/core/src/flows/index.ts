import { idFromName } from '../ids/index.ts';
import type { Model } from '../model/index.ts';
import { representativeInView } from '../ops/commands.ts';
import type { Flow, FlowStep, Id, LeafStep, Relation, View } from '../schema/index.ts';

/**
 * Flujos: secuencias de pasos sobre el modelo (mensajes entre elementos, procesos, notas,
 * bifurcaciones y saltos a otros flujos) que la app reproduce como una presentación.
 */

export const STEP_TYPE_LABEL: Record<FlowStep['type'], string> = {
  message: 'Mensaje',
  process: 'Proceso',
  note: 'Nota',
  goto: 'Ir a otro flujo',
  paths: 'Caminos',
};

/** Letra de un camino dentro de una bifurcación: A, B, C… */
export const pathLetter = (index: number) => String.fromCharCode(65 + (index % 26));

/** Número visible de un paso: `3`, o `3A.2` dentro del camino A del paso 3. */
export function stepLabel(top: number, path?: number, inner?: number): string {
  return path === undefined || inner === undefined
    ? String(top + 1)
    : `${top + 1}${pathLetter(path)}.${inner + 1}`;
}

/** Elementos que intervienen en un paso. */
export function stepElements(step: FlowStep | LeafStep): Id[] {
  if (step.type === 'message') return step.from === step.to ? [step.from] : [step.from, step.to];
  if (step.type === 'process') return [step.element];
  if (step.type === 'paths')
    return [...new Set(step.paths.flatMap((p) => p.steps.flatMap(stepElements)))];
  return [];
}

/** Relación que representa un mensaje: la indicada o la que une al par (en cualquier sentido). */
export function relationForStep(model: Model, step: LeafStep): Relation | undefined {
  if (step.type !== 'message') return undefined;
  if (step.relation && model.relations[step.relation]) return model.relations[step.relation];
  const between = (a: Id, b: Id) => Object.values(model.relations).find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
  const direct = between(step.from, step.to);
  if (direct) return direct;
  // Entre instancias (despliegue), la relación es la de lo que despliegan.
  const deployed = (id: Id) => {
    const el = model.elements[id];
    return el?.kind === 'instance' ? el.instance.of : id;
  };
  const from = deployed(step.from);
  const to = deployed(step.to);
  return from !== step.from || to !== step.to ? between(from, to) : undefined;
}

/** Título por defecto de un paso sin título (lo que se ve en la lista y al reproducir). */
export function stepTitle(model: Model, step: FlowStep | LeafStep): string {
  if (step.title) return step.title;
  const name = (id: Id) => model.elements[id]?.name ?? id;
  switch (step.type) {
    case 'message':
      return relationForStep(model, step)?.label ?? `${name(step.from)} → ${name(step.to)}`;
    case 'process':
      return `${name(step.element)} procesa`;
    case 'note':
      return 'Nota';
    case 'goto':
      return `Continúa en ${model.flows?.[step.flow]?.name ?? step.flow}`;
    case 'paths':
      return step.mode === 'alternate' ? 'Caminos alternativos' : 'En paralelo';
  }
}

// ---------------------------------------------------------------------------------------------
// Reproducción

export interface FrameStep {
  step: LeafStep;
  label: string;
  /** Camino al que pertenece (dentro de una bifurcación). */
  path?: { index: number; name: string };
}

export interface FlowFrame {
  /** Clave estable dentro del flujo (`3`, `4A.2`, `5·1`). */
  key: string;
  label: string;
  /** Índice del paso de primer nivel. */
  top: number;
  kind: 'step' | 'paths';
  /** Pasos que se muestran a la vez (más de uno en caminos paralelos). */
  steps: FrameStep[];
  title?: string;
  description?: string;
  /** Cabecera de una bifurcación: los caminos y el elegido (alternativos). */
  paths?: { mode: 'alternate' | 'parallel'; names: string[]; chosen: number };
}

/**
 * Cuadros de la presentación. En caminos alternativos se recorre el elegido (`choices[top]`, el
 * primero por defecto); en paralelos, los pasos de igual posición de cada camino van juntos.
 */
export function flowFrames(
  flow: Flow,
  choices: Readonly<Record<number, number>> = {},
): FlowFrame[] {
  const frames: FlowFrame[] = [];
  flow.steps.forEach((step, i) => {
    const label = stepLabel(i);
    if (step.type !== 'paths') {
      frames.push({
        key: label,
        label,
        top: i,
        kind: 'step',
        steps: [{ step, label }],
        title: step.title,
        description: step.description,
      });
      return;
    }
    const chosen = Math.min(choices[i] ?? 0, step.paths.length - 1);
    frames.push({
      key: label,
      label,
      top: i,
      kind: 'paths',
      title: step.title,
      description: step.description,
      paths: { mode: step.mode, names: step.paths.map((p) => p.name), chosen },
      // La cabecera resalta el primer paso de cada camino.
      steps: step.paths.flatMap((p, pi) =>
        p.steps[0]
          ? [{ step: p.steps[0], label: stepLabel(i, pi, 0), path: { index: pi, name: p.name } }]
          : [],
      ),
    });
    if (step.mode === 'alternate') {
      const path = step.paths[chosen]!;
      path.steps.forEach((s, j) => {
        const l = stepLabel(i, chosen, j);
        frames.push({
          key: l,
          label: l,
          top: i,
          kind: 'step',
          steps: [{ step: s, label: l, path: { index: chosen, name: path.name } }],
          title: s.title,
          description: s.description,
        });
      });
    } else {
      const depth = Math.max(0, ...step.paths.map((p) => p.steps.length));
      for (let j = 0; j < depth; j++) {
        const row = step.paths.flatMap((p, pi) =>
          p.steps[j]
            ? [{ step: p.steps[j]!, label: stepLabel(i, pi, j), path: { index: pi, name: p.name } }]
            : [],
        );
        frames.push({
          key: `${label}·${j + 1}`,
          label: row.map((r) => r.label).join(' · '),
          top: i,
          kind: 'step',
          steps: row,
        });
      }
    }
  });
  return frames;
}

/** Elementos de un cuadro. */
export function frameElements(frame: FlowFrame): Id[] {
  return [...new Set(frame.steps.flatMap((s) => stepElements(s.step)))];
}

/**
 * Lienzo donde mostrar un cuadro: el del flujo si muestra a todos sus elementos (directamente o a
 * través de un ancestro), si no el lienzo que mejor los muestra. Null si el cuadro no tiene
 * elementos o ningún lienzo los muestra (se queda en el actual).
 */
export function viewForFrame(model: Model, flow: Flow, frame: FlowFrame): Id | null {
  const ids = frameElements(frame).filter((id) => model.elements[id]);
  if (!ids.length) return null;
  const score = (view: View): number => {
    let s = 0;
    for (const id of ids) {
      if (view.nodes[id]) s += 2;
      else if (representativeInView(model, view, id)) s += 1;
      else return -1;
    }
    // Un mensaje cuyos dos extremos caen en el mismo nodo no se ve: se descarta ese lienzo.
    for (const { step } of frame.steps) {
      if (step.type === 'message' && step.from !== step.to) {
        const a = representativeInView(model, view, step.from);
        const b = representativeInView(model, view, step.to);
        if (!a || !b || a === b) return -1;
      }
    }
    return s;
  };
  const preferred = flow.view ? model.views[flow.view] : undefined;
  if (preferred && score(preferred) === ids.length * 2) return preferred.id;
  let best: { id: Id; score: number; nodes: number } | null = null;
  for (const view of Object.values(model.views)) {
    const s = score(view) + (view.id === flow.view ? 0.5 : 0);
    if (s < 0) continue;
    const nodes = Object.keys(view.nodes).length;
    if (!best || s > best.score || (s === best.score && nodes < best.nodes))
      best = { id: view.id, score: s, nodes };
  }
  return best?.id ?? (preferred ? preferred.id : null);
}

// ---------------------------------------------------------------------------------------------
// Export

/** Flujo como texto plano (para pegar junto a una imagen del diagrama o en un ticket). */
export function flowToText(model: Model, flow: Flow): string {
  const name = (id: Id) => model.elements[id]?.name ?? id;
  const lines = [flow.name, ...(flow.description ? [flow.description] : []), ''];
  const leaf = (step: LeafStep, label: string, indent: string) => {
    const who =
      step.type === 'message'
        ? `${name(step.from)} → ${name(step.to)}: `
        : step.type === 'process'
          ? `${name(step.element)}: `
          : '';
    lines.push(`${indent}${label}. ${who}${stepTitle(model, step)}`);
    if (step.description)
      for (const l of step.description.split('\n')) lines.push(`${indent}   ${l}`);
  };
  flow.steps.forEach((step, i) => {
    if (step.type !== 'paths') return leaf(step, stepLabel(i), '');
    lines.push(
      `${stepLabel(i)}. ${stepTitle(model, step)} (${step.mode === 'alternate' ? 'uno de estos caminos' : 'en paralelo'})`,
    );
    step.paths.forEach((p, pi) => {
      lines.push(`   ${pathLetter(pi)}) ${p.name}`);
      p.steps.forEach((s, j) => leaf(s, stepLabel(i, pi, j), '      '));
    });
  });
  return `${lines.join('\n').trimEnd()}\n`;
}

/** Flujo como diagrama de secuencia de Mermaid. */
export function flowToMermaid(model: Model, flow: Flow): string {
  const participants = new Map<Id, string>();
  const alias = (id: Id) => {
    if (!participants.has(id)) participants.set(id, `p${participants.size + 1}`);
    return participants.get(id)!;
  };
  const text = (s: string) => s.replace(/[;#\n]/g, ' ').trim();
  const body: string[] = [];
  const leaf = (step: LeafStep, label: string, indent: string) => {
    const title = text(`${label}. ${stepTitle(model, step)}`);
    if (step.type === 'message')
      body.push(`${indent}${alias(step.from)}->>${alias(step.to)}: ${title}`);
    else if (step.type === 'process')
      body.push(`${indent}Note over ${alias(step.element)}: ${title}`);
    else body.push(`${indent}%% ${title}`);
  };
  flow.steps.forEach((step, i) => {
    if (step.type !== 'paths') return leaf(step, stepLabel(i), '  ');
    const [open, between] = step.mode === 'alternate' ? ['alt', 'else'] : ['par', 'and'];
    step.paths.forEach((p, pi) => {
      body.push(`  ${pi === 0 ? open : between} ${text(p.name)}`);
      p.steps.forEach((s, j) => leaf(s, stepLabel(i, pi, j), '    '));
    });
    body.push('  end');
  });
  const head = ['sequenceDiagram', `  title ${text(flow.name)}`];
  for (const [id, a] of participants)
    head.push(`  participant ${a} as ${text(model.elements[id]?.name ?? id)}`);
  return `${[...head, ...body].join('\n')}\n`;
}

/** ID nuevo para un flujo a partir de su nombre. */
export function newFlowId(model: Model, name: string): Id {
  return idFromName(name, (id) => !!model.flows?.[id], 'flujo');
}
