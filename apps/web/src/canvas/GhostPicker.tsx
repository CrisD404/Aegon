import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { useStore } from '@xyflow/react';
import {
  DB_ENGINES,
  MESSAGE_BROKERS,
  GROUP_PROVIDER_CATALOG,
  INFRA_TYPE_LABEL,
  KINDS_FOR_LEVEL,
  KIND_DESCRIPTION,
  KIND_EXAMPLES,
  KIND_LABEL,
  NODE_TYPE_LABEL,
  blockProblem,
  indexOf,
  newElement,
  instancesOf,
  placeableElements,
  searchCatalog,
  sizeOf,
  sortedValues,
  suggestDeploymentTypes,
  templateStats,
  viewsContaining,
  type Element,
  type ElementKind,
  type Id,
  type View,
} from '@aegon/core';
import { Glyph, TechIcon } from '@aegon/icons';
import { CornerDownLeft, LayoutTemplate, Link2, Search } from 'lucide-react';
import { useUi, type GhostState } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { allTemplates, useTemplates } from '../store/templates.ts';
import { createElementAt, deployAt, placeExisting } from '../lib/actions.ts';
import { insertTemplate } from '../lib/flows.tsx';
import { elementIcon, kindCaption } from './nodes/ElementNode.tsx';
import { INFRA_TYPE_ICON, NODE_TYPE_ICON } from './nodes/deployment-icons.tsx';
import { Kbd } from '../ui/primitives.tsx';
import { GhostPreview, type GhostPreviewData } from './GhostPreview.tsx';

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Cuántos elementos del modelo se muestran sin buscar (el resto aparece buscando). */
const EXISTING_PREVIEW = 4;
export const GHOST_PANEL_WIDTH = 440;
const PANEL_WIDTH = GHOST_PANEL_WIDTH;
/** Margen contra los bordes del lienzo y alto del input + pie del panel. */
const EDGE = 12;
const CHROME_H = 82;
/** Id de los elementos de mentira que dibuja la vista previa (nunca entran al modelo). */
const GHOST_ID = '__ghost';

/** Qué tan bien coincide un nombre con lo escrito: exacto 4, empieza 3, alguna palabra empieza 2.5, contiene 2. */
function matchScore(e: Element, nq: string): number {
  const name = normalize(e.name);
  if (name === nq) return 4;
  if (name.startsWith(nq)) return 3;
  if (name.split(/[\s\-_.,·()/]+/).some((w) => w.startsWith(nq))) return 2.5;
  if (name.includes(nq)) return 2;
  return e.id.includes(nq) ? 1 : 0;
}

/**
 * Componente fantasma: aparece con doble click en el lienzo (o con "Agregar" / N). Hace dos cosas,
 * cada una en su sección: **crear** un elemento nuevo eligiendo su tipo (con qué es y ejemplos) o
 * **reutilizar** uno que ya está en el modelo (se ubica en este lienzo, no se duplica). Lo que se
 * escribe es a la vez el nombre del nuevo y la búsqueda en el modelo: si coincide con elementos
 * existentes, esos van primero y Enter reutiliza en lugar de crear un duplicado.
 */
export function GhostPicker({ ghost, view }: { ghost: GhostState; view: View }) {
  const zoom = useStore((s) => s.transform[2]);
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);
  const model = useWorkspace((s) => s.model);
  const setGhost = useUi((s) => s.setGhost);
  const [query, setQuery] = useState('');
  const close = () => setGhost(null);
  const q = query.trim();
  const nq = normalize(query);
  const deployment = view.level === 'deployment';

  const kinds = useMemo(() => {
    const allowed = KINDS_FOR_LEVEL[view.level];
    return ghost.kind && allowed.includes(ghost.kind)
      ? [ghost.kind, ...allowed.filter((k) => k !== ghost.kind)]
      : [...allowed];
  }, [ghost.kind, view.level]);
  // Una instancia no se crea de la nada: se elige qué desplegar (sección "Desplegar").
  const creatable = (ghost.connectFrom ? kinds.filter((k) => k !== 'group') : kinds).filter(
    (k) => k !== 'instance',
  );

  // Elementos del modelo que se pueden traer a este lienzo. Sin buscar, primero los que se
  // relacionan con lo que ya está en el lienzo (los más probables); buscando, por coincidencia.
  const { existing, strong } = useMemo(() => {
    const list = placeableElements(model, view).filter(
      (e) => !(ghost.connectFrom && e.kind === 'group'),
    );
    if (nq) {
      const scored = list
        .map((e) => ({ e, score: matchScore(e, nq) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
      return { existing: scored.map((x) => x.e), strong: scored.some((x) => x.score >= 2.5) };
    }
    const idx = indexOf(model);
    const placed = new Set(Object.keys(view.nodes));
    const related = (id: Id) =>
      [...(idx.relationsFrom.get(id) ?? []), ...(idx.relationsTo.get(id) ?? [])].filter((r) => {
        const rel = model.relations[r];
        return !!rel && (placed.has(rel.from) || placed.has(rel.to));
      }).length;
    const sorted = list
      .map((e) => ({ e, r: related(e.id) }))
      .sort((a, b) => b.r - a.r || a.e.name.localeCompare(b.e.name))
      .map((x) => x.e);
    return { existing: sorted, strong: false };
  }, [model, view, nq, ghost.connectFrom]);
  const shownExisting = existing.slice(0, nq ? 8 : EXISTING_PREVIEW);
  const hiddenExisting = existing.length - shownExisting.length;
  // Lo escrito coincide con algo que ya existe: eso va primero (Enter lo reutiliza).
  const existingFirst = strong;

  // Despliegue: contenedores, bases y buses de los sistemas propios; primero los que todavía no
  // tienen instancia en el ambiente del lienzo.
  const deployable = useMemo(() => {
    if (!deployment) return [];
    return sortedValues(model.elements)
      .filter(
        (e) =>
          (e.kind === 'container' || e.kind === 'store' || e.kind === 'bus') &&
          e.scope !== 'external',
      )
      .filter(
        (e) =>
          !view.scope ||
          e.parent === view.scope ||
          model.elements[e.parent ?? '']?.parent === view.scope,
      )
      .filter((e) => !nq || normalize(e.name).includes(nq))
      .map((e) => ({ e, deployed: instancesOf(model, e.id, view.environment).length }))
      .sort(
        (a, b) =>
          Number(a.deployed > 0) - Number(b.deployed > 0) || a.e.name.localeCompare(b.e.name),
      )
      .slice(0, 8);
  }, [deployment, model, view.scope, view.environment, nq]);

  // Bloques de templates que entran en este nivel (API gateway, event-driven, los del usuario…).
  const userTemplates = useTemplates((s) => s.user);
  const blocks = useMemo(() => {
    if (ghost.connectFrom) return [];
    return allTemplates(userTemplates)
      .filter((t) => t.kind === 'block' && !blockProblem(t, view))
      .filter(
        (t) => !nq || normalize(t.name).includes(nq) || normalize(t.description ?? '').includes(nq),
      )
      .slice(0, nq ? 6 : 3);
  }, [userTemplates, view, nq, ghost.connectFrom]);

  // Sugerencias del catálogo según lo que se escribe ("mongo" → base MongoDB, "vpc" → red).
  const deployTypes = deployment ? suggestDeploymentTypes(q) : { nodes: [], infra: [] };
  const engines =
    creatable.includes('store') && q.length >= 2 ? searchCatalog(DB_ENGINES, q, 3) : [];
  const brokers =
    creatable.includes('bus') && q.length >= 2 ? searchCatalog(MESSAGE_BROKERS, q, 3) : [];
  const providers =
    creatable.includes('group') && q.length >= 2
      ? GROUP_PROVIDER_CATALOG.filter(
          (p) =>
            p.id !== 'other' &&
            [p.name.toLowerCase(), p.id, ...(p.keywords ?? [])].some((h) =>
              h.startsWith(q.toLowerCase()),
            ),
        ).slice(0, 2)
      : [];
  const suggestions =
    deployTypes.nodes.length +
    deployTypes.infra.length +
    engines.length +
    brokers.length +
    providers.length;

  const create = (kind: ElementKind, name: string, fields?: Partial<Element>) => {
    close();
    createElementAt(kind, name, ghost.flow, { connectFrom: ghost.connectFrom, fields });
  };
  const pick = (id: string) => {
    close();
    placeExisting(id, ghost.flow, { connectFrom: ghost.connectFrom });
  };
  const deploy = (id: string) => {
    close();
    deployAt(id, ghost.flow, { connectFrom: ghost.connectFrom });
  };

  // El fantasma muestra la opción resaltada (con el teclado o pasando el mouse): el tipo con
  // ejemplos, el motor elegido, el elemento existente, la instancia o el bloque de template.
  const [active, setActive] = useState('');
  const preview = ((): GhostPreviewData => {
    const sep = active.indexOf(':');
    const type = sep > 0 ? active.slice(0, sep) : '';
    const id = sep > 0 ? active.slice(sep + 1) : '';
    const fake = (
      kind: ElementKind,
      name: string,
      fields: Partial<Element> = {},
    ): GhostPreviewData => ({
      type: 'element',
      key: active || `create:${kind}`,
      el: newElement(model, kind, name, { ...fields, id: GHOST_ID } as Partial<Element>),
      examples: name ? undefined : KIND_EXAMPLES[kind],
      tag: name ? 'Nuevo' : `Nuevo · ${KIND_LABEL[kind]}`,
    });
    if (type === 'existing' && model.elements[id]) {
      const el = model.elements[id]!;
      const target = el.kind === 'instance' ? model.elements[el.instance.of] : undefined;
      return { type: 'element', key: active, el, target, tag: 'Ya existe · se ubica acá' };
    }
    if (type === 'deploy' && model.elements[id]) {
      const target = model.elements[id]!;
      const el = newElement(model, 'instance', target.name, {
        id: GHOST_ID,
        instance: { of: id },
      } as Partial<Element>);
      return { type: 'element', key: active, el, target, tag: 'Instancia nueva' };
    }
    if (type === 'template') {
      const t = blocks.find((b) => b.id === id || b.id.toLowerCase() === id);
      if (t)
        return {
          type: 'template',
          key: active,
          name: t.name,
          elements: templateStats(t).elements,
          tag: 'Bloque de template',
        };
    }
    const engine = type === 'engine' ? engines.find((e) => e.id === id) : undefined;
    if (engine)
      return fake('store', engine.name, {
        store: { engine: engine.id, type: engine.type },
      } as Partial<Element>);
    const broker = type === 'broker' ? brokers.find((b) => b.id === id) : undefined;
    if (broker)
      return fake('bus', broker.name, {
        bus: { broker: broker.id, type: broker.type },
      } as Partial<Element>);
    const provider = type === 'provider' ? providers.find((p) => p.id === id) : undefined;
    if (provider)
      return fake('group', provider.name, { group: { provider: provider.id } } as Partial<Element>);
    if (type === 'node') return fake('node', q, { node: { type: id } } as Partial<Element>);
    if (type === 'infra') return fake('infra', q, { infra: { type: id } } as Partial<Element>);
    const kind =
      type === 'create' && (creatable as readonly ElementKind[]).includes(id as ElementKind)
        ? (id as ElementKind)
        : (creatable[0] ?? 'system');
    return fake(kind, q);
  })();

  // El panel va al costado del fantasma y siempre dentro del lienzo (si se sale, el lienzo
  // scrollea al enfocar el input). El alto se acota con el máximo de la lista para que no salte
  // mientras se escribe.
  const primary = sizeOf({ kind: creatable[0] ?? 'system' });
  const rect = { w: primary.w * zoom, h: primary.h * zoom };
  const listMax = Math.max(160, Math.min(540, paneH - 2 * EDGE - CHROME_H));
  const right = ghost.screen.x + rect.w / 2 + 14;
  const left = ghost.screen.x - rect.w / 2 - 14 - PANEL_WIDTH;
  const panelLeft =
    right + PANEL_WIDTH <= paneW - EDGE
      ? right
      : left >= EDGE
        ? left
        : Math.max(EDGE, Math.min(right, paneW - EDGE - PANEL_WIDTH));
  const panelTop = Math.max(
    EDGE,
    Math.min(ghost.screen.y - rect.h / 2, paneH - EDGE - CHROME_H - listMax),
  );
  const parentName = (e: Element) => (e.parent ? model.elements[e.parent]?.name : undefined);

  const existingGroup = (
    <Command.Group
      heading={
        <GroupHeading
          title={nq ? 'En el modelo' : 'Ya en el modelo'}
          count={existing.length}
          hint="se ubica acá, no se duplica"
          tone="accent"
        />
      }
      className="ghost-group ghost-group--existing"
      data-testid="ghost-existing"
    >
      {shownExisting.map((e, i) => {
        const { icon, label } = elementIcon(e);
        const views = viewsContaining(model, e.id).length;
        return (
          <Command.Item
            key={e.id}
            value={`existing:${e.id}`}
            onSelect={() => pick(e.id)}
            className="ghost-item ghost-item--tall"
            data-testid={`ghost-existing-${e.id}`}
          >
            <span className="ghost-chip" style={{ ['--kind' as string]: `var(--kind-${e.kind})` }}>
              <TechIcon icon={icon} label={label} size={14} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-fg">{e.name}</span>
              <span className="truncate text-[11px] text-fg-subtle">
                {[kindCaption(e), parentName(e)].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="ghost-badge">
              {!views ? 'sin lienzo' : views === 1 ? 'en 1 lienzo' : `en ${views} lienzos`}
            </span>
            {existingFirst && i === 0 ? (
              <CornerDownLeft size={12} className="shrink-0 text-fg-subtle" />
            ) : null}
          </Command.Item>
        );
      })}
      {!existing.length ? (
        <div className="ghost-note">
          Todo lo del modelo que va en este nivel ya está en el lienzo.
        </div>
      ) : null}
      {hiddenExisting > 0 ? (
        <div className="ghost-note">
          {nq
            ? `y ${hiddenExisting} más: seguí escribiendo para acotar`
            : `y ${hiddenExisting} más: escribí para buscarlos por nombre`}
        </div>
      ) : null}
    </Command.Group>
  );

  const createGroup = (
    <Command.Group
      heading={
        <GroupHeading
          title={q ? `Crear «${q}» como…` : 'Crear nuevo'}
          hint={q ? undefined : 'elegí el tipo; el nombre va arriba'}
        />
      }
      className="ghost-group"
    >
      {deployTypes.nodes.map((t) => {
        const Icon = NODE_TYPE_ICON[t];
        return (
          <Command.Item
            key={`node:${t}`}
            value={`node:${t}`}
            onSelect={() => create('node', q, { node: { type: t } } as Partial<Element>)}
            className="ghost-item"
          >
            <Icon size={15} className="text-[var(--kind-node)]" />
            <span className="truncate">
              {NODE_TYPE_LABEL[t]} <span className="text-fg">“{q}”</span>
            </span>
          </Command.Item>
        );
      })}
      {deployTypes.infra.map((t) => {
        const Icon = INFRA_TYPE_ICON[t];
        return (
          <Command.Item
            key={`infra:${t}`}
            value={`infra:${t}`}
            onSelect={() => create('infra', q, { infra: { type: t } } as Partial<Element>)}
            className="ghost-item"
          >
            <Icon size={15} className="text-[var(--kind-infra)]" />
            <span className="truncate">
              {INFRA_TYPE_LABEL[t]} <span className="text-fg">“{q}”</span>
            </span>
          </Command.Item>
        );
      })}
      {brokers.map((broker) => (
        <Command.Item
          key={broker.id}
          value={`broker:${broker.id}`}
          onSelect={() =>
            create('bus', broker.name, {
              bus: { broker: broker.id, type: broker.type },
            } as Partial<Element>)
          }
          className="ghost-item"
        >
          <TechIcon icon={broker.icon} label={broker.name} size={15} />
          <span className="truncate">
            Bus de mensajería <span className="text-fg">{broker.name}</span>
          </span>
        </Command.Item>
      ))}
      {engines.map((engine) => (
        <Command.Item
          key={engine.id}
          value={`engine:${engine.id}`}
          onSelect={() =>
            create('store', engine.name, {
              store: { engine: engine.id, type: engine.type },
            } as Partial<Element>)
          }
          className="ghost-item"
        >
          <TechIcon icon={engine.icon} label={engine.name} size={15} />
          <span className="truncate">
            Base de datos <span className="text-fg">{engine.name}</span>
          </span>
        </Command.Item>
      ))}
      {providers.map((p) => (
        <Command.Item
          key={p.id}
          value={`provider:${p.id}`}
          onSelect={() =>
            create('group', p.name, { group: { provider: p.id } } as Partial<Element>)
          }
          className="ghost-item"
        >
          <TechIcon icon={p.icon} label={p.name} size={15} />
          <span className="truncate">
            Grupo <span className="text-fg">{p.name}</span>
          </span>
        </Command.Item>
      ))}
      <div className={q ? 'flex flex-col' : 'ghost-kinds'}>
        {creatable.map((kind, i) => (
          <Command.Item
            key={kind}
            value={`create:${kind}`}
            onSelect={() => create(kind, q)}
            className={q ? 'ghost-item' : 'ghost-kind'}
            title={`${KIND_DESCRIPTION[kind]}. Ej.: ${KIND_EXAMPLES[kind].join(', ')}`}
            data-testid={`ghost-create-${kind}`}
          >
            <span className="ghost-chip" style={{ ['--kind' as string]: `var(--kind-${kind})` }}>
              <Glyph name={kind} size={15} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-fg">{KIND_LABEL[kind]}</span>
              {q ? null : (
                <>
                  <span className="ghost-kind__desc">{KIND_DESCRIPTION[kind]}</span>
                  <span className="truncate text-[10.5px] text-fg-subtle">
                    Ej.: {KIND_EXAMPLES[kind].slice(0, 2).join(' · ')}
                  </span>
                </>
              )}
            </span>
            {q && i === 0 && !suggestions && !existingFirst ? (
              <CornerDownLeft size={12} className="shrink-0 text-fg-subtle" />
            ) : null}
          </Command.Item>
        ))}
      </div>
    </Command.Group>
  );

  const sections: { key: string; node: ReactNode }[] = existingFirst
    ? [
        { key: 'existing', node: existingGroup },
        { key: 'create', node: createGroup },
      ]
    : [{ key: 'create', node: createGroup }];
  if (deployable.length) {
    sections.push({
      key: 'deploy',
      node: (
        <Command.Group
          heading={<GroupHeading title="Desplegar en este ambiente" hint="crea una instancia" />}
          className="ghost-group"
        >
          {deployable.map(({ e, deployed }) => {
            const { icon, label } = elementIcon(e);
            return (
              <Command.Item
                key={e.id}
                value={`deploy:${e.id}`}
                onSelect={() => deploy(e.id)}
                className="ghost-item"
                data-testid={`ghost-deploy-${e.id}`}
              >
                <TechIcon icon={icon} label={label} size={15} className="text-fg-subtle" />
                <span className="truncate text-fg">{e.name}</span>
                <span className="ml-auto truncate pl-2 text-[11px] text-fg-subtle">
                  {deployed
                    ? `${deployed} en este ambiente`
                    : (parentName(e) ?? KIND_LABEL[e.kind])}
                </span>
              </Command.Item>
            );
          })}
        </Command.Group>
      ),
    });
  }
  if (!existingFirst) {
    sections.push({
      key: 'existing',
      node:
        existing.length || !nq ? (
          existingGroup
        ) : (
          <div className="ghost-note ghost-note--box" data-testid="ghost-no-existing">
            Nada en el modelo se llama así: se va a crear un elemento nuevo.
          </div>
        ),
    });
  }
  if (blocks.length) {
    sections.push({
      key: 'blocks',
      node: (
        <Command.Group
          heading={<GroupHeading title="Bloques de templates" />}
          className="ghost-group"
        >
          {blocks.map((t) => (
            <Command.Item
              key={t.id}
              value={`template:${t.id}`}
              onSelect={() => {
                close();
                insertTemplate(t, ghost.flow);
              }}
              className="ghost-item"
              data-testid={`ghost-template-${t.id}`}
            >
              <LayoutTemplate size={15} className="text-fg-subtle" />
              <span className="truncate text-fg">{t.name}</span>
              <span className="ml-auto shrink-0 pl-2 text-[11px] text-fg-subtle">
                {templateStats(t).elements} elementos
              </span>
            </Command.Item>
          ))}
        </Command.Group>
      ),
    });
  }

  return (
    <div
      className="absolute inset-0 z-40"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <GhostPreview
        preview={preview}
        x={ghost.screen.x}
        y={ghost.screen.y}
        zoom={zoom}
        tagAlign={panelLeft > ghost.screen.x ? 'end' : 'start'}
      />
      <Command
        value={active}
        onValueChange={setActive}
        shouldFilter={false}
        loop
        label="Agregar elemento"
        className="animate-pop absolute overflow-hidden rounded-lg border border-line bg-panel shadow-pop"
        style={{ width: PANEL_WIDTH, left: panelLeft, top: panelTop }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          {ghost.connectFrom ? (
            <Link2 size={14} className="text-accent" />
          ) : (
            <Search size={14} className="text-fg-subtle" />
          )}
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={
              ghost.connectFrom
                ? `Conectar "${model.elements[ghost.connectFrom]?.name}" con…`
                : 'Escribí un nombre nuevo o buscá en el modelo…'
            }
            className="h-11 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-fg-subtle"
            data-testid="ghost-input"
          />
        </div>
        <Command.List className="overflow-auto p-1.5" style={{ maxHeight: listMax }}>
          {sections.map((s) => (
            <Fragment key={s.key}>{s.node}</Fragment>
          ))}
        </Command.List>
        <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[11px] text-fg-subtle">
          <span className="flex items-center gap-1">
            <Kbd>↑↓</Kbd> elegir
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> {existingFirst ? 'usar el existente' : q ? 'crear' : 'confirmar'}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> cancelar
          </span>
        </div>
      </Command>
    </div>
  );
}

function GroupHeading({
  title,
  hint,
  count,
  tone,
}: {
  title: string;
  hint?: string;
  count?: number;
  tone?: 'accent';
}) {
  return (
    <span className="ghost-heading" data-tone={tone}>
      <span className="ghost-heading__title">
        {title}
        {count !== undefined ? <span className="ghost-count">{count}</span> : null}
      </span>
      {hint ? <span className="ghost-hint">{hint}</span> : null}
    </span>
  );
}
