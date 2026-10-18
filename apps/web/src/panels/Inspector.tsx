import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Copy, ExternalLink, EyeOff, Layers, Link2, Plus, Trash2, X } from 'lucide-react';
import {
  BUS_TYPES,
  BUS_TYPE_LABEL,
  CONTAINER_TYPES,
  CONTAINER_TYPE_LABEL,
  MESSAGE_BROKERS,
  PROTOCOL_GROUP_LABEL,
  TECH_CATEGORY_LABEL,
  DB_ENGINES,
  GROUP_PROVIDER_CATALOG,
  RISKS,
  RISK_LABEL,
  STATUSES,
  STATUS_LABEL,
  STORE_TYPES,
  STORE_TYPE_LABEL,
  TECHNOLOGIES,
  childLevelOf,
  childViewOf,
  descendantsOf,
  findProtocol,
  findTechnology,
  searchCatalog,
  suggestProtocols,
  sortedValues,
  validateModel,
  viewsContaining,
  type Element,
  type ElementPatch,
  type Id,
  type BusDetails,
  type Relation,
  type Risk,
  type StoreDetails,
  type View,
} from '@aegon/core';
import { Glyph, TechIcon, GLYPH_NAMES, type GlyphName } from '@aegon/icons';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { deleteElement, drillInto, removeSelectionFromView, renameView } from '../lib/actions.ts';
import { IMPLIED_PREFIX } from '../canvas/derive.ts';
import { elementIcon, kindCaption } from '../canvas/nodes/ElementNode.tsx';
import { Button, Field, IconButton, SectionTitle, Segmented, Select, Switch, TagInput, TextArea, TextInput, cn, type Suggestion } from '../ui/primitives.tsx';
import { FinOpsFields } from './FinOpsFields.tsx';

export function Inspector() {
  const model = useWorkspace((s) => s.model);
  const selection = useUi((s) => s.selection);
  const viewId = useUi((s) => s.activeViewId);
  const view = viewId ? model.views[viewId] : undefined;

  if (selection.nodes.length === 1) {
    const el = model.elements[selection.nodes[0]!];
    if (el) return <ElementInspector key={el.id} el={el} />;
  }
  if (selection.nodes.length > 1) return <MultiInspector count={selection.nodes.length} />;
  if (selection.edges.length === 1) {
    const edgeId = selection.edges[0]!;
    if (edgeId.startsWith(IMPLIED_PREFIX)) return <ImpliedInspector id={edgeId} />;
    const rel = model.relations[edgeId];
    if (rel) return <RelationInspector key={rel.id} rel={rel} />;
  }
  return view ? <ViewInspector key={view.id} view={view} /> : null;
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="animate-fade flex flex-col gap-4 px-4 pt-3 pb-8">{children}</div>;
}

function Header({ icon, kind, title, id }: { icon: ReactNode; kind: string; title: ReactNode; id?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[11.5px] font-medium text-fg-subtle">{kind}</span>
        {id ? (
          <button
            type="button"
            title="Copiar ID"
            onClick={() => {
              void navigator.clipboard?.writeText(id);
              useUi.getState().toast('ID copiado');
            }}
            className="ml-auto flex max-w-[55%] items-center gap-1 truncate rounded-xs px-1.5 py-0.5 font-mono text-[10.5px] text-fg-subtle hover:bg-hover hover:text-fg"
          >
            <span className="truncate">{id}</span>
            <Copy size={10} className="shrink-0" />
          </button>
        ) : null}
      </div>
      {title}
    </div>
  );
}

const techSuggest = (q: string): Suggestion[] =>
  searchCatalog(TECHNOLOGIES, q, 8).map((t) => ({ value: t.id, label: t.name, hint: TECH_CATEGORY_LABEL[t.category], icon: <TechIcon icon={t.icon} label={t.name} size={13} /> }));

function techChip(v: string) {
  const t = findTechnology(v);
  return (
    <span className="inline-flex items-center gap-1">
      <TechIcon icon={t?.icon ?? v} label={t?.name ?? v} size={12} />
      {t?.name ?? v}
    </span>
  );
}

function protocolChip(v: string) {
  const p = findProtocol(v);
  return (
    <span className="inline-flex items-center gap-1">
      <TechIcon icon={p?.icon ?? 'glyph:plug'} label={p?.name ?? v} size={12} />
      {p?.name ?? v}
    </span>
  );
}

function RiskField({ value, onChange }: { value: Risk | undefined; onChange: (v: Risk | undefined) => void }) {
  return (
    <Field label="Riesgo">
      <Segmented value={value} allowEmpty onChange={onChange} options={RISKS.map((r) => ({ value: r, label: RISK_LABEL[r], tone: `var(--risk-${r})` }))} />
    </Field>
  );
}

function ElementInspector({ el }: { el: Element }) {
  const model = useWorkspace((s) => s.model);
  const dispatch = useWorkspace((s) => s.dispatch);
  const renameRequest = useUi((s) => s.renameRequest);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(el.name);
  useEffect(() => setName(el.name), [el.name]);
  useEffect(() => {
    if (renameRequest) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [renameRequest]);

  const update = (patch: ElementPatch, field: string) => dispatch({ type: 'element.update', id: el.id, patch }, { coalesce: `${el.id}:${field}`, label: `Editar ${el.name}` });
  const text = (field: string) => (v: string) => update({ [field]: v.trim() ? v : null } as ElementPatch, field);

  const { icon, label } = elementIcon(el);
  const views = viewsContaining(model, el.id);
  const tagsSuggest = useMemo(() => {
    const all = new Set<string>();
    for (const e of Object.values(model.elements)) for (const t of e.tags ?? []) all.add(t);
    return [...all];
  }, [model.elements]);
  const drillLevel = childLevelOf(el.kind);
  const children = drillLevel ? descendantsOf(model, el.id).filter((c) => model.elements[c]?.parent === el.id) : [];
  const issues = useMemo(() => validateModel(model).filter((d) => d.entity?.id === el.id && d.severity !== 'info'), [model, el.id]);

  return (
    <Panel>
      <Header
        icon={
          <span className="grid h-6 w-6 place-items-center rounded-sm" style={{ color: `var(--kind-${el.kind})`, background: `color-mix(in srgb, var(--kind-${el.kind}) 13%, transparent)` }}>
            <TechIcon icon={icon} label={label} size={14} />
          </span>
        }
        kind={kindCaption(el)}
        id={el.id}
        title={
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) update({ name: e.target.value }, 'name');
            }}
            onBlur={() => setName(el.name)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="-mx-1.5 h-9 rounded-sm border border-transparent bg-transparent px-1.5 text-[17px] font-semibold tracking-[-0.01em] text-fg outline-none hover:border-line focus:border-accent focus:bg-raised"
            aria-label="Nombre"
            data-testid="inspector-name"
            spellCheck={false}
          />
        }
      />

      {issues.length ? (
        <div className="flex flex-col gap-1 rounded-md border border-warn/30 bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-3 py-2 text-[12px] text-fg-muted">
          {issues.map((d, i) => (
            <span key={i}>⚠ {d.message}</span>
          ))}
        </div>
      ) : null}

      <Field label="Descripción">
        <TextArea rows={2} value={el.description ?? ''} onChange={(e) => text('description')(e.target.value)} placeholder="Qué hace, en una o dos líneas" />
      </Field>

      {el.kind === 'actor' ? (
        <>
          <Switch checked={el.scope === 'external'} onChange={(v) => update({ scope: v ? 'external' : null }, 'scope')} label="Externo" description="Fuera de la organización" />
          <Field label="Rol o persona">
            <TextInput value={el.role ?? ''} onChange={(e) => text('role')(e.target.value)} placeholder="Cliente minorista, operador…" />
          </Field>
        </>
      ) : null}

      {el.kind === 'store' ? <StoreFields el={el} update={update} /> : null}
      {el.kind === 'bus' ? <BusFields el={el} update={update} /> : null}
      {el.kind === 'group' ? <GroupFields el={el} update={update} /> : null}

      {el.kind === 'system' || el.kind === 'container' || el.kind === 'component' ? (
        <>
          <Switch checked={el.scope === 'external'} onChange={(v) => update({ scope: v ? 'external' : null }, 'scope')} label="Externo" description="Lo opera otra organización o equipo" />
          {el.kind === 'container' ? (
            <Field label="Tipo de contenedor">
              <Select value={el.containerType} onChange={(v) => update({ containerType: v ?? null }, 'containerType')} options={CONTAINER_TYPES.map((t) => ({ value: t, label: CONTAINER_TYPE_LABEL[t] }))} placeholder="Sin especificar" />
            </Field>
          ) : null}
          <Field label="Tecnología" hint="Lenguajes, frameworks, plataforma">
            <TagInput values={el.technology ?? []} onChange={(v) => update({ technology: v.length ? v : null }, 'technology')} suggest={techSuggest} placeholder="java, spring-boot, react…" renderChip={techChip} />
          </Field>
        </>
      ) : null}

      {el.kind !== 'actor' && el.kind !== 'group' ? <RiskField value={el.risk} onChange={(v) => update({ risk: v ?? null }, 'risk')} /> : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Estado">
          <Select value={el.status ?? 'live'} onChange={(v) => update({ status: v && v !== 'live' ? v : null }, 'status')} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        </Field>
        <Field label="Responsable">
          <TextInput value={el.owner ?? ''} onChange={(e) => text('owner')(e.target.value)} placeholder="Equipo" />
        </Field>
      </div>

      <Field label="Tags">
        <TagInput
          values={el.tags ?? []}
          onChange={(v) => update({ tags: v.length ? v : null }, 'tags')}
          suggest={(q) => tagsSuggest.filter((t) => t.includes(q.toLowerCase())).map((t) => ({ value: t, label: t }))}
          placeholder="pci, core, legacy…"
        />
      </Field>

      <FinOpsFields el={el} update={update} />

      <LinksField el={el} update={update} />

      <Field label="Documentación" hint="Markdown">
        <TextArea rows={5} value={el.docs ?? ''} onChange={(e) => text('docs')(e.target.value)} placeholder="Decisiones, contratos, SLAs…" className="font-mono text-[12px]" />
      </Field>

      <PropertiesField el={el} update={update} />

      <div className="flex flex-col gap-1.5">
        <SectionTitle>Aparece en {views.length} {views.length === 1 ? 'lienzo' : 'lienzos'}</SectionTitle>
        {views.map((v) => (
          <ViewLink key={v.id} view={v} focus={el.id} />
        ))}
        {drillLevel ? (
          <Button variant="secondary" size="sm" className="mt-1 justify-start" onClick={() => drillInto(el.id)}>
            <Layers size={13} />
            {childViewOf(model, el.id) ? 'Abrir' : 'Crear'} {el.kind === 'system' ? 'contenedores (L2)' : 'componentes (L3)'}
            <span className="ml-auto font-mono text-[11px] text-fg-subtle">{children.length}</span>
          </Button>
        ) : null}
      </div>

      <div className="flex gap-2 border-t border-line pt-3">
        <Button variant="ghost" size="sm" onClick={removeSelectionFromView}>
          <EyeOff size={13} /> Quitar del lienzo
        </Button>
        <Button variant="danger" size="sm" className="ml-auto" onClick={() => deleteElement(el.id)}>
          <Trash2 size={13} /> Eliminar
        </Button>
      </div>
    </Panel>
  );
}

function ViewLink({ view, focus }: { view: View; focus?: Id }) {
  const active = useUi((s) => s.activeViewId === view.id);
  return (
    <button
      type="button"
      onClick={() => useUi.getState().openView(view.id, { transition: 'fade', focus: focus ?? null })}
      className={cn('flex h-7 items-center gap-2 rounded-sm px-2 text-left text-[12.5px] hover:bg-hover', active ? 'text-fg' : 'text-fg-muted')}
    >
      <span className="grid h-[18px] w-[22px] place-items-center rounded-xs bg-raised text-[10px] font-bold text-fg-subtle">L{view.level}</span>
      <span className="truncate">{view.name}</span>
      {active ? <span className="ml-auto text-[11px] text-fg-subtle">actual</span> : null}
    </button>
  );
}

const ICON_CHOICES: GlyphName[] = GLYPH_NAMES.filter((g) => ['store', 'database', 'server', 'cloud', 'file', 'layers', 'globe'].includes(g));
const BUS_ICON_CHOICES: GlyphName[] = GLYPH_NAMES.filter((g) => ['bus', 'queue', 'server', 'cloud', 'network'].includes(g));

function StoreFields({ el, update }: { el: Extract<Element, { kind: 'store' }>; update: (p: ElementPatch, f: string) => void }) {
  const [query, setQuery] = useState('');
  const engines = searchCatalog(DB_ENGINES, query, 60);
  const setStore = (patch: Partial<StoreDetails>) => {
    const next: Record<string, unknown> = { ...el.store, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
    update({ store: next as StoreDetails }, 'store');
  };
  return (
    <>
      <Field label="Motor de base de datos">
        <div className="flex flex-col gap-2">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar motor (postgres, mongo, redis…)" className="h-7 text-[12px]" />
          <div className="grid max-h-[180px] grid-cols-2 gap-1 overflow-auto pr-0.5">
            {engines.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setStore({ engine: e.id, type: e.type, customEngine: undefined, customIcon: undefined })}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-sm border px-2 text-left text-[12px] transition-colors',
                  el.store.engine === e.id ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                <TechIcon icon={e.icon} label={e.name} size={14} />
                <span className="truncate">{e.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setStore({ engine: 'other' })}
              className={cn(
                'flex h-8 items-center gap-2 rounded-sm border px-2 text-left text-[12px] transition-colors',
                el.store.engine === 'other' ? 'border-accent bg-accent-soft text-fg' : 'border-dashed border-line-strong text-fg-muted hover:bg-hover',
              )}
            >
              <Plus size={14} /> Otro
            </button>
          </div>
        </div>
      </Field>
      {el.store.engine === 'other' ? (
        <div className="animate-pop flex flex-col gap-3 rounded-md border border-line p-3">
          <Field label="Nombre del motor">
            <TextInput value={el.store.customEngine ?? ''} onChange={(e) => setStore({ customEngine: e.target.value })} placeholder="ej. IBM Db2, HANA, Informix" />
          </Field>
          <Field label="Ícono">
            <div className="flex flex-wrap gap-1">
              {ICON_CHOICES.map((g) => (
                <IconButton key={g} size="sm" label={g} active={(el.store.customIcon ?? 'glyph:store') === `glyph:${g}`} onClick={() => setStore({ customIcon: `glyph:${g}` })}>
                  <Glyph name={g} size={15} />
                </IconButton>
              ))}
            </div>
          </Field>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select value={el.store.type} onChange={(v) => setStore({ type: v })} options={STORE_TYPES.map((t) => ({ value: t, label: STORE_TYPE_LABEL[t] }))} placeholder="—" />
        </Field>
        <Field label="Versión">
          <TextInput value={el.store.version ?? ''} onChange={(e) => setStore({ version: e.target.value })} placeholder="16" />
        </Field>
      </div>
      <Field label="Servicio administrado">
        <TextInput value={el.store.managed ?? ''} onChange={(e) => setStore({ managed: e.target.value })} placeholder="aws-rds, cloud-sql, atlas…" />
      </Field>
      <Switch checked={el.scope === 'external'} onChange={(v) => update({ scope: v ? 'external' : null }, 'scope')} label="Externa" description="Pertenece a otro sistema u organización" />
    </>
  );
}

function BusFields({ el, update }: { el: Extract<Element, { kind: 'bus' }>; update: (p: ElementPatch, f: string) => void }) {
  const [query, setQuery] = useState('');
  const brokers = searchCatalog(MESSAGE_BROKERS, query, 40);
  const setBus = (patch: Partial<BusDetails>) => {
    const next: Record<string, unknown> = { ...el.bus, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || (Array.isArray(next[k]) && !(next[k] as unknown[]).length)) delete next[k];
    update({ bus: next as BusDetails }, 'bus');
  };
  return (
    <>
      <Field label="Broker">
        <div className="flex flex-col gap-2">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar (kafka, rabbit, sqs, pub/sub…)" className="h-7 text-[12px]" />
          <div className="grid max-h-[180px] grid-cols-2 gap-1 overflow-auto pr-0.5">
            {brokers.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBus({ broker: b.id, type: b.type, customBroker: undefined, customIcon: undefined })}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-sm border px-2 text-left text-[12px] transition-colors',
                  el.bus.broker === b.id ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                <TechIcon icon={b.icon} label={b.name} size={14} />
                <span className="truncate">{b.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setBus({ broker: 'other' })}
              className={cn(
                'flex h-8 items-center gap-2 rounded-sm border px-2 text-left text-[12px] transition-colors',
                el.bus.broker === 'other' ? 'border-accent bg-accent-soft text-fg' : 'border-dashed border-line-strong text-fg-muted hover:bg-hover',
              )}
            >
              <Plus size={14} /> Otro
            </button>
          </div>
        </div>
      </Field>
      {el.bus.broker === 'other' ? (
        <div className="animate-pop flex flex-col gap-3 rounded-md border border-line p-3">
          <Field label="Nombre del broker">
            <TextInput value={el.bus.customBroker ?? ''} onChange={(e) => setBus({ customBroker: e.target.value })} placeholder="ej. Solace, TIBCO EMS" />
          </Field>
          <Field label="Ícono">
            <div className="flex flex-wrap gap-1">
              {BUS_ICON_CHOICES.map((g) => (
                <IconButton key={g} size="sm" label={g} active={(el.bus.customIcon ?? 'glyph:bus') === `glyph:${g}`} onClick={() => setBus({ customIcon: `glyph:${g}` })}>
                  <Glyph name={g} size={15} />
                </IconButton>
              ))}
            </div>
          </Field>
        </div>
      ) : null}
      <Field label="Modelo de mensajería">
        <Segmented value={el.bus.type} allowEmpty onChange={(v) => setBus({ type: v })} options={BUS_TYPES.map((t) => ({ value: t, label: BUS_TYPE_LABEL[t].split(' ')[0]!, title: BUS_TYPE_LABEL[t] }))} />
      </Field>
      <Field label="Tópicos / colas">
        <TagInput values={el.bus.topics ?? []} onChange={(v) => setBus({ topics: v })} placeholder="pagos.autorizados, notificaciones…" />
      </Field>
      <Switch checked={el.scope === 'external'} onChange={(v) => update({ scope: v ? 'external' : null }, 'scope')} label="Externo" description="Lo opera otro equipo u organización" />
    </>
  );
}

function GroupFields({ el, update }: { el: Extract<Element, { kind: 'group' }>; update: (p: ElementPatch, f: string) => void }) {
  const setGroup = (patch: Partial<typeof el.group>) => {
    const next: Record<string, unknown> = { ...el.group, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
    update({ group: next as typeof el.group }, 'group');
  };
  return (
    <>
      <Field label="Tipo de grupo">
        <div className="grid grid-cols-2 gap-1">
          {GROUP_PROVIDER_CATALOG.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setGroup({ provider: p.id })}
              className={cn(
                'flex h-8 items-center gap-2 rounded-sm border px-2 text-left text-[12px] transition-colors',
                el.group.provider === p.id ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-muted hover:bg-hover hover:text-fg',
              )}
            >
              <TechIcon icon={p.icon} label={p.name} size={14} />
              {p.name}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Región / sitio">
          <TextInput value={el.group.region ?? ''} onChange={(e) => setGroup({ region: e.target.value })} placeholder="us-east-1" />
        </Field>
        <Field label="Cuenta / proyecto">
          <TextInput value={el.group.account ?? ''} onChange={(e) => setGroup({ account: e.target.value })} placeholder="prod-123" />
        </Field>
      </div>
      {el.group.provider === 'network' ? (
        <Field label="CIDR">
          <TextInput value={el.group.cidr ?? ''} onChange={(e) => setGroup({ cidr: e.target.value })} placeholder="10.0.0.0/16" className="font-mono" />
        </Field>
      ) : null}
    </>
  );
}

function LinksField({ el, update }: { el: Element; update: (p: ElementPatch, f: string) => void }) {
  const links = el.links ?? [];
  const set = (next: typeof links) => update({ links: next.length ? next : null }, 'links');
  return (
    <div className="flex flex-col gap-1.5">
      <SectionTitle
        action={
          <IconButton size="sm" label="Agregar link" onClick={() => set([...links, { url: 'https://' }])}>
            <Plus size={13} />
          </IconButton>
        }
      >
        Links
      </SectionTitle>
      {links.map((l, i) => (
        <div key={i} className="flex items-center gap-1">
          <TextInput value={l.label ?? ''} onChange={(e) => set(links.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)))} placeholder="Título" className="h-7 w-[38%] text-[12px]" />
          <TextInput value={l.url} onChange={(e) => set(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} className="h-7 flex-1 font-mono text-[11.5px]" />
          <IconButton size="sm" label="Abrir" onClick={() => window.open(l.url, '_blank', 'noopener')}>
            <ExternalLink size={12} />
          </IconButton>
          <IconButton size="sm" label="Quitar" onClick={() => set(links.filter((_, j) => j !== i))}>
            <X size={12} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

function PropertiesField({ el, update }: { el: Element; update: (p: ElementPatch, f: string) => void }) {
  const entries = Object.entries(el.properties ?? {});
  const set = (next: [string, string][]) => update({ properties: next.length ? Object.fromEntries(next) : null }, 'properties');
  return (
    <div className="flex flex-col gap-1.5">
      <SectionTitle
        action={
          <IconButton size="sm" label="Agregar propiedad" onClick={() => set([...entries, [`clave-${entries.length + 1}`, '']])}>
            <Plus size={13} />
          </IconButton>
        }
      >
        Propiedades
      </SectionTitle>
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1">
          <TextInput defaultValue={k} onBlur={(e) => e.target.value.trim() && set(entries.map((x, j) => (j === i ? [e.target.value.trim(), x[1]] : x)))} className="h-7 w-[40%] font-mono text-[11.5px]" />
          <TextInput value={v} onChange={(e) => set(entries.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} className="h-7 flex-1 text-[12px]" />
          <IconButton size="sm" label="Quitar" onClick={() => set(entries.filter((_, j) => j !== i))}>
            <X size={12} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

function RelationInspector({ rel }: { rel: Relation }) {
  const model = useWorkspace((s) => s.model);
  const dispatch = useWorkspace((s) => s.dispatch);
  const viewId = useUi((s) => s.activeViewId);
  const view = viewId ? model.views[viewId] : undefined;
  const update = (patch: Record<string, unknown>, field: string) => dispatch({ type: 'relation.update', id: rel.id, patch }, { coalesce: `${rel.id}:${field}`, label: 'Editar relación' });
  const from = model.elements[rel.from];
  const to = model.elements[rel.to];
  const shape = view?.edges?.[rel.id]?.shape ?? 'curved';
  return (
    <Panel>
      <Header icon={<Link2 size={15} className="text-accent" />} kind="Relación" id={rel.id} title={<div className="text-[15px] font-semibold">{from?.name} → {to?.name}</div>} />
      <Field label="Etiqueta">
        <TextInput value={rel.label ?? ''} onChange={(e) => update({ label: e.target.value || null }, 'label')} placeholder="Lee datos, publica eventos…" autoFocus />
      </Field>
      <Field label="Protocolos" hint={to ? `Sugeridos para ${kindCaption(to).split(' · ')[0]!.toLowerCase()}` : undefined}>
        <TagInput
          values={rel.protocols ?? []}
          onChange={(v) => update({ protocols: v.length ? v : null }, 'protocols')}
          suggest={(q) => suggestProtocols(to, q, 10).map((p) => ({ value: p.id, label: p.name, hint: PROTOCOL_GROUP_LABEL[p.group], icon: <TechIcon icon={p.icon} label={p.name} size={13} /> }))}
          placeholder="https, grpc, jdbc, kafka…"
          renderChip={protocolChip}
        />
      </Field>
      <Field label="Descripción">
        <TextArea rows={3} value={rel.description ?? ''} onChange={(e) => update({ description: e.target.value || null }, 'description')} />
      </Field>
      <Field label="Dirección">
        <Segmented value={rel.direction ?? 'outgoing'} onChange={(v) => update({ direction: v === 'bidirectional' ? 'bidirectional' : null }, 'direction')} options={[{ value: 'outgoing', label: 'Unidireccional' }, { value: 'bidirectional', label: 'Bidireccional' }]} />
      </Field>
      {view ? (
        <Field label="Forma en este lienzo">
          <Segmented
            value={shape}
            onChange={(v) => dispatch({ type: 'view.edge', view: view.id, relation: rel.id, style: !v || v === 'curved' ? null : { shape: v } }, { label: 'Forma de la relación' })}
            options={[{ value: 'curved', label: 'Curva' }, { value: 'straight', label: 'Recta' }, { value: 'step', label: 'Escalonada' }]}
          />
        </Field>
      ) : null}
      <Field label="Estado">
        <Select value={rel.status ?? 'live'} onChange={(v) => update({ status: v && v !== 'live' ? v : null }, 'status')} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
      </Field>
      <div className="flex border-t border-line pt-3">
        <Button variant="danger" size="sm" className="ml-auto" onClick={() => dispatch({ type: 'relation.remove', id: rel.id }, { label: 'Eliminar relación' }) && useUi.getState().select([])}>
          <Trash2 size={13} /> Eliminar relación
        </Button>
      </div>
    </Panel>
  );
}

function ImpliedInspector({ id }: { id: string }) {
  const model = useWorkspace((s) => s.model);
  const [from, to] = id.slice(IMPLIED_PREFIX.length).split('>');
  const relations = sortedValues(model.relations).filter((r) => {
    const chain = (x: Id) => [x, ...descendantsOfSelfChain(x)];
    return chain(r.from).includes(from!) && chain(r.to).includes(to!);
  });
  function descendantsOfSelfChain(x: Id): Id[] {
    const out: Id[] = [];
    let cur = model.elements[x]?.parent;
    while (cur) {
      out.push(cur);
      cur = model.elements[cur]?.parent;
    }
    return out;
  }
  return (
    <Panel>
      <Header icon={<Link2 size={15} className="text-fg-subtle" />} kind="Relación implícita" title={<div className="text-[15px] font-semibold">{model.elements[from!]?.name} → {model.elements[to!]?.name}</div>} />
      <p className="m-0 text-[12.5px] leading-relaxed text-fg-muted">
        Se dibuja porque hay relaciones entre elementos internos que en este nivel no se muestran. Editalas en el nivel donde están definidas.
      </p>
      <div className="flex flex-col gap-1">
        {relations.map((r) => (
          <button key={r.id} type="button" onClick={() => useUi.getState().select([r.from])} className="flex flex-col rounded-sm border border-line px-2.5 py-2 text-left hover:bg-hover">
            <span className="text-[12.5px] text-fg">
              {model.elements[r.from]?.name} → {model.elements[r.to]?.name}
            </span>
            {r.label ? <span className="text-[11.5px] text-fg-subtle">{r.label}</span> : null}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function MultiInspector({ count }: { count: number }) {
  return (
    <Panel>
      <Header icon={<Glyph name="group" size={15} className="text-fg-subtle" />} kind="Selección múltiple" title={<div className="text-[15px] font-semibold">{count} elementos</div>} />
      <p className="m-0 text-[12.5px] leading-relaxed text-fg-muted">
        Usá la barra sobre la selección para alinear y distribuir, <span className="font-mono">⇧L</span> para ordenar automáticamente o <span className="font-mono">Supr</span> para quitarlos del lienzo.
      </p>
    </Panel>
  );
}

function ViewInspector({ view }: { view: View }) {
  const model = useWorkspace((s) => s.model);
  const dispatch = useWorkspace((s) => s.dispatch);
  const scope = view.scope ? model.elements[view.scope] : undefined;
  const [name, setName] = useState(view.name);
  useEffect(() => setName(view.name), [view.name]);
  const count = Object.keys(view.nodes).length;
  return (
    <Panel>
      <Header
        icon={<span className="grid h-6 w-7 place-items-center rounded-sm bg-accent-soft text-[11px] font-bold text-accent">L{view.level}</span>}
        kind={view.level === 1 ? 'Lienzo de contexto' : view.level === 2 ? 'Lienzo de contenedores' : 'Lienzo de componentes'}
        id={view.id}
        title={
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              renameView(view.id, e.target.value);
            }}
            onBlur={() => setName(view.name)}
            className="-mx-1.5 h-9 rounded-sm border border-transparent bg-transparent px-1.5 text-[17px] font-semibold text-fg outline-none hover:border-line focus:border-accent focus:bg-raised"
            aria-label="Nombre del lienzo"
            spellCheck={false}
          />
        }
      />
      {scope ? (
        <button type="button" onClick={() => useUi.getState().select([scope.id])} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-left hover:bg-hover">
          <Glyph name={scope.kind} size={15} style={{ color: `var(--kind-${scope.kind})` }} />
          <span className="flex flex-col">
            <span className="text-[11px] text-fg-subtle">Abre</span>
            <span className="text-[13px] text-fg">{scope.name}</span>
          </span>
        </button>
      ) : null}
      <Field label="Descripción">
        <TextArea rows={3} value={view.description ?? ''} onChange={(e) => dispatch({ type: 'view.update', id: view.id, patch: { description: e.target.value || null } }, { coalesce: `view-desc:${view.id}` })} placeholder="Qué cuenta este diagrama" />
      </Field>
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <Stat label="Elementos" value={count} />
        <Stat label="En el modelo" value={Object.keys(model.elements).length} />
      </div>
      <div className="rounded-md border border-line bg-raised/50 px-3 py-2.5 text-[12px] leading-relaxed text-fg-muted">
        <span className="font-medium text-fg">Tip:</span> doble click en el lienzo crea un elemento; doble click en un sistema o contenedor baja de nivel; <span className="font-mono">Alt ↑</span> sube.
      </div>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <div className="text-[11px] text-fg-subtle">{label}</div>
      <div className="tabular-nums text-[18px] font-semibold text-fg">{value}</div>
    </div>
  );
}

