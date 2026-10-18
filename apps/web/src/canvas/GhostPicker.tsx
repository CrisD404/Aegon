import { useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { useStore } from '@xyflow/react';
import {
  DB_ENGINES,
  MESSAGE_BROKERS,
  GROUP_PROVIDER_CATALOG,
  KINDS_FOR_LEVEL,
  KIND_LABEL,
  blockProblem,
  placeableElements,
  searchCatalog,
  sizeOf,
  templateStats,
  type Element,
  type ElementKind,
  type View,
} from '@aegon/core';
import { Glyph, TechIcon } from '@aegon/icons';
import { CornerDownLeft, LayoutTemplate, Link2 } from 'lucide-react';
import { useUi, type GhostState } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { allTemplates, useTemplates } from '../store/templates.ts';
import { createElementAt, placeExisting } from '../lib/actions.ts';
import { insertTemplate } from '../lib/flows.tsx';
import { elementIcon } from './nodes/ElementNode.tsx';
import { Kbd } from '../ui/primitives.tsx';

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Componente fantasma: aparece con doble click en el lienzo. Lo que se escribe sirve para buscar
 * un elemento existente (que se linkea, no se duplica) o como nombre del elemento nuevo.
 */
export function GhostPicker({ ghost, view }: { ghost: GhostState; view: View }) {
  const zoom = useStore((s) => s.transform[2]);
  const model = useWorkspace((s) => s.model);
  const setGhost = useUi((s) => s.setGhost);
  const [query, setQuery] = useState('');
  const close = () => setGhost(null);

  const kinds = useMemo(() => {
    const allowed = KINDS_FOR_LEVEL[view.level];
    return ghost.kind && allowed.includes(ghost.kind)
      ? [ghost.kind, ...allowed.filter((k) => k !== ghost.kind)]
      : [...allowed];
  }, [ghost.kind, view.level]);
  const creatable = ghost.connectFrom ? kinds.filter((k) => k !== 'group') : kinds;

  const existing = useMemo(() => {
    const list = placeableElements(model, view).filter(
      (e) => !(ghost.connectFrom && e.kind === 'group'),
    );
    const q = normalize(query);
    const scored = list
      .map((e) => {
        const name = normalize(e.name);
        const score = !q
          ? 1
          : name.startsWith(q)
            ? 3
            : name.includes(q)
              ? 2
              : e.id.includes(q)
                ? 1
                : 0;
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          kinds.indexOf(a.e.kind) - kinds.indexOf(b.e.kind) ||
          a.e.name.localeCompare(b.e.name),
      );
    return scored.slice(0, 40).map((x) => x.e);
  }, [model, view, query, kinds, ghost.connectFrom]);

  // Bloques que entran en este nivel (API gateway, event-driven, los del usuario…).
  const userTemplates = useTemplates((s) => s.user);
  const blocks = useMemo(() => {
    if (ghost.connectFrom) return [];
    const q = normalize(query);
    return allTemplates(userTemplates)
      .filter((t) => t.kind === 'block' && !blockProblem(t, view))
      .filter(
        (t) => !q || normalize(t.name).includes(q) || normalize(t.description ?? '').includes(q),
      )
      .slice(0, q ? 6 : 4);
  }, [userTemplates, view, query, ghost.connectFrom]);

  const q = query.trim();
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

  const create = (kind: ElementKind, name: string, fields?: Partial<Element>) => {
    close();
    createElementAt(kind, name, ghost.flow, { connectFrom: ghost.connectFrom, fields });
  };
  const pick = (id: string) => {
    close();
    placeExisting(id, ghost.flow, { connectFrom: ghost.connectFrom });
  };

  const primary = sizeOf({ kind: creatable[0] ?? 'system' });
  const rect = { w: primary.w * zoom, h: primary.h * zoom };
  const panelLeft = ghost.screen.x + rect.w / 2 + 14;
  const flip = typeof window !== 'undefined' && panelLeft + 340 > window.innerWidth - 340;

  return (
    <div
      className="absolute inset-0 z-40"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        className="ghost-rect"
        style={{
          left: ghost.screen.x - rect.w / 2,
          top: ghost.screen.y - rect.h / 2,
          width: rect.w,
          height: rect.h,
        }}
      />
      <Command
        shouldFilter={false}
        loop
        label="Agregar elemento"
        className="animate-pop absolute w-[320px] overflow-hidden rounded-lg border border-line bg-panel shadow-pop"
        style={{
          left: flip ? ghost.screen.x - rect.w / 2 - 14 - 320 : panelLeft,
          top: Math.max(8, ghost.screen.y - rect.h / 2),
        }}
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
            <Glyph name={creatable[0] ?? 'system'} size={15} className="text-fg-subtle" />
          )}
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={
              ghost.connectFrom
                ? `Conectar "${model.elements[ghost.connectFrom]?.name}" con…`
                : 'Nombre nuevo o buscar existente…'
            }
            className="h-10 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-fg-subtle"
            data-testid="ghost-input"
          />
        </div>
        <Command.List className="max-h-[340px] overflow-auto p-1.5">
          <Command.Group heading="Crear" className="ghost-group">
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
            {creatable.map((kind, i) => (
              <Command.Item
                key={kind}
                value={`create:${kind}`}
                onSelect={() => create(kind, q)}
                className="ghost-item"
              >
                <Glyph
                  name={kind}
                  size={15}
                  className="text-[var(--kind)]"
                  style={{ ['--kind' as string]: `var(--kind-${kind})` }}
                />
                <span className="truncate">
                  {KIND_LABEL[kind]}
                  {q ? (
                    <span className="text-fg"> “{q}”</span>
                  ) : (
                    <span className="text-fg-subtle"> nuevo</span>
                  )}
                </span>
                {i === 0 && !engines.length && !brokers.length && !providers.length ? (
                  <span className="ml-auto">
                    <CornerDownLeft size={12} className="text-fg-subtle" />
                  </span>
                ) : null}
              </Command.Item>
            ))}
          </Command.Group>
          {blocks.length ? (
            <Command.Group heading="Templates · bloques" className="ghost-group">
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
          ) : null}
          {existing.length ? (
            <Command.Group heading={`Existentes · se linkean`} className="ghost-group">
              {existing.map((e) => {
                const { icon, label } = elementIcon(e);
                const parent = e.parent ? model.elements[e.parent]?.name : undefined;
                return (
                  <Command.Item
                    key={e.id}
                    value={`existing:${e.id}`}
                    onSelect={() => pick(e.id)}
                    className="ghost-item"
                    data-testid={`ghost-existing-${e.id}`}
                  >
                    <TechIcon icon={icon} label={label} size={15} className="text-fg-subtle" />
                    <span className="truncate text-fg">{e.name}</span>
                    <span className="ml-auto truncate pl-2 text-[11px] text-fg-subtle">
                      {parent ?? KIND_LABEL[e.kind]}
                    </span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          ) : null}
        </Command.List>
        <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[11px] text-fg-subtle">
          <span className="flex items-center gap-1">
            <Kbd>↑↓</Kbd> elegir
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> confirmar
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> cancelar
          </span>
        </div>
      </Command>
    </div>
  );
}
