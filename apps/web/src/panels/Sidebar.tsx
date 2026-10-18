import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ContextMenu } from 'radix-ui';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Eye, Layers, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react';
import {
  KIND_LABEL,
  childLevelOf,
  findProvider,
  indexOf,
  relationsOf,
  sortedValues,
  type Element,
  type Id,
  type Level,
  type Model,
} from '@aegon/core';
import { Glyph, TechIcon } from '@aegon/icons';
import { useUi, type SidebarTab } from '../store/ui.ts';
import { FlowsPanel } from './FlowsPanel.tsx';
import { useWorkspace } from '../store/workspace.ts';
import { createView, deleteElement, deleteView, drillInto, renameView, revealElement, setDefaultView } from '../lib/actions.ts';
import { elementIcon } from '../canvas/nodes/ElementNode.tsx';
import { DRAG_MIME } from '../canvas/api.ts';
import { cn, IconButton, SectionTitle } from '../ui/primitives.tsx';

type Row =
  | { type: 'section'; key: string; label: string; count: number }
  | { type: 'element'; key: string; el: Element; depth: number; hasChildren: boolean; expanded: boolean; inView: boolean }
  | { type: 'view'; key: string; id: Id; name: string; level: Level; count: number; active: boolean; isDefault: boolean }
  | { type: 'empty'; key: string; label: string };

function levelOf(el: Element): Level | null {
  if (el.kind === 'group' || el.kind === 'actor') return null;
  if (el.kind === 'component') return 3;
  if (el.kind === 'container') return 2;
  if (el.kind === 'store' || el.kind === 'bus') return el.parent ? 2 : 1;
  return 1;
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function buildModelRows(model: Model, expanded: ReadonlySet<Id>, query: string, levels: readonly Level[], placed: ReadonlySet<Id>): Row[] {
  const idx = indexOf(model);
  const q = normalize(query.trim());
  const matches = (el: Element) => (!q || normalize(el.name).includes(q) || el.id.includes(q)) && (levelOf(el) === null || levels.includes(levelOf(el)!));
  const visibleCache = new Map<Id, boolean>();
  const visible = (id: Id): boolean => {
    const cached = visibleCache.get(id);
    if (cached !== undefined) return cached;
    const el = model.elements[id]!;
    const result = matches(el) || (idx.childrenOf.get(id) ?? []).some((c) => model.elements[c]?.kind !== 'group' && visible(c));
    visibleCache.set(id, result);
    return result;
  };
  const rows: Row[] = [];
  const pushTree = (id: Id, depth: number) => {
    if (!visible(id)) return;
    const el = model.elements[id]!;
    const children = (idx.childrenOf.get(id) ?? [])
      .filter((c) => model.elements[c]?.kind !== 'group')
      .sort((a, b) => model.elements[a]!.name.localeCompare(model.elements[b]!.name, 'es', { numeric: true }));
    const isOpen = expanded.has(id) || (!!q && children.some(visible));
    rows.push({ type: 'element', key: id, el, depth, hasChildren: children.length > 0, expanded: isOpen, inView: placed.has(id) });
    if (isOpen) for (const c of children) pushTree(c, depth + 1);
  };
  const roots = (idx.childrenOf.get(null) ?? []).map((id) => model.elements[id]!).filter((e) => e.kind !== 'group');
  const sections: [string, string, Element[]][] = [
    ['actors', 'Actores', roots.filter((e) => e.kind === 'actor')],
    ['systems', 'Sistemas', roots.filter((e) => e.kind === 'system')],
    ['stores', 'Bases de datos', roots.filter((e) => e.kind === 'store')],
    ['buses', 'Buses de mensajería', roots.filter((e) => e.kind === 'bus')],
    ['loose', 'Sin sistema', roots.filter((e) => e.kind === 'container' || e.kind === 'component')],
  ];
  for (const [key, label, list] of sections) {
    const shown = list.filter((e) => visible(e.id)).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
    if (!shown.length) continue;
    rows.push({ type: 'section', key: `section:${key}`, label, count: shown.length });
    for (const e of shown) pushTree(e.id, 0);
  }
  if (!rows.length) rows.push({ type: 'empty', key: 'empty', label: q ? 'Nada coincide con la búsqueda' : 'El modelo está vacío: hacé doble click en el lienzo' });
  return rows;
}

function buildGroupRows(model: Model, expanded: ReadonlySet<Id>, query: string, placed: ReadonlySet<Id>): Row[] {
  const idx = indexOf(model);
  const q = normalize(query.trim());
  const rows: Row[] = [];
  const groups = sortedValues(model.elements).filter((e) => e.kind === 'group');
  const pushGroup = (g: Element, depth: number) => {
    const members = (idx.membersOf.get(g.id) ?? []).map((id) => model.elements[id]!).filter((m) => !q || normalize(m.name).includes(q));
    const subgroups = groups.filter((s) => s.parent === g.id);
    const isOpen = expanded.has(g.id) || !!q || !expanded.has(`collapsed:${g.id}`);
    rows.push({ type: 'element', key: `g:${g.id}`, el: g, depth, hasChildren: members.length + subgroups.length > 0, expanded: isOpen, inView: placed.has(g.id) });
    if (!isOpen) return;
    for (const s of subgroups) pushGroup(s, depth + 1);
    for (const m of members.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))) {
      rows.push({ type: 'element', key: `g:${g.id}:${m.id}`, el: m, depth: depth + 1, hasChildren: false, expanded: false, inView: placed.has(m.id) });
    }
  };
  const byProvider = new Map<string, Element[]>();
  for (const g of groups.filter((x) => !x.parent || !model.elements[x.parent])) {
    const provider = g.kind === 'group' ? g.group.provider : 'other';
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), g]);
  }
  for (const [provider, list] of byProvider) {
    rows.push({ type: 'section', key: `section:${provider}`, label: findProvider(provider)?.name ?? provider, count: list.length });
    for (const g of list) pushGroup(g, 0);
  }
  if (!rows.length) rows.push({ type: 'empty', key: 'empty', label: 'Sin grupos. Creá uno (AWS, GCP, on-premise, red…) desde el lienzo.' });
  return rows;
}

function buildViewRows(model: Model, activeId: Id | null, query: string): Row[] {
  const q = normalize(query.trim());
  const rows: Row[] = [];
  const titles: Record<Level, string> = { 1: 'Nivel 1 · Contexto', 2: 'Nivel 2 · Contenedores', 3: 'Nivel 3 · Componentes' };
  for (const level of [1, 2, 3] as Level[]) {
    const list = sortedValues(model.views)
      .filter((v) => v.level === level && (!q || normalize(v.name).includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
    if (!list.length) continue;
    rows.push({ type: 'section', key: `section:l${level}`, label: titles[level], count: list.length });
    for (const v of list) {
      rows.push({ type: 'view', key: v.id, id: v.id, name: v.name, level, count: Object.keys(v.nodes).length, active: v.id === activeId, isDefault: model.workspace.defaultView === v.id });
    }
  }
  return rows;
}

export function Sidebar() {
  const model = useWorkspace((s) => s.model);
  const tab = useUi((s) => s.sidebarTab);
  const setPref = useUi((s) => s.setPref);
  const levels = useUi((s) => s.levelFilter);
  const toggleLevel = useUi((s) => s.toggleLevel);
  const activeViewId = useUi((s) => s.activeViewId);
  const selectedIds = useUi((s) => s.selection.nodes);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<Id>>(() => new Set());
  const [editingView, setEditingView] = useState<Id | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const placed = useMemo(() => new Set(Object.keys((activeViewId && model.views[activeViewId]?.nodes) || {})), [model.views, activeViewId]);
  const rows = useMemo(() => {
    if (tab === 'views') return buildViewRows(model, activeViewId, query);
    if (tab === 'groups') return buildGroupRows(model, expanded, query, placed);
    return buildModelRows(model, expanded, query, levels, placed);
  }, [tab, model, expanded, query, levels, placed, activeViewId]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.type === 'section' ? 30 : 30),
    overscan: 12,
  });

  const toggle = (key: Id, row: Extract<Row, { type: 'element' }>) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (tab === 'groups') {
        const k = `collapsed:${row.el.id}`;
        if (next.has(k)) next.delete(k);
        else next.add(k);
      } else if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selected = selectedIds.length === 1 ? model.elements[selectedIds[0]!] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="sidebar">
      <div className="flex shrink-0 gap-0.5 border-b border-line px-2 pt-2">
        {(
          [
            ['model', 'Modelo'],
            ['groups', 'Grupos'],
            ['views', 'Lienzos'],
            ['flows', 'Flujos'],
          ] as [SidebarTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPref('sidebarTab', id)}
            className={cn(
              'relative h-8 rounded-t-sm px-2.5 text-[12.5px] font-medium transition-colors',
              tab === id ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            {label}
            {tab === id ? <span className="absolute right-2 bottom-[-1px] left-2 h-[2px] rounded-full bg-accent" /> : null}
          </button>
        ))}
        {tab === 'views' ? (
          <IconButton size="sm" className="mt-1 ml-auto" label="Nuevo lienzo L1" onClick={() => createView()}>
            <Plus size={14} />
          </IconButton>
        ) : null}
      </div>

      {tab === 'flows' ? <FlowsPanel /> : null}
      <div className={cn('flex shrink-0 flex-col gap-2 px-2.5 pt-2.5 pb-1.5', tab === 'flows' && 'hidden')}>
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'views' ? 'Buscar lienzos' : 'Buscar elementos'}
            className="h-7 w-full rounded-sm border border-transparent bg-raised pr-2 pl-7 text-[12.5px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
            spellCheck={false}
          />
        </div>
        {tab === 'model' ? (
          <div className="flex gap-1">
            {([1, 2, 3] as Level[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => toggleLevel(l)}
                className={cn(
                  'h-6 flex-1 rounded-xs border text-[11px] font-semibold transition-colors',
                  levels.includes(l) ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-fg-subtle hover:text-fg-muted',
                )}
                title={['Contexto (sistemas)', 'Contenedores', 'Componentes'][l - 1]}
              >
                L{l}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={parentRef} className={cn('min-h-0 flex-1 overflow-auto px-1.5 pb-2', tab === 'flows' && 'hidden')}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            return (
              <div key={row.key} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: item.size, transform: `translateY(${item.start}px)` }}>
                {row.type === 'section' ? (
                  <div className="flex h-full items-end justify-between px-2 pb-1 text-[10.5px] font-semibold tracking-[0.05em] text-fg-subtle uppercase">
                    {row.label}
                    <span className="tabular-nums font-normal">{row.count}</span>
                  </div>
                ) : row.type === 'empty' ? (
                  <div className="px-2 py-2 text-[12px] text-fg-subtle">{row.label}</div>
                ) : row.type === 'view' ? (
                  <ViewRow row={row} editing={editingView === row.id} setEditing={setEditingView} />
                ) : (
                  <ElementRow row={row} selected={selectedIds.includes(row.el.id)} onToggle={() => toggle(row.el.id, row)} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selected && tab !== 'views' && tab !== 'flows' ? <Dependencies el={selected} /> : null}
    </div>
  );
}

function ElementRow({ row, selected, onToggle }: { row: Extract<Row, { type: 'element' }>; selected: boolean; onToggle: () => void }) {
  const { el } = row;
  const { icon, label } = elementIcon(el);
  const groupIcon = el.kind === 'group' ? findProvider(el.group.provider)?.icon : undefined;
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, el.id);
    e.dataTransfer.setData('text/plain', el.id);
    e.dataTransfer.effectAllowed = 'link';
  };
  return (
    <RowMenu el={el}>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={row.hasChildren ? row.expanded : undefined}
        draggable
        onDragStart={onDragStart}
        onClick={() => useUi.getState().select([el.id])}
        onDoubleClick={() => revealElement(el.id)}
        className={cn(
          'group flex h-[28px] items-center gap-1.5 rounded-sm pr-1.5 text-[12.5px] transition-colors',
          selected ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
        )}
        style={{ paddingLeft: 6 + row.depth * 14 }}
        data-testid={`tree-${el.id}`}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={row.expanded ? 'Contraer' : 'Expandir'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-xs text-fg-subtle hover:text-fg', !row.hasChildren && 'invisible')}
        >
          <ChevronRight size={12} className={cn('transition-transform duration-150', row.expanded && 'rotate-90')} />
        </button>
        <span className="shrink-0" style={{ color: `var(--kind-${el.kind})` }}>
          <TechIcon icon={groupIcon ?? icon} label={label} size={14} />
        </span>
        <span className={cn('truncate', el.scope === 'external' && 'italic')}>{el.name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {row.inView ? <span className="h-1.5 w-1.5 rounded-full bg-accent" title="En el lienzo actual" /> : null}
          {'risk' in el && el.risk && (el.risk === 'high' || el.risk === 'critical') ? (
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(--risk-${el.risk})` }} title={`Riesgo ${el.risk}`} />
          ) : null}
        </span>
      </div>
    </RowMenu>
  );
}

function RowMenu({ el, children }: { el: Element; children: ReactNode }) {
  const canDrill = !!childLevelOf(el.kind);
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu">
          <div className="menu-label">{KIND_LABEL[el.kind]}</div>
          <ContextMenu.Item className="menu-item" onSelect={() => revealElement(el.id)}>
            <Eye size={14} /> Mostrar en el lienzo
          </ContextMenu.Item>
          {canDrill ? (
            <ContextMenu.Item className="menu-item" onSelect={() => drillInto(el.id)}>
              <Layers size={14} /> {el.kind === 'system' ? 'Abrir contenedores (L2)' : 'Abrir componentes (L3)'}
            </ContextMenu.Item>
          ) : null}
          <ContextMenu.Item
            className="menu-item"
            onSelect={() => {
              useUi.getState().select([el.id]);
              useUi.getState().requestRename();
            }}
          >
            <Pencil size={14} /> Renombrar
          </ContextMenu.Item>
          <ContextMenu.Separator className="menu-sep" />
          <ContextMenu.Item className="menu-item" data-danger onSelect={() => deleteElement(el.id)}>
            <Trash2 size={14} /> Eliminar del modelo
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function ViewRow({ row, editing, setEditing }: { row: Extract<Row, { type: 'view' }>; editing: boolean; setEditing: (id: Id | null) => void }) {
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>
        <div
          onClick={() => useUi.getState().openView(row.id, { transition: 'fade' })}
          onDoubleClick={() => setEditing(row.id)}
          className={cn(
            'flex h-[28px] items-center gap-2 rounded-sm px-2 text-[12.5px] transition-colors',
            row.active ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
          )}
          data-testid={`view-row-${row.id}`}
        >
          <span className={cn('grid h-[18px] w-[22px] shrink-0 place-items-center rounded-xs text-[10px] font-bold', row.active ? 'bg-accent text-accent-fg' : 'bg-raised text-fg-subtle')}>
            L{row.level}
          </span>
          {editing ? (
            <input
              autoFocus
              defaultValue={row.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                renameView(row.id, e.target.value);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
              className="h-6 min-w-0 flex-1 rounded-xs border border-accent bg-raised px-1.5 text-[12.5px] text-fg outline-none"
            />
          ) : (
            <span className="truncate">{row.name}</span>
          )}
          {row.isDefault ? <Star size={11} className="shrink-0 fill-current text-fg-subtle" /> : null}
          <span className="ml-auto shrink-0 tabular-nums text-[11px] text-fg-subtle">{row.count}</span>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu">
          <ContextMenu.Item className="menu-item" onSelect={() => setEditing(row.id)}>
            <Pencil size={14} /> Renombrar
          </ContextMenu.Item>
          <ContextMenu.Item className="menu-item" onSelect={() => setDefaultView(row.id)} disabled={row.isDefault}>
            <Star size={14} /> Abrir por defecto
          </ContextMenu.Item>
          <ContextMenu.Separator className="menu-sep" />
          <ContextMenu.Item className="menu-item" data-danger onSelect={() => deleteView(row.id)}>
            <Trash2 size={14} /> Eliminar lienzo
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function Dependencies({ el }: { el: Element }) {
  const model = useWorkspace((s) => s.model);
  const { incoming, outgoing } = useMemo(() => relationsOf(model, el.id), [model, el.id]);
  if (el.kind === 'group') return null;
  const item = (otherId: Id, label: string | undefined, dir: 'in' | 'out', key: string) => {
    const other = model.elements[otherId];
    if (!other) return null;
    return (
      <button
        key={key}
        type="button"
        onClick={() => useUi.getState().select([other.id])}
        onDoubleClick={() => revealElement(other.id)}
        className="flex h-[26px] w-full items-center gap-1.5 rounded-sm px-1.5 text-left text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
      >
        {dir === 'out' ? <ArrowUpRight size={12} className="shrink-0 text-accent" /> : <ArrowDownLeft size={12} className="shrink-0 text-fg-subtle" />}
        <Glyph name={other.kind} size={13} className="shrink-0" style={{ color: `var(--kind-${other.kind})` }} />
        <span className="truncate">{other.name}</span>
        {label ? <span className="ml-auto max-w-[45%] shrink-0 truncate pl-2 text-[11px] text-fg-subtle">{label}</span> : null}
      </button>
    );
  };
  return (
    <div className="max-h-[38%] shrink-0 overflow-auto border-t border-line px-2.5 pt-1.5 pb-2" data-testid="dependencies">
      <SectionTitle>Dependencias · {el.name}</SectionTitle>
      {!incoming.length && !outgoing.length ? <p className="m-0 px-1.5 py-1 text-[12px] text-fg-subtle">Sin relaciones. Arrastrá desde un borde del nodo para conectar.</p> : null}
      {outgoing.map((r) => item(r.to, r.label, 'out', r.id))}
      {incoming.map((r) => item(r.from, r.label, 'in', r.id))}
    </div>
  );
}
