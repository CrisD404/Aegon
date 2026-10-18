import { ancestorsOf, descendantsOf, sortedValues, type Model } from '../model/index.ts';
import type { ElementKind, Id, Risk, Status } from '../schema/index.ts';
import { suggestProtocols } from '../catalog/index.ts';
import { validateModel, type Diagnostic } from '../rules/index.ts';

/**
 * Análisis de calidad del modelo (más allá de la validación): huérfanos, ciclos de dependencias,
 * violaciones de C4, relaciones sin protocolo y hotspots de riesgo. Lo usan `aegon lint` y la
 * herramienta `analyze` del servidor MCP.
 */

export interface ElementRef {
  id: Id;
  name: string;
  kind: ElementKind;
}

export interface CycleFinding {
  /** Elementos del ciclo (componente fuertemente conexo), ordenados por ID. */
  elements: Id[];
  /** Relaciones entre esos elementos. */
  relations: Id[];
}

export interface MissingProtocolFinding {
  relation: Id;
  from: Id;
  to: Id;
  /** `Web App → API Gateway`. */
  name: string;
  /** Protocolos sugeridos según el destino (IDs del catálogo `PROTOCOLS`). */
  suggestions: string[];
}

export interface Hotspot extends ElementRef {
  risk?: Risk;
  status?: Status;
  /** Elementos que dependen de este (o de alguno de sus hijos), sin contar a sus propios hijos. */
  dependents: Id[];
  score: number;
  reasons: string[];
}

export interface Analysis {
  summary: {
    elements: number;
    relations: number;
    views: number;
    errors: number;
    warnings: number;
    orphans: number;
    cycles: number;
    missingProtocols: number;
    hotspots: number;
  };
  /** Errores y advertencias de `validateModel` más reglas de estilo C4. */
  violations: Diagnostic[];
  /** Elementos sin ninguna relación (ni propia ni de sus hijos). */
  orphans: ElementRef[];
  cycles: CycleFinding[];
  missingProtocols: MissingProtocolFinding[];
  hotspots: Hotspot[];
}

export interface AnalyzeOptions {
  /** Máximo de hotspots a devolver (por defecto 10). */
  hotspotLimit?: number;
}

const RISK_WEIGHT: Readonly<Record<Risk, number>> = { low: 1, medium: 2, high: 4, critical: 8 };
const RISK_TEXT: Readonly<Record<Risk, string>> = { low: 'bajo', medium: 'medio', high: 'alto', critical: 'crítico' };

const ref = (model: Model, id: Id): ElementRef => {
  const el = model.elements[id]!;
  return { id, name: el.name, kind: el.kind };
};

export function analyzeModel(model: Model, options: AnalyzeOptions = {}): Analysis {
  const violations = [...validateModel(model).filter((d) => d.severity !== 'info'), ...c4StyleViolations(model)];
  const orphans = findOrphans(model);
  const cycles = findCycles(model);
  const missingProtocols = findMissingProtocols(model);
  const hotspots = findHotspots(model).slice(0, options.hotspotLimit ?? 10);
  return {
    summary: {
      elements: Object.keys(model.elements).length,
      relations: Object.keys(model.relations).length,
      views: Object.keys(model.views).length,
      errors: violations.filter((d) => d.severity === 'error').length,
      warnings: violations.filter((d) => d.severity === 'warning').length,
      orphans: orphans.length,
      cycles: cycles.length,
      missingProtocols: missingProtocols.length,
      hotspots: hotspots.length,
    },
    violations,
    orphans,
    cycles,
    missingProtocols,
    hotspots,
  };
}

/** Reglas de estilo de C4 que el modelo admite pero conviene evitar. */
function c4StyleViolations(model: Model): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const rel of sortedValues(model.relations)) {
    const from = model.elements[rel.from];
    const to = model.elements[rel.to];
    if (!from || !to) continue;
    const entity = { type: 'relation' as const, id: rel.id };
    const ancestorOf = (a: Id, b: Id) => ancestorsOf(model, b).some((x) => x.id === a);
    if (ancestorOf(from.id, to.id) || ancestorOf(to.id, from.id)) {
      out.push({ severity: 'warning', code: 'ancestor-relation', message: `"${from.name}" y "${to.name}" se relacionan pero uno contiene al otro: en C4 la relación va entre elementos del mismo nivel o hacia afuera`, entity });
    }
    if ((from.kind === 'actor' && to.kind === 'store') || (from.kind === 'store' && to.kind === 'actor')) {
      out.push({ severity: 'warning', code: 'actor-to-store', message: `"${from.name}" → "${to.name}": una persona no accede directo a una base de datos; pasá por el contenedor que la usa`, entity });
    }
  }
  return out;
}

function findOrphans(model: Model): ElementRef[] {
  // Un extremo de una relación "toca" también a sus ancestros (el sistema de un container).
  const touched = new Set<Id>();
  for (const rel of Object.values(model.relations)) {
    for (const end of [rel.from, rel.to]) {
      touched.add(end);
      for (const a of ancestorsOf(model, end)) touched.add(a.id);
    }
  }
  return sortedValues(model.elements)
    .filter((el) => el.kind !== 'group' && !touched.has(el.id))
    .map((el) => ({ id: el.id, name: el.name, kind: el.kind }));
}

/**
 * Cada relación se "eleva" a los hermanos que separa: `accounts → db` (accounts dentro de api,
 * los dos dentro de banking) es una dependencia `api → db`. Así un ciclo que pasa por distintos
 * niveles aparece entre los elementos del nivel donde se cierra.
 */
function liftedEdge(model: Model, from: Id, to: Id): [Id, Id] | null {
  const a = [from, ...ancestorsOf(model, from).map((x) => x.id)];
  const b = [to, ...ancestorsOf(model, to).map((x) => x.id)];
  const common = a.find((x) => b.includes(x));
  // Uno contiene al otro: no es una dependencia entre hermanos.
  if (common === from || common === to) return null;
  const ia = common ? a.indexOf(common) - 1 : a.length - 1;
  const ib = common ? b.indexOf(common) - 1 : b.length - 1;
  return [a[ia]!, b[ib]!];
}

/**
 * Ciclos de dependencias (componentes fuertemente conexos, Tarjan) entre elementos hermanos.
 * Una relación bidireccional cuenta en los dos sentidos, pero un par unido solo por relaciones
 * bidireccionales no se reporta: es una dependencia mutua declarada.
 */
function findCycles(model: Model): CycleFinding[] {
  const succ = new Map<Id, Id[]>();
  const via = new Map<string, Set<Id>>();
  const add = (from: Id, to: Id, rel: Id) => {
    if (!model.elements[from] || !model.elements[to] || from === to) return;
    const edge = liftedEdge(model, from, to);
    if (!edge) return;
    const [a, b] = edge;
    const key = `${a}>${b}`;
    if (!via.has(key)) {
      via.set(key, new Set());
      succ.set(a, [...(succ.get(a) ?? []), b]);
    }
    via.get(key)!.add(rel);
  };
  for (const rel of sortedValues(model.relations)) {
    add(rel.from, rel.to, rel.id);
    if (rel.direction === 'bidirectional') add(rel.to, rel.from, rel.id);
  }

  let counter = 0;
  const index = new Map<Id, number>();
  const low = new Map<Id, number>();
  const stack: Id[] = [];
  const onStack = new Set<Id>();
  const components: Id[][] = [];

  // Versión iterativa: un modelo grande no debe agotar la pila de llamadas.
  for (const start of [...succ.keys()].sort()) {
    if (index.has(start)) continue;
    const work: { id: Id; next: number }[] = [{ id: start, next: 0 }];
    index.set(start, counter);
    low.set(start, counter++);
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1]!;
      const edges = succ.get(frame.id) ?? [];
      if (frame.next < edges.length) {
        const w = edges[frame.next++]!;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          onStack.add(w);
          work.push({ id: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(w)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      if (low.get(frame.id) === index.get(frame.id)) {
        const component: Id[] = [];
        let w: Id;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.id);
        if (component.length > 1) components.push(component.sort());
      }
    }
  }

  const out: CycleFinding[] = [];
  for (const elements of components) {
    const relationIds = new Set<Id>();
    for (const a of elements) for (const b of elements) for (const r of via.get(`${a}>${b}`) ?? []) relationIds.add(r);
    const relations = [...relationIds].sort();
    if (elements.length === 2 && relations.every((r) => model.relations[r]!.direction === 'bidirectional')) continue;
    out.push({ elements: orderCycle(elements, succ), relations });
  }
  return out.sort((a, b) => a.elements[0]!.localeCompare(b.elements[0]!));
}

/** Ordena los elementos del ciclo siguiendo las flechas (A → B → C), empezando por el menor ID. */
function orderCycle(elements: Id[], succ: ReadonlyMap<Id, Id[]>): Id[] {
  const set = new Set(elements);
  const out = [elements[0]!];
  const seen = new Set(out);
  for (;;) {
    const next = (succ.get(out[out.length - 1]!) ?? []).filter((n) => set.has(n) && !seen.has(n)).sort()[0];
    if (!next) break;
    out.push(next);
    seen.add(next);
  }
  return [...out, ...elements.filter((e) => !seen.has(e))];
}

function findMissingProtocols(model: Model): MissingProtocolFinding[] {
  const out: MissingProtocolFinding[] = [];
  for (const rel of sortedValues(model.relations)) {
    if (rel.protocols?.length) continue;
    const from = model.elements[rel.from];
    const to = model.elements[rel.to];
    if (!from || !to) continue;
    // Entre componentes del mismo container la llamada es en proceso: no hay protocolo.
    if (from.kind === 'component' && to.kind === 'component' && from.parent && from.parent === to.parent) continue;
    out.push({
      relation: rel.id,
      from: rel.from,
      to: rel.to,
      name: `${from.name} → ${to.name}`,
      suggestions: suggestProtocols(to, '', 3).map((p) => p.id),
    });
  }
  return out;
}

function findHotspots(model: Model): Hotspot[] {
  // Quién depende de quién, propagado hacia los ancestros del destino (L1 ve lo de L2/L3).
  const dependents = new Map<Id, Set<Id>>();
  const depend = (source: Id, target: Id) => {
    for (const t of [target, ...ancestorsOf(model, target).map((a) => a.id)]) {
      if (t === source || ancestorsOf(model, source).some((a) => a.id === t)) continue;
      const set = dependents.get(t) ?? new Set<Id>();
      set.add(source);
      dependents.set(t, set);
    }
  };
  for (const rel of Object.values(model.relations)) {
    if (!model.elements[rel.from] || !model.elements[rel.to]) continue;
    depend(rel.from, rel.to);
    if (rel.direction === 'bidirectional') depend(rel.to, rel.from);
  }

  const out: Hotspot[] = [];
  for (const el of sortedValues(model.elements)) {
    if (el.kind === 'group') continue;
    const own = new Set(descendantsOf(model, el.id));
    const deps = [...(dependents.get(el.id) ?? [])].filter((d) => !own.has(d)).sort();
    const risk = 'risk' in el ? el.risk : undefined;
    const reasons: string[] = [];
    let score = 0;
    if (risk && RISK_WEIGHT[risk] >= RISK_WEIGHT.high) {
      score += RISK_WEIGHT[risk] * (1 + deps.length);
      reasons.push(`riesgo ${RISK_TEXT[risk]}`);
    } else if (risk === 'medium' && deps.length >= 3) {
      score += RISK_WEIGHT.medium * (1 + deps.length);
      reasons.push('riesgo medio');
    }
    if ((el.status === 'deprecated' || el.status === 'retired') && deps.length) {
      score += 3 * deps.length;
      reasons.push(`${el.status === 'deprecated' ? 'deprecado' : 'retirado'} y todavía lo usan ${deps.length}`);
    }
    if (!risk && deps.length >= 5) {
      score += deps.length;
      reasons.push(`sin riesgo declarado y lo usan ${deps.length}`);
    }
    if (!reasons.length) continue;
    if (deps.length) reasons.push(`${deps.length} ${deps.length === 1 ? 'dependiente' : 'dependientes'}`);
    const hotspot: Hotspot = { ...ref(model, el.id), dependents: deps, score, reasons };
    if (risk) hotspot.risk = risk;
    if (el.status) hotspot.status = el.status;
    out.push(hotspot);
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** El análisis como lista plana de diagnósticos (para mostrar en la terminal o en un editor). */
export function analysisDiagnostics(analysis: Analysis, model: Model): Diagnostic[] {
  const out: Diagnostic[] = [...analysis.violations];
  for (const o of analysis.orphans) {
    out.push({ severity: 'warning', code: 'orphan', message: `"${o.name}" no tiene relaciones (ni propias ni de sus hijos)`, entity: { type: 'element', id: o.id } });
  }
  for (const c of analysis.cycles) {
    const names = [...c.elements, c.elements[0]!].map((id) => model.elements[id]?.name ?? id).join(' → ');
    out.push({ severity: 'warning', code: 'cycle', message: `Ciclo de dependencias: ${names}`, entity: { type: 'relation', id: c.relations[0]! } });
  }
  for (const m of analysis.missingProtocols) {
    const hint = m.suggestions.length ? ` (sugeridos: ${m.suggestions.join(', ')})` : '';
    out.push({ severity: 'info', code: 'missing-protocol', message: `${m.name} no declara protocolos${hint}`, entity: { type: 'relation', id: m.relation } });
  }
  for (const h of analysis.hotspots) {
    out.push({ severity: 'info', code: 'risk-hotspot', message: `Hotspot "${h.name}": ${h.reasons.join(', ')}`, entity: { type: 'element', id: h.id } });
  }
  return out;
}
