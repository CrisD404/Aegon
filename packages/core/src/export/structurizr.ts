import { ancestorsOf, childrenOf, sortedValues, type Model } from '../model/index.ts';
import type { Element, Id, View } from '../schema/index.ts';
import { aliasMap, isExternalDeep, protocolsText, techText, viewsToExport } from './shared.ts';

/**
 * Exporta el workspace completo a Structurizr DSL: modelo jerárquico (person → softwareSystem →
 * container → component), grupos, relaciones explícitas (Structurizr deriva las implícitas) y
 * una vista por lienzo.
 *
 * - Una base de datos o bus dentro de un sistema es un `container` con tag `Database`/`Queue`;
 *   una base dentro de un container es un `component`; sin padre, un `softwareSystem`.
 * - En Structurizr un elemento está en un solo grupo: se usa el primero de `groups`.
 * - El despliegue va en un `deploymentEnvironment` por ambiente: los nodos sin `environments`
 *   (compartidos) se repiten en cada uno, con alias propios por ambiente.
 */

const q = (s: string | undefined) => `"${(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;

type DslType = 'person' | 'softwareSystem' | 'container' | 'component';

function dslType(model: Model, el: Element): DslType | null {
  if (el.kind === 'group' || el.kind === 'node' || el.kind === 'infra' || el.kind === 'instance') return null;
  if (el.kind === 'actor') return 'person';
  if (el.kind === 'system') return 'softwareSystem';
  if (el.kind === 'container') return 'container';
  if (el.kind === 'component') return 'component';
  const parent = el.parent ? model.elements[el.parent] : undefined;
  if (!parent) return 'softwareSystem';
  return parent.kind === 'container' ? 'component' : 'container';
}

function tagsOf(model: Model, el: Element): string[] {
  const tags: string[] = [];
  if (el.kind === 'store') tags.push('Database');
  if (el.kind === 'bus') tags.push('Queue');
  if (isExternalDeep(model, el)) tags.push('Externo');
  if (el.status === 'planned') tags.push('Planificado');
  if (el.status === 'deprecated') tags.push('Deprecado');
  for (const t of el.tags ?? []) tags.push(t);
  return tags;
}

export function toStructurizr(model: Model, viewId?: Id): string {
  const aliases = aliasMap(model);
  const a = (id: Id) => aliases.get(id)!;
  const out: string[] = [];
  const ws = model.workspace;
  out.push(`workspace ${q(ws.name)} ${q(ws.description)} {`, '');
  out.push('  model {');

  const emitted = new Set<Id>();
  const groupName = (el: Element) => {
    const g = el.groups?.map((id) => model.elements[id]).find((x) => x?.kind === 'group');
    return g?.name;
  };

  const emit = (el: Element, indent: string) => {
    const type = dslType(model, el);
    if (!type) return;
    emitted.add(el.id);
    const tags = tagsOf(model, el).join(',');
    const args =
      type === 'person' || type === 'softwareSystem'
        ? [q(el.name), q(el.description ?? (el.kind === 'actor' ? el.role : undefined))]
        : [q(el.name), q(el.description), q(techText(el))];
    if (tags) args.push(q(tags));
    const children = childrenOf(model, el.id).filter((c) => {
      const t = dslType(model, c);
      return type === 'softwareSystem' ? t === 'container' : type === 'container' ? t === 'component' : false;
    });
    const head = `${indent}${a(el.id)} = ${type} ${args.join(' ')}`;
    if (!children.length) {
      out.push(head);
      return;
    }
    out.push(`${head} {`);
    emitList(children, `${indent}  `);
    out.push(`${indent}}`);
  };

  /** Hermanos agrupados por su primer grupo (`group "AWS" { … }`). */
  const emitList = (elements: Element[], indent: string) => {
    const loose: Element[] = [];
    const grouped = new Map<string, Element[]>();
    for (const el of elements) {
      const g = groupName(el);
      if (g) grouped.set(g, [...(grouped.get(g) ?? []), el]);
      else loose.push(el);
    }
    for (const el of loose) emit(el, indent);
    for (const [name, members] of grouped) {
      out.push(`${indent}group ${q(name)} {`);
      for (const el of members) emit(el, `${indent}  `);
      out.push(`${indent}}`);
    }
  };

  const roots = sortedValues(model.elements).filter((el) => {
    if (!dslType(model, el)) return false;
    const parent = el.parent ? model.elements[el.parent] : undefined;
    return !parent;
  });
  emitList(roots, '    ');

  // Structurizr no admite relaciones entre un elemento y su propio padre/ancestro.
  const nested = (x: Id, y: Id) => ancestorsOf(model, y).some((p) => p.id === x);
  const relations = sortedValues(model.relations).filter(
    (r) => emitted.has(r.from) && emitted.has(r.to) && !nested(r.from, r.to) && !nested(r.to, r.from),
  );
  if (relations.length) out.push('');
  for (const rel of relations) {
    const tags = [rel.direction === 'bidirectional' ? 'Bidireccional' : '', rel.status === 'planned' ? 'Planificado' : '', ...(rel.tags ?? [])].filter(Boolean);
    const args = [q(rel.label ?? rel.description), q(protocolsText([rel]))];
    if (tags.length) args.push(q(tags.join(',')));
    out.push(`    ${a(rel.from)} -> ${a(rel.to)} ${args.join(' ')}`);
  }
  const deployment = deploymentBlocks(model, a, emitted);
  out.push(...deployment.lines);
  out.push('  }', '');

  out.push('  views {');
  for (const view of viewsToExport(model, viewId)) {
    const block = view.level === 'deployment' ? deploymentViewBlock(model, view, a, deployment.environments) : viewBlock(model, view, a, emitted);
    if (block) out.push(...block.map((l) => `    ${l}`), '');
  }
  out.push(
    '    styles {',
    '      element "Person" {',
    '        shape Person',
    '      }',
    '      element "Database" {',
    '        shape Cylinder',
    '      }',
    '      element "Queue" {',
    '        shape Pipe',
    '      }',
    '      element "Externo" {',
    '        background #9ca3af',
    '      }',
    '      relationship "Planificado" {',
    '        dashed true',
    '      }',
    '    }',
    '  }',
    '}',
  );
  return `${out.join('\n')}\n`;
}

function viewBlock(model: Model, view: View, a: (id: Id) => string, emitted: ReadonlySet<Id>): string[] | null {
  const allowed: Record<View['level'], DslType[]> = {
    1: ['person', 'softwareSystem'],
    2: ['person', 'softwareSystem', 'container'],
    3: ['person', 'softwareSystem', 'container', 'component'],
    deployment: [],
  };
  const scope = view.scope ? model.elements[view.scope] : undefined;
  let head: string;
  if (view.level === 1) head = `systemLandscape ${q(view.id)} ${q(view.name)} {`;
  else if (scope && emitted.has(scope.id) && dslType(model, scope) === (view.level === 2 ? 'softwareSystem' : 'container')) {
    head = `${view.level === 2 ? 'container' : 'component'} ${a(scope.id)} ${q(view.id)} ${q(view.name)} {`;
  } else return null;
  const include = Object.keys(view.nodes)
    .sort()
    .filter((id) => {
      const el = model.elements[id];
      if (!el || !emitted.has(id)) return false;
      const type = dslType(model, el);
      if (!type || !allowed[view.level].includes(type)) return false;
      // En una vista de componentes solo entran los componentes del container abierto.
      return !(view.level === 3 && type === 'component' && el.parent !== view.scope);
    })
    .map(a);
  if (!include.length) return null;
  return [head, `  include ${include.join(' ')}`, '  autoLayout', '}'];
}

const inEnvironment = (el: Element, env: Id) => !el.environments || el.environments.includes(env);

/**
 * `deploymentEnvironment` por cada ambiente que tenga elementos de despliegue: nodos anidados,
 * nodos de infraestructura e instancias, y las relaciones entre ellos (con alias por ambiente).
 */
function deploymentBlocks(model: Model, a: (id: Id) => string, emitted: ReadonlySet<Id>): { lines: string[]; environments: ReadonlyMap<Id, string> } {
  const lines: string[] = [];
  const environments = new Map<Id, string>();
  const deploymentEls = sortedValues(model.elements).filter((el) => el.kind === 'node' || el.kind === 'infra' || el.kind === 'instance');
  if (!deploymentEls.length) return { lines, environments };
  const envs = (model.workspace.environments ?? []).filter((env) => deploymentEls.some((el) => el.environments?.includes(env.id)) || Object.values(model.views).some((v) => v.level === 'deployment' && v.environment === env.id));
  for (const env of envs) {
    const alias = (id: Id) => `${a(id)}_${env.id.replace(/[^A-Za-z0-9_]/g, '_')}`;
    environments.set(env.id, env.name);
    const placed = new Set<Id>();
    const block: string[] = [];
    const emitNode = (el: Element, indent: string) => {
      if (!inEnvironment(el, env.id)) return;
      if (el.kind === 'instance') {
        const target = model.elements[el.instance.of];
        if (!target || !emitted.has(target.id)) return;
        const type = dslType(model, target);
        const keyword = type === 'container' ? 'containerInstance' : type === 'softwareSystem' ? 'softwareSystemInstance' : null;
        if (!keyword) return;
        placed.add(el.id);
        block.push(`${indent}${alias(el.id)} = ${keyword} ${a(target.id)}`);
        return;
      }
      if (el.kind === 'infra') {
        placed.add(el.id);
        block.push(`${indent}${alias(el.id)} = infrastructureNode ${q(el.name)} ${q(deploymentDescription(el))} ${q(techText(el) || el.infra.type)}`);
        return;
      }
      if (el.kind !== 'node') return;
      placed.add(el.id);
      const tech = [techText(el), el.node.size].filter(Boolean).join(', ') || el.node.type;
      const instances = el.node.instances && el.node.instances > 1 ? ` ${el.node.instances}` : '';
      block.push(`${indent}${alias(el.id)} = deploymentNode ${q(el.name)} ${q(deploymentDescription(el))} ${q(tech)}${instances ? ` "" ${instances.trim()}` : ''} {`);
      for (const child of childrenOf(model, el.id)) emitNode(child, `${indent}  `);
      block.push(`${indent}}`);
    };
    const roots = deploymentEls.filter((el) => !el.parent || !model.elements[el.parent]);
    for (const root of roots) emitNode(root, '      ');
    if (!placed.size) continue;
    // Relaciones con algún extremo de despliegue (las lógicas entre contenedores las deriva Structurizr).
    const rels = sortedValues(model.relations).filter((r) => {
      const ends = [r.from, r.to].map((id) => model.elements[id]);
      if (!ends.some((e) => e && (e.kind === 'node' || e.kind === 'infra' || e.kind === 'instance'))) return false;
      return [r.from, r.to].every((id) => placed.has(id));
    });
    for (const r of rels) block.push(`      ${alias(r.from)} -> ${alias(r.to)} ${q(r.label ?? r.description)} ${q(protocolsText([r]))}`);
    lines.push('', `    deploymentEnvironment ${q(env.name)} {`, ...block, '    }');
  }
  return { lines, environments };
}

function deploymentDescription(el: Element): string {
  const parts: string[] = [];
  if (el.description) parts.push(el.description);
  if ('addresses' in el && el.addresses?.length) parts.push(el.addresses.join(', '));
  if ('resource' in el && el.resource) parts.push(el.resource);
  return parts.join(' · ');
}

function deploymentViewBlock(model: Model, view: View, a: (id: Id) => string, environments: ReadonlyMap<Id, string>): string[] | null {
  const envName = view.environment ? environments.get(view.environment) : undefined;
  if (!envName) return null;
  const scope = view.scope && model.elements[view.scope]?.kind === 'system' ? a(view.scope) : '*';
  return [`deployment ${scope} ${q(envName)} ${q(view.id)} ${q(view.name)} {`, '  include *', '  autoLayout', '}'];
}
