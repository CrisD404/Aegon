import { deepEqual } from '../diff/index.ts';
import type { Model } from '../model/index.ts';
import type { ElementPatch, Op } from '../ops/index.ts';
import type { Element, ElementKind, Environment, FinOpsSettings, GroupProvider, Id } from '../schema/index.ts';

/**
 * FinOps y ambientes: costos mensuales por elemento y ambiente, agregados por jerarquía (un
 * sistema suma sus contenedores y componentes), por grupo (cloud, cuenta, datacenter), por
 * ambiente y por etiqueta. Lo usan el lienzo, el panel de costos y el export CSV.
 */

export const DEFAULT_CURRENCY = 'USD';

/** Ambientes que se proponen al configurar un workspace sin ambientes. */
export const SUGGESTED_ENVIRONMENTS: readonly Environment[] = [
  { id: 'dev', name: 'Desarrollo' },
  { id: 'qa', name: 'QA' },
  { id: 'pre', name: 'Preproducción' },
  { id: 'prod', name: 'Producción' },
];

export const SUGGESTED_TAG_KEYS: readonly string[] = ['cost-center', 'project', 'business-unit', 'owner'];

export const CURRENCIES: readonly string[] = ['USD', 'EUR', 'ARS', 'BRL', 'CLP', 'COP', 'MXN', 'PEN', 'UYU', 'GBP'];

/** Tipos que pueden tener costos (los actores no). */
export const COSTED_KINDS: readonly ElementKind[] = ['system', 'container', 'component', 'store', 'bus', 'group'];

export function environmentsOf(model: Model): readonly Environment[] {
  return model.workspace.environments ?? [];
}

export function currencyOf(model: Model): string {
  return model.workspace.finops?.currency ?? DEFAULT_CURRENCY;
}

/** ¿Está desplegado en ese ambiente? Sin `environments`, el elemento está en todos. */
export function deployedIn(el: Element, env: Id): boolean {
  return !el.environments || el.environments.includes(env);
}

/**
 * Costo mensual propio (sin hijos) en un ambiente, o la suma de todos los ambientes del workspace
 * con `env = null`. Un costo cargado para un ambiente donde no está desplegado no cuenta.
 */
export function ownCost(model: Model, el: Element, env: Id | null): number {
  const costs = el.finops?.costs;
  if (!costs) return 0;
  if (env) return deployedIn(el, env) ? (costs[env]?.monthly ?? 0) : 0;
  let sum = 0;
  for (const e of environmentsOf(model)) if (deployedIn(el, e.id)) sum += costs[e.id]?.monthly ?? 0;
  return sum;
}

export interface CostTotals {
  /** Costo propio del elemento. */
  own: number;
  /** Propio + descendientes (para un grupo: sus miembros y lo que contienen, sin contar dos veces). */
  total: number;
}

/** Costos propios y acumulados de todos los elementos, para un ambiente (o todos con `null`). */
export function costRollup(model: Model, env: Id | null): Map<Id, CostTotals> {
  const own = new Map<Id, number>();
  const children = new Map<Id, Id[]>();
  const members = new Map<Id, Id[]>();
  const subgroups = new Map<Id, Id[]>();
  for (const el of Object.values(model.elements)) {
    own.set(el.id, ownCost(model, el, env));
    if (el.parent) {
      if (el.kind === 'group') subgroups.set(el.parent, [...(subgroups.get(el.parent) ?? []), el.id]);
      else children.set(el.parent, [...(children.get(el.parent) ?? []), el.id]);
    }
    for (const g of el.groups ?? []) members.set(g, [...(members.get(g) ?? []), el.id]);
  }

  const out = new Map<Id, CostTotals>();
  const hierarchyTotal = (id: Id, seen = new Set<Id>()): number => {
    const cached = out.get(id);
    if (cached) return cached.total;
    if (seen.has(id)) return 0;
    seen.add(id);
    let total = own.get(id) ?? 0;
    for (const c of children.get(id) ?? []) total += hierarchyTotal(c, seen);
    out.set(id, { own: own.get(id) ?? 0, total });
    return total;
  };
  const withDescendants = (id: Id, into: Set<Id>) => {
    if (into.has(id)) return;
    into.add(id);
    for (const c of children.get(id) ?? []) withDescendants(c, into);
  };

  for (const el of Object.values(model.elements)) {
    if (el.kind !== 'group') hierarchyTotal(el.id);
  }
  for (const el of Object.values(model.elements)) {
    if (el.kind !== 'group') continue;
    // Miembros del grupo y de sus subgrupos, con todo lo que contienen.
    const covered = new Set<Id>();
    const queue = [el.id];
    const visited = new Set<Id>();
    while (queue.length) {
      const g = queue.pop()!;
      if (visited.has(g)) continue;
      visited.add(g);
      covered.add(g);
      for (const m of members.get(g) ?? []) withDescendants(m, covered);
      queue.push(...(subgroups.get(g) ?? []));
    }
    let total = 0;
    for (const id of covered) total += own.get(id) ?? 0;
    out.set(el.id, { own: own.get(el.id) ?? 0, total });
  }
  return out;
}

export interface CostLine {
  id: Id;
  name: string;
  kind: ElementKind;
  total: number;
  provider?: GroupProvider;
}

export interface CostSummary {
  currency: string;
  environments: readonly Environment[];
  /** Ambiente filtrado (null = todos). */
  environment: Id | null;
  total: number;
  byEnvironment: { id: Id; name: string; total: number; budget?: number }[];
  /** Elementos de primer nivel (sin padre) con costo, de mayor a menor. */
  bySystem: CostLine[];
  /** Grupos de primer nivel (cloud, datacenter…) con costo. */
  byGroup: CostLine[];
  /** Por clave de etiqueta FinOps: total por valor (lo que no tiene la etiqueta va en "—"). */
  byTag: Record<string, { value: string; total: number }[]>;
  /** Elementos con mayor costo propio. */
  top: CostLine[];
  /** Elementos que se pueden costear, desplegados en el filtro, sin ningún costo cargado. */
  missing: Id[];
}

export function costSummary(model: Model, env: Id | null): CostSummary {
  const environments = environmentsOf(model);
  const rollup = costRollup(model, env);
  const elements = Object.values(model.elements);
  const costed = elements.filter((el) => COSTED_KINDS.includes(el.kind));
  const line = (el: Element, total: number): CostLine => ({
    id: el.id,
    name: el.name,
    kind: el.kind,
    total,
    ...(el.kind === 'group' ? { provider: el.group.provider } : {}),
  });
  const desc = (a: CostLine, b: CostLine) => b.total - a.total || a.name.localeCompare(b.name);

  const total = costed.reduce((sum, el) => sum + (rollup.get(el.id)?.own ?? 0), 0);
  const budgets = model.workspace.finops?.budgets ?? {};
  const byEnvironment = environments.map((e) => {
    const sum = costed.reduce((acc, el) => acc + ownCost(model, el, e.id), 0);
    return { id: e.id, name: e.name, total: sum, ...(budgets[e.id] !== undefined ? { budget: budgets[e.id] } : {}) };
  });

  const bySystem = costed
    .filter((el) => el.kind !== 'group' && !el.parent)
    .map((el) => line(el, rollup.get(el.id)?.total ?? 0))
    .filter((l) => l.total > 0)
    .sort(desc);
  const byGroup = costed
    .filter((el) => el.kind === 'group' && !(el.parent && model.elements[el.parent]?.kind === 'group'))
    .map((el) => line(el, rollup.get(el.id)?.total ?? 0))
    .filter((l) => l.total > 0)
    .sort(desc);

  const byTag: Record<string, Map<string, number>> = {};
  const keys = new Set<string>(model.workspace.finops?.tagKeys ?? []);
  for (const el of costed) for (const k of Object.keys(el.finops?.tags ?? {})) keys.add(k);
  for (const key of keys) byTag[key] = new Map();
  for (const el of costed) {
    const own = rollup.get(el.id)?.own ?? 0;
    if (!own) continue;
    for (const key of keys) {
      const value = tagOf(model, el, key) ?? '—';
      byTag[key]!.set(value, (byTag[key]!.get(value) ?? 0) + own);
    }
  }

  const top = costed
    .map((el) => line(el, rollup.get(el.id)?.own ?? 0))
    .filter((l) => l.total > 0)
    .sort(desc)
    .slice(0, 10);

  const ancestorHasCost = (el: Element): boolean => {
    let parent = el.parent ? model.elements[el.parent] : undefined;
    const seen = new Set<Id>();
    while (parent && !seen.has(parent.id)) {
      if ((rollup.get(parent.id)?.own ?? 0) > 0) return true;
      seen.add(parent.id);
      parent = parent.parent ? model.elements[parent.parent] : undefined;
    }
    return false;
  };
  const missing = environments.length
    ? costed
        .filter((el) => el.kind !== 'group' && el.scope !== 'external')
        .filter((el) => (env ? deployedIn(el, env) && !el.finops?.costs?.[env] : !Object.keys(el.finops?.costs ?? {}).length))
        // Si un hijo tiene costo, el padre no falta (el costo está más abajo); si un ancestro tiene
        // costo, el hijo tampoco (ej. los componentes de un contenedor que ya está costeado).
        .filter((el) => (rollup.get(el.id)?.total ?? 0) === 0 && !ancestorHasCost(el))
        .map((el) => el.id)
    : [];

  return {
    currency: currencyOf(model),
    environments,
    environment: env,
    total,
    byEnvironment,
    bySystem,
    byGroup,
    byTag: Object.fromEntries(
      Object.entries(byTag).map(([k, m]) => [k, [...m].map(([value, t]) => ({ value, total: t })).sort((a, b) => b.total - a.total)]),
    ),
    top,
    missing,
  };
}

/** Etiqueta FinOps efectiva: la propia o, si no tiene, la del ancestro más cercano. */
export function tagOf(model: Model, el: Element, key: string): string | undefined {
  let current: Element | undefined = el;
  const seen = new Set<Id>();
  while (current && !seen.has(current.id)) {
    const value = current.finops?.tags?.[key];
    if (value) return value;
    seen.add(current.id);
    current = current.parent ? model.elements[current.parent] : undefined;
  }
  return undefined;
}

const csvCell = (v: string | number | undefined) => {
  if (v === undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Una fila por elemento y ambiente con costo cargado (para planillas y herramientas de FinOps). */
export function costsCsv(model: Model): string {
  const environments = environmentsOf(model);
  const envName = new Map(environments.map((e) => [e.id, e.name]));
  const elements = Object.values(model.elements).filter((el) => el.finops?.costs);
  const tagKeys = new Set<string>(model.workspace.finops?.tagKeys ?? []);
  for (const el of Object.values(model.elements)) for (const k of Object.keys(el.finops?.tags ?? {})) tagKeys.add(k);
  const keys = [...tagKeys].sort();
  const header = ['id', 'nombre', 'tipo', 'padre', 'sistema', 'ambiente', 'ambiente_nombre', 'costo_mensual', 'moneda', 'replicas', 'sku', 'nota', ...keys.map((k) => `tag:${k}`)];
  const rows = [header.join(',')];
  const topOf = (el: Element) => {
    let current = el;
    const seen = new Set<Id>();
    while (current.parent && model.elements[current.parent] && !seen.has(current.id)) {
      seen.add(current.id);
      current = model.elements[current.parent]!;
    }
    return current;
  };
  const currency = currencyOf(model);
  const order = new Map(environments.map((e, i) => [e.id, i]));
  for (const el of elements.sort((a, b) => a.id.localeCompare(b.id))) {
    const entries = Object.entries(el.finops!.costs!).sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b));
    for (const [env, cost] of entries) {
      if (!deployedIn(el, env)) continue;
      rows.push(
        [
          el.id,
          el.name,
          el.kind,
          el.parent,
          topOf(el).id,
          env,
          envName.get(env) ?? env,
          cost.monthly,
          currency,
          cost.replicas,
          cost.sku,
          cost.note,
          ...keys.map((k) => tagOf(model, el, k)),
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return `${rows.join('\n')}\n`;
}

export interface FinOpsSettingsDraft {
  environments: Environment[];
  currency: string;
  tagKeys: string[];
  budgets: Record<Id, number>;
}

/** Elementos que usan un ambiente (despliegue o costos). */
export function elementsUsingEnvironment(model: Model, env: Id): Element[] {
  return Object.values(model.elements).filter((el) => el.environments?.includes(env) || el.finops?.costs?.[env]);
}

/**
 * Ops para guardar la configuración de ambientes y costos. Los ambientes que se quitan se
 * limpian de los elementos (despliegue y costos) para que no queden referencias colgantes.
 */
export function finopsSettingsOps(model: Model, draft: FinOpsSettingsDraft): Op[] {
  const keep = new Set(draft.environments.map((e) => e.id));
  const removed = environmentsOf(model).filter((e) => !keep.has(e.id)).map((e) => e.id);
  const ops: Op[] = [];
  for (const el of Object.values(model.elements)) {
    if (!removed.some((env) => el.environments?.includes(env) || el.finops?.costs?.[env])) continue;
    const patch: Record<string, unknown> = {};
    if (el.environments) patch.environments = el.environments.filter((e) => keep.has(e));
    if (el.finops?.costs) {
      const costs = Object.fromEntries(Object.entries(el.finops.costs).filter(([env]) => keep.has(env)));
      const finops = { ...el.finops, costs: Object.keys(costs).length ? costs : undefined };
      if (!finops.costs) delete finops.costs;
      patch.finops = Object.keys(finops).length ? finops : null;
    }
    ops.push({ type: 'element.update', id: el.id, patch: patch as ElementPatch });
  }
  const budgets = Object.fromEntries(Object.entries(draft.budgets).filter(([env, v]) => keep.has(env) && Number.isFinite(v)));
  const finops: FinOpsSettings = {
    // USD es el default: se escribe solo si se eligió otra moneda o ya estaba escrita.
    ...(draft.currency && (draft.currency !== DEFAULT_CURRENCY || model.workspace.finops?.currency) ? { currency: draft.currency } : {}),
    ...(draft.tagKeys.length ? { tagKeys: draft.tagKeys } : {}),
    ...(Object.keys(budgets).length ? { budgets } : {}),
  };
  const patch = {
    environments: draft.environments.length ? draft.environments : null,
    finops: Object.keys(finops).length ? finops : null,
  };
  if (!deepEqual(patch.environments, model.workspace.environments ?? null) || !deepEqual(patch.finops, model.workspace.finops ?? null)) {
    ops.push({ type: 'workspace.update', patch });
  }
  return ops;
}
