import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, ChevronDown, Copy, ExternalLink, EyeOff, Layers, Link2, Plus, Server, Trash2, X } from 'lucide-react';
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
  STATUS_LABEL,
  STORE_TYPES,
  STORE_TYPE_LABEL,
  TECHNOLOGIES,
  assumedCapacity,
  channelFields,
  childLevelOf,
  childViewOf,
  descendantsOf,
  findBroker,
  findEngine,
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
  allViewEdges,
  directSystemsIn,
  edgeStyleWith,
  environmentsOf,
  hasManualRoute,
  undeployedPartsOf,
  levelLabel,
  relationBack,
  relationBackWith,
  relationChannels,
  relationStatusOf,
  relationTechnology,
  statusOf,
  type RelationChannel,
} from '@aegon/core';
import { Glyph, TechIcon, GLYPH_NAMES, type GlyphName } from '@aegon/icons';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { convertToInstances, convertToNodes, deleteElement, detailInDeployment, drillInto, removeSelectionFromView, renameView, resetRoute, setSelectionStatus } from '../lib/actions.ts';
import { STATUS_MENU, StatusDot, StatusPicker } from '../ui/StatusPicker.tsx';
import { IMPLIED_PREFIX, PROJECTED_PREFIX } from '../canvas/derive.ts';
import { DeploymentFields, NetworkFields, NodeDetailFields, networkSummary, nodeDetailsSummary } from './DeploymentFields.tsx';
import { viewBadge } from '../lib/view-badge.ts';
import { elementIcon, kindCaption } from '../canvas/nodes/ElementNode.tsx';
import { Button, Field, IconButton, Section, SectionTitle, Segmented, Select, Switch, TagInput, TextArea, TextInput, cn, plural, summarize, type Suggestion } from '../ui/primitives.tsx';
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
  if (selection.nodes.length > 1) return <MultiInspector ids={selection.nodes} view={view} />;
  if (selection.edges.length === 1) {
    const edgeId = selection.edges[0]!;
    if (edgeId.startsWith(IMPLIED_PREFIX)) return <ImpliedInspector id={edgeId} />;
    if (edgeId.startsWith(PROJECTED_PREFIX) && view) return <ProjectedInspector id={edgeId} view={view} />;
    const rel = model.relations[edgeId];
    if (rel) return <RelationInspector key={rel.id} rel={rel} />;
  }
  return view ? <ViewInspector key={view.id} view={view} /> : null;
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="animate-fade flex flex-col gap-4 px-4 pt-3 pb-8">{children}</div>;
}

function Header({ icon, kind, title, id, below }: { icon: ReactNode; kind: string; title: ReactNode; id?: string; below?: ReactNode }) {
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
      {below}
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

/** Puertos escritos a mano ("389, 636"): los válidos, sin repetir. */
function parsePorts(text: string): number[] {
  const ports = text
    .split(/[\s,;/]+/)
    .map((x) => Number(x.replace(/^:/, '')))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535);
  return [...new Set(ports)];
}

/** Puertos de un protocolo: se escriben seguidos y se guardan al salir del campo o con Enter (Esc cancela). */
function PortsInput({ ports, placeholder, label, testId, onChange }: { ports: readonly number[]; placeholder: string; label: string; testId: string; onChange: (ports: number[]) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    const text = draft;
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (text === null) return;
    const next = parsePorts(text);
    if (next.join(',') !== ports.join(',')) onChange(next);
  };
  return (
    // El campo de texto ocupa todo su contenedor: el ancho fijo va afuera.
    <div className="w-[104px] shrink-0">
      <TextInput
        value={draft ?? ports.join(', ')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancelled.current = true;
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        inputMode="numeric"
        className="h-7 px-2 font-mono text-[12px]"
        data-testid={testId}
      />
    </div>
  );
}

/**
 * Protocolos de una relación, cada uno con sus puertos: un renglón por protocolo y, al lado, por
 * dónde va (el puerto es opcional). Lo que se agrega sale de las sugerencias para el destino; con
 * `withPorts` (lienzos de despliegue, donde importa la red) entra ya con su puerto habitual.
 */
function ProtocolsField({
  rel,
  to,
  withPorts,
  update,
  testId = 'relation-protocols',
}: {
  /** La relación o, en una bidireccional, su vuelta: lo que tiene protocolos y puertos. */
  rel: Pick<Relation, 'protocols' | 'ports'>;
  /** Quien escucha en este sentido: de ahí salen las sugerencias. */
  to: Element | undefined;
  withPorts: boolean;
  update: (patch: ReturnType<typeof channelFields>) => void;
  testId?: string;
}) {
  const channels = relationChannels(rel);
  const ids = channels.flatMap((c) => (c.id ? [c.id] : []));
  const write = (next: RelationChannel[]) => update(channelFields(next));
  const add = (id: string) => {
    if (!id || ids.includes(id)) return;
    const known = findProtocol(id)?.port;
    // Los puertos sin protocolo quedan al final.
    write([...channels.filter((c) => c.id), { id, ports: withPorts && known ? [known] : [] }, ...channels.filter((c) => !c.id)]);
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      {channels.map((c, i) => {
        const p = c.id ? findProtocol(c.id) : undefined;
        const name = c.id ? (p?.name ?? c.id) : 'Sin protocolo';
        const key = c.id ?? 'otros';
        return (
          <div key={key} className="flex items-center gap-1.5" data-testid={`protocol-row-${key}`}>
            <span className={cn('flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px]', c.id ? 'text-fg' : 'text-fg-subtle')}>
              {c.id ? <TechIcon icon={p?.icon ?? 'glyph:plug'} label={name} size={13} /> : null}
              <span className="truncate">{name}</span>
            </span>
            <PortsInput
              ports={c.ports}
              placeholder={p?.port ? String(p.port) : 'puerto'}
              label={`Puertos de ${name}`}
              testId={`protocol-ports-${key}`}
              // Un renglón sin protocolo existe solo por sus puertos: sin ellos se va.
              onChange={(ports) => write(channels.flatMap((x, j) => (j !== i ? [x] : x.id || ports.length ? [{ ...x, ports }] : [])))}
            />
            <button
              type="button"
              aria-label={`Quitar ${name}`}
              className="shrink-0 rounded-xs p-1 text-fg-subtle hover:bg-hover hover:text-fg"
              onClick={() => write(channels.filter((_, j) => j !== i))}
              data-testid={`protocol-remove-${key}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <TagInput
        values={[]}
        onChange={(v) => add(v[0] ?? '')}
        suggest={(q) =>
          suggestProtocols(to, q, 14)
            .filter((p) => !ids.includes(p.id))
            .map((p) => ({ value: p.id, label: p.name, hint: p.port ? `${PROTOCOL_GROUP_LABEL[p.group]} · ${p.port}` : PROTOCOL_GROUP_LABEL[p.group], icon: <TechIcon icon={p.icon} label={p.name} size={13} /> }))
        }
        placeholder={channels.length ? 'Agregar otro…' : 'https, grpc, jdbc, kafka…'}
      />
    </div>
  );
}

/** `java, spring-boot` → `Java, Spring Boot` (para el resumen de una sección cerrada). */
const techNames = (technology: readonly string[] | undefined) => (technology ?? []).map((t) => findTechnology(t)?.name ?? t).join(', ');

type DeploymentElement = Extract<Element, { kind: 'node' | 'infra' | 'instance' }>;
const isDeployment = (el: Element): el is DeploymentElement => el.kind === 'node' || el.kind === 'infra' || el.kind === 'instance';

const numberText = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/**
 * Número opcional: vacío es "sin dato". Mientras se escribe guarda el texto tal cual (para poder
 * tipear `0.5` sin que el modelo lo pise a mitad de camino) y avisa cada valor válido, o `null`.
 */
function OptionalNumber({ value, onChange, placeholder, testId }: { value: number | undefined; onChange: (v: number | null) => void; placeholder?: string; testId?: string }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === undefined ? '' : String(value));
  }, [value, focused]);
  return (
    <TextInput
      type="number"
      min={0}
      step="any"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        onChange(e.target.value.trim() && Number.isFinite(n) ? n : null);
      }}
      data-testid={testId}
    />
  );
}

/** Lo que el simulador supone si no se carga la capacidad: `300 (supuesto)` o `sin límite conocido`. */
function capacityPlaceholder(el: Element): string {
  const assumed = assumedCapacity(el);
  return assumed === null ? 'sin límite conocido' : `${numberText.format(assumed)} (supuesto)`;
}

function RiskField({ value, onChange }: { value: Risk | undefined; onChange: (v: Risk | undefined) => void }) {
  return (
    <Field label="Riesgo">
      <Segmented value={value} allowEmpty onChange={onChange} options={RISKS.map((r) => ({ value: r, label: RISK_LABEL[r], tone: `var(--risk-${r})` }))} />
    </Field>
  );
}

/** Último pedido de renombrar ya atendido: seleccionar otro elemento no vuelve a enfocar el nombre. */
let handledRename = 0;

function ElementInspector({ el }: { el: Element }) {
  const model = useWorkspace((s) => s.model);
  const dispatch = useWorkspace((s) => s.dispatch);
  const renameRequest = useUi((s) => s.renameRequest);
  const viewId = useUi((s) => s.activeViewId);
  const view = viewId ? model.views[viewId] : undefined;
  const nameRef = useRef<HTMLInputElement>(null);
  /** Nombre al empezar a editar: Esc vuelve a él. */
  const nameBefore = useRef(el.name);
  const [name, setName] = useState(el.name);
  useEffect(() => setName(el.name), [el.name]);
  useEffect(() => {
    // El foco va al nombre solo cuando se pide renombrar (F2, Enter, doble click), nunca por
    // seleccionar: con el foco en un campo, Supr, Ctrl+C y Ctrl+Z dejarían de actuar sobre el lienzo.
    if (renameRequest > handledRename) {
      handledRename = renameRequest;
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [renameRequest]);

  const update = (patch: ElementPatch, field: string) => dispatch({ type: 'element.update', id: el.id, patch }, { coalesce: `${el.id}:${field}`, label: `Editar ${el.name}` });
  const text = (field: string) => (v: string) => update({ [field]: v.trim() ? v : null } as ElementPatch, field);

  const { icon, label } = elementIcon(el);
  const target = el.kind === 'instance' ? model.elements[el.instance.of] : undefined;
  const views = viewsContaining(model, el.id);
  const tagsSuggest = useMemo(() => {
    const all = new Set<string>();
    for (const e of Object.values(model.elements)) for (const t of e.tags ?? []) all.add(t);
    return [...all];
  }, [model.elements]);
  const drillLevel = childLevelOf(el.kind);
  const children = drillLevel ? descendantsOf(model, el.id).filter((c) => model.elements[c]?.parent === el.id) : [];
  const issues = useMemo(() => validateModel(model).filter((d) => d.entity?.id === el.id && d.severity !== 'info'), [model, el.id]);
  const environments = environmentsOf(model);
  const hasRisk = 'risk' in el || (el.kind !== 'actor' && el.kind !== 'group' && el.kind !== 'instance');
  const risk = 'risk' in el ? el.risk : undefined;
  const status = statusOf(model, el.id);

  return (
    <Panel>
      <Header
        below={<StatusPicker info={status} sourceName={status.source ? model.elements[status.source]?.name : undefined} onChange={(v) => update({ status: v === 'live' ? null : v }, 'status')} />}
        icon={
          <span className="grid h-6 w-6 place-items-center rounded-sm" style={{ color: `var(--kind-${el.kind})`, background: `color-mix(in srgb, var(--kind-${el.kind}) 13%, transparent)` }}>
            <TechIcon icon={icon} label={label} size={14} />
          </span>
        }
        kind={el.kind === 'instance' ? `Instancia · ${kindCaption(el, target)}` : kindCaption(el)}
        id={el.id}
        title={
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) update({ name: e.target.value }, 'name');
            }}
            onFocus={() => (nameBefore.current = el.name)}
            onBlur={() => setName(el.name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                // Esc cancela: vuelve el nombre que tenía al empezar.
                e.stopPropagation();
                if (el.name !== nameBefore.current) update({ name: nameBefore.current }, 'name');
                setName(nameBefore.current);
                (e.target as HTMLInputElement).blur();
              }
            }}
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

      {view ? <DeploymentAdvice el={el} view={view} /> : null}

      <Field label="Descripción">
        <TextArea rows={2} value={el.description ?? ''} onChange={(e) => text('description')(e.target.value)} placeholder="Qué hace, en una o dos líneas" />
      </Field>

      {/* Lo esencial de cada tipo, siempre a la vista. */}
      {el.kind === 'actor' ? (
        <>
          <Field label="Rol o persona">
            <TextInput value={el.role ?? ''} onChange={(e) => text('role')(e.target.value)} placeholder="Cliente minorista, operador…" />
          </Field>
          <Switch checked={el.scope === 'external'} onChange={(v) => update({ scope: v ? 'external' : null }, 'scope')} label="Externo" description="Fuera de la organización" />
        </>
      ) : null}

      {el.kind === 'system' || el.kind === 'container' || el.kind === 'component' ? (
        <>
          {el.kind === 'container' ? (
            <Field label="Tipo de contenedor">
              <Select value={el.containerType} onChange={(v) => update({ containerType: v ?? null }, 'containerType')} options={CONTAINER_TYPES.map((t) => ({ value: t, label: CONTAINER_TYPE_LABEL[t] }))} placeholder="Sin especificar" />
            </Field>
          ) : null}
          <Field label="Tecnología" hint="Lenguajes, frameworks, plataforma">
            <TagInput values={el.technology ?? []} onChange={(v) => update({ technology: v.length ? v : null }, 'technology')} suggest={techSuggest} placeholder="java, spring-boot, react…" renderChip={techChip} />
          </Field>
          <Switch checked={el.scope === 'external'} onChange={(v) => update({ scope: v ? 'external' : null }, 'scope')} label="Externo" description="Lo opera otra organización o equipo" />
        </>
      ) : null}

      {el.kind === 'store' ? <StoreFields el={el} update={update} /> : null}
      {el.kind === 'bus' ? <BusFields el={el} update={update} /> : null}
      {el.kind === 'group' ? <GroupFields el={el} update={update} /> : null}
      {isDeployment(el) ? <DeploymentFields el={el} update={update} /> : null}

      {/* El resto, en secciones: cerradas son una fila con el resumen de lo que tienen. */}
      <div className="flex flex-col border-b border-line">
        {el.kind === 'store' ? (
          <Section title="Detalles" summary={storeSummary(el)} filled={storeHasDetails(el)}>
            <StoreDetailFields el={el} update={update} />
          </Section>
        ) : null}
        {el.kind === 'bus' ? (
          <Section title="Detalles" summary={busSummary(el)} filled={busHasDetails(el)}>
            <BusDetailFields el={el} update={update} />
          </Section>
        ) : null}
        {el.kind === 'group' ? (
          <Section title="Detalles" summary={summarize(el.group.region, el.group.account, el.group.provider === 'network' ? el.group.cidr : undefined)}>
            <GroupDetailFields el={el} update={update} />
          </Section>
        ) : null}
        {el.kind === 'node' || el.kind === 'infra' ? (
          <Section title="Detalles" summary={summarize(el.kind === 'node' ? nodeDetailsSummary(el) : undefined, techNames(el.technology))}>
            {el.kind === 'node' ? <NodeDetailFields el={el} update={update} /> : null}
            <Field label="Tecnología" hint="Plataforma, producto o servicio">
              <TagInput values={el.technology ?? []} onChange={(v) => update({ technology: v.length ? v : null }, 'technology')} suggest={techSuggest} placeholder="openshift, fortigate, route53…" renderChip={techChip} />
            </Field>
          </Section>
        ) : null}
        {isDeployment(el) ? (
          <Section title="Red" summary={networkSummary(el)}>
            <NetworkFields el={el} update={update} />
          </Section>
        ) : null}
        {isDeployment(el) && environments.length ? (
          <Section title="Ambientes" summary={environments.filter((env) => el.environments?.includes(env.id)).map((env) => env.name).join(', ')}>
            <EnvironmentsField el={el} update={update} />
          </Section>
        ) : null}

        <Section
          title="Operación"
          summary={summarize(
            risk ? `riesgo ${RISK_LABEL[risk].toLowerCase()}` : undefined,
            el.owner,
            el.tags?.length ? plural(el.tags.length, 'tag') : undefined,
          )}
        >
          {hasRisk ? <RiskField value={risk} onChange={(v) => update({ risk: v ?? null }, 'risk')} /> : null}
          <Field label="Responsable">
            <TextInput value={el.owner ?? ''} onChange={(e) => text('owner')(e.target.value)} placeholder="Equipo" />
          </Field>
          <Field label="Tags">
            <TagInput
              values={el.tags ?? []}
              onChange={(v) => update({ tags: v.length ? v : null }, 'tags')}
              suggest={(q) => tagsSuggest.filter((t) => t.includes(q.toLowerCase())).map((t) => ({ value: t, label: t }))}
              placeholder="pci, core, legacy…"
            />
          </Field>
        </Section>

        {el.kind === 'system' || el.kind === 'container' || el.kind === 'store' || el.kind === 'bus' ? (
          <Section title="Carga" summary={el.load?.capacity ? `${numberText.format(el.load.capacity)} por segundo por réplica` : undefined}>
            <Field label="Capacidad por réplica" hint="Pedidos por segundo">
              <OptionalNumber
                value={el.load?.capacity}
                onChange={(n) => update({ load: n !== null && n > 0 ? { capacity: n } : null }, 'load')}
                placeholder={capacityPlaceholder(el)}
                testId="inspector-capacity"
              />
            </Field>
            <p className="m-0 text-[11.5px] leading-relaxed text-fg-subtle">Lo usa Simular para ver cuánto tráfico aguanta. Vacío, vale el supuesto para su tipo.</p>
          </Section>
        ) : null}

        <FinOpsFields el={el} update={update} />

        <Section title="Documentación" summary={summarize(el.links?.length ? plural(el.links.length, 'link') : undefined, el.docs?.trim() ? 'notas' : undefined)}>
          <LinksField el={el} update={update} />
          <Field label="Notas" hint="Markdown">
            <TextArea rows={5} value={el.docs ?? ''} onChange={(e) => text('docs')(e.target.value)} placeholder="Decisiones, contratos, SLAs…" className="font-mono text-[12px]" />
          </Field>
        </Section>

        <PropertiesSection el={el} update={update} />
      </div>

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
        <Button variant="ghost" size="sm" onClick={removeSelectionFromView} title="Sale de este lienzo y sigue en el modelo">
          <EyeOff size={13} /> Quitar de este lienzo
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
      <span className="grid h-[18px] min-w-[22px] place-items-center rounded-xs bg-raised px-1 text-[10px] font-bold text-fg-subtle">{viewBadge(view)}</span>
      <span className="truncate">{view.name}</span>
      {active ? <span className="ml-auto text-[11px] text-fg-subtle">actual</span> : null}
    </button>
  );
}

const ICON_CHOICES: GlyphName[] = GLYPH_NAMES.filter((g) => ['store', 'database', 'server', 'cloud', 'file', 'layers', 'globe'].includes(g));
const BUS_ICON_CHOICES: GlyphName[] = GLYPH_NAMES.filter((g) => ['bus', 'queue', 'server', 'cloud', 'network'].includes(g));

type Update = (patch: ElementPatch, field: string) => void;
type StoreElement = Extract<Element, { kind: 'store' }>;
type BusElement = Extract<Element, { kind: 'bus' }>;
type GroupElement = Extract<Element, { kind: 'group' }>;

interface CatalogOption {
  id: string;
  name: string;
  icon: string;
}

const optionClass = (active: boolean, dashed = false) =>
  cn(
    'flex h-8 items-center gap-2 rounded-sm border px-2 text-left text-[12px] transition-colors',
    active ? 'border-accent bg-accent-soft text-fg' : dashed ? 'border-dashed border-line-strong text-fg-muted hover:bg-hover' : 'border-line text-fg-muted hover:bg-hover hover:text-fg',
  );

/**
 * Elección de un catálogo (motor, broker, tipo de grupo). Muestra lo elegido en una fila; al
 * tocarla se despliega la grilla (con buscador si el catálogo es largo) y elegir la cierra.
 */
function CatalogField<T extends CatalogOption>({
  label,
  chosen,
  selected,
  options,
  search,
  onPick,
  onOther,
}: {
  label: string;
  /** Lo elegido hoy. */
  chosen: { icon: string; name: string };
  selected: string;
  /** Opciones para lo escrito en el buscador. */
  options: (query: string) => readonly T[];
  /** Texto de ayuda del buscador; sin él no hay buscador. */
  search?: string;
  onPick: (option: T) => void;
  /** Con esto, la grilla termina con "Otro" (uno que no está en el catálogo). */
  onOther?: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const close = () => {
    setPicking(false);
    setQuery('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      {/* La etiqueta nombra solo a la fila; la grilla queda afuera para no sumarse a ese nombre. */}
      <Field label={label}>
        <button
          type="button"
          aria-expanded={picking}
          onClick={() => (picking ? close() : setPicking(true))}
          className="flex h-8 w-full items-center gap-2 rounded-sm border border-line bg-raised px-2.5 text-left text-[13px] text-fg transition-colors duration-150 hover:border-line-strong"
        >
          <TechIcon icon={chosen.icon} label={chosen.name} size={14} />
          <span className="truncate">{chosen.name}</span>
          <ChevronDown size={13} className={cn('ml-auto shrink-0 text-fg-subtle transition-transform duration-150', picking && 'rotate-180')} />
        </button>
      </Field>
      {picking ? (
        <div
          className="animate-pop flex flex-col gap-2"
          onKeyDown={(e) => {
            // Escape cierra la grilla (y no llega al atajo global, que deselecciona).
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        >
          {search ? <TextInput autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={search} className="h-7 text-[12px]" /> : null}
          <div className="grid max-h-[180px] grid-cols-2 gap-1 overflow-auto pr-0.5">
            {options(query).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onPick(o);
                  close();
                }}
                className={optionClass(selected === o.id)}
              >
                <TechIcon icon={o.icon} label={o.name} size={14} />
                <span className="truncate">{o.name}</span>
              </button>
            ))}
            {onOther ? (
              <button
                type="button"
                onClick={() => {
                  onOther();
                  close();
                }}
                className={optionClass(selected === 'other', true)}
              >
                <Plus size={14} /> Otro
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function patchStore(el: StoreElement, update: Update, patch: Partial<StoreDetails>) {
  const next: Record<string, unknown> = { ...el.store, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
  update({ store: next as StoreDetails }, 'store');
}

/** Lo esencial de una base de datos: su motor y si es de otro. */
function StoreFields({ el, update }: { el: StoreElement; update: Update }) {
  const setStore = (patch: Partial<StoreDetails>) => patchStore(el, update, patch);
  const engine = findEngine(el.store.engine);
  return (
    <>
      <CatalogField
        label="Motor de base de datos"
        chosen={el.store.engine === 'other' ? { icon: el.store.customIcon ?? 'glyph:store', name: el.store.customEngine || 'Otro' } : { icon: engine?.icon ?? 'glyph:store', name: engine?.name ?? el.store.engine }}
        selected={el.store.engine}
        options={(q) => searchCatalog(DB_ENGINES, q, 60)}
        search="Buscar motor (postgres, mongo, redis…)"
        onPick={(e) => setStore({ engine: e.id, type: e.type, customEngine: undefined, customIcon: undefined })}
        onOther={() => setStore({ engine: 'other' })}
      />
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
      <Switch checked={el.scope === 'external'} onChange={(v) => update({ scope: v ? 'external' : null }, 'scope')} label="Externa" description="Pertenece a otro sistema u organización" />
    </>
  );
}

/** Sección "Detalles" de una base de datos: tipo, versión y servicio administrado. */
function StoreDetailFields({ el, update }: { el: StoreElement; update: Update }) {
  const setStore = (patch: Partial<StoreDetails>) => patchStore(el, update, patch);
  return (
    <>
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
    </>
  );
}

const storeSummary = (el: StoreElement) => summarize(el.store.type ? STORE_TYPE_LABEL[el.store.type].toLowerCase() : undefined, el.store.version ? `v${el.store.version}` : undefined, el.store.managed);
/** El tipo que viene con el motor no cuenta como dato cargado: solo lo que alguien completó. */
const storeHasDetails = (el: StoreElement) => Boolean(el.store.version || el.store.managed || (el.store.type && el.store.type !== findEngine(el.store.engine)?.type));

function patchBus(el: BusElement, update: Update, patch: Partial<BusDetails>) {
  const next: Record<string, unknown> = { ...el.bus, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || (Array.isArray(next[k]) && !(next[k] as unknown[]).length)) delete next[k];
  update({ bus: next as BusDetails }, 'bus');
}

/** Lo esencial de un bus de mensajería: su broker y si es de otro. */
function BusFields({ el, update }: { el: BusElement; update: Update }) {
  const setBus = (patch: Partial<BusDetails>) => patchBus(el, update, patch);
  const broker = findBroker(el.bus.broker);
  return (
    <>
      <CatalogField
        label="Broker"
        chosen={el.bus.broker === 'other' ? { icon: el.bus.customIcon ?? 'glyph:bus', name: el.bus.customBroker || 'Otro' } : { icon: broker?.icon ?? 'glyph:bus', name: broker?.name ?? el.bus.broker }}
        selected={el.bus.broker}
        options={(q) => searchCatalog(MESSAGE_BROKERS, q, 40)}
        search="Buscar (kafka, rabbit, sqs, pub/sub…)"
        onPick={(b) => setBus({ broker: b.id, type: b.type, customBroker: undefined, customIcon: undefined })}
        onOther={() => setBus({ broker: 'other' })}
      />
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
      <Switch checked={el.scope === 'external'} onChange={(v) => update({ scope: v ? 'external' : null }, 'scope')} label="Externo" description="Lo opera otro equipo u organización" />
    </>
  );
}

/** Sección "Detalles" de un bus: modelo de mensajería y tópicos o colas. */
function BusDetailFields({ el, update }: { el: BusElement; update: Update }) {
  const setBus = (patch: Partial<BusDetails>) => patchBus(el, update, patch);
  return (
    <>
      <Field label="Modelo de mensajería">
        <Segmented value={el.bus.type} allowEmpty onChange={(v) => setBus({ type: v })} options={BUS_TYPES.map((t) => ({ value: t, label: BUS_TYPE_LABEL[t].split(' ')[0]!, title: BUS_TYPE_LABEL[t] }))} />
      </Field>
      <Field label="Tópicos / colas">
        <TagInput values={el.bus.topics ?? []} onChange={(v) => setBus({ topics: v })} placeholder="pagos.autorizados, notificaciones…" />
      </Field>
    </>
  );
}

const busSummary = (el: BusElement) => summarize(el.bus.type ? BUS_TYPE_LABEL[el.bus.type].split(' ')[0]!.toLowerCase() : undefined, el.bus.topics?.length ? plural(el.bus.topics.length, 'tópico') : undefined);
/** Igual que en las bases: el modelo que viene con el broker no cuenta como dato cargado. */
const busHasDetails = (el: BusElement) => Boolean(el.bus.topics?.length || (el.bus.type && el.bus.type !== findBroker(el.bus.broker)?.type));

function patchGroup(el: GroupElement, update: Update, patch: Partial<GroupElement['group']>) {
  const next: Record<string, unknown> = { ...el.group, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
  update({ group: next as GroupElement['group'] }, 'group');
}

/** Lo esencial de un grupo: qué tipo de agrupación es (nube, red, plataforma…). */
function GroupFields({ el, update }: { el: GroupElement; update: Update }) {
  const provider = GROUP_PROVIDER_CATALOG.find((p) => p.id === el.group.provider);
  return (
    <CatalogField
      label="Tipo de grupo"
      chosen={{ icon: provider?.icon ?? 'glyph:group', name: provider?.name ?? el.group.provider }}
      selected={el.group.provider}
      options={() => GROUP_PROVIDER_CATALOG}
      onPick={(p) => patchGroup(el, update, { provider: p.id })}
    />
  );
}

/** Sección "Detalles" de un grupo: región, cuenta y, si es una red, su CIDR. */
function GroupDetailFields({ el, update }: { el: GroupElement; update: Update }) {
  const setGroup = (patch: Partial<GroupElement['group']>) => patchGroup(el, update, patch);
  return (
    <>
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

function LinksField({ el, update }: { el: Element; update: Update }) {
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
          <TextInput value={l.label ?? ''} onChange={(e) => set(links.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)))} placeholder="Título" className="h-7 w-[38%]! text-[12px]" />
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

/** Sección "Propiedades": pares clave y valor propios del equipo. */
function PropertiesSection({ el, update }: { el: Element; update: Update }) {
  const entries = Object.entries(el.properties ?? {});
  const set = (next: [string, string][]) => update({ properties: next.length ? Object.fromEntries(next) : null }, 'properties');
  return (
    <Section
      title="Propiedades"
      summary={entries.map(([k]) => k).join(', ')}
      action={
        <IconButton size="sm" label="Agregar propiedad" onClick={() => set([...entries, [`clave-${entries.length + 1}`, '']])}>
          <Plus size={13} />
        </IconButton>
      }
    >
      <div className="flex flex-col gap-1.5">
        {entries.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-1">
            <TextInput defaultValue={k} onBlur={(e) => e.target.value.trim() && set(entries.map((x, j) => (j === i ? [e.target.value.trim(), x[1]] : x)))} className="h-7 w-[40%]! font-mono text-[11.5px]" />
            <TextInput value={v} onChange={(e) => set(entries.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} className="h-7 flex-1 text-[12px]" />
            <IconButton size="sm" label="Quitar" onClick={() => set(entries.filter((_, j) => j !== i))}>
              <X size={12} />
            </IconButton>
          </div>
        ))}
        {entries.length ? null : <p className="m-0 text-[11.5px] leading-relaxed text-fg-subtle">Datos propios en pares clave y valor (SLA, repositorio, criticidad…). Sumá uno con el +.</p>}
      </div>
    </Section>
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
  const routed = hasManualRoute(view?.edges?.[rel.id]);
  const status = relationStatusOf(model, rel);
  const twoWay = rel.direction === 'bidirectional';
  const withPorts = view?.level === 'deployment';
  const suggestedFor = (el: Element | undefined) => (el ? `Sugeridos para ${kindCaption(el).split(' · ')[0]!.toLowerCase()}` : undefined);
  // Recién creada, el foco va a la etiqueta (lo siguiente es escribirla). Al seleccionar una que ya
  // estaba, el foco se queda en el lienzo: Supr, Ctrl+Z y Ctrl+C actúan sobre la flecha.
  const [fresh] = useState(() => useUi.getState().fresh.has(rel.id));
  return (
    <Panel>
      <Header
        icon={<Link2 size={15} className="text-accent" />}
        kind="Relación"
        id={rel.id}
        title={<div className="text-[15px] font-semibold">{from?.name} {twoWay ? '↔' : '→'} {to?.name}</div>}
        below={<StatusPicker info={status} sourceName={status.source ? model.elements[status.source]?.name : undefined} onChange={(v) => update({ status: v === 'live' ? null : v }, 'status')} />}
      />
      <Field label="Etiqueta">
        <TextInput value={rel.label ?? ''} onChange={(e) => update({ label: e.target.value || null }, 'label')} placeholder="Lee datos, publica eventos…" autoFocus={fresh} data-testid="relation-label" />
      </Field>
      {/* En una bidireccional, estos son los de la ida: el puerto es del que escucha, o sea del destino. */}
      <Field label={twoWay && to ? `Protocolos y puertos hacia ${to.name}` : 'Protocolos y puertos'} hint={twoWay ? undefined : suggestedFor(to)}>
        {/* Cada alta, baja o cambio de puertos es un paso de deshacer propio (no se juntan como al tipear). */}
        <ProtocolsField rel={rel} to={to} withPorts={withPorts} update={(patch) => dispatch({ type: 'relation.update', id: rel.id, patch }, { label: 'Protocolos de la relación' })} />
      </Field>
      <Field label="Dirección">
        {/* Volver a un solo sentido descarta lo que se había cargado para la vuelta (Ctrl+Z lo devuelve). */}
        <Segmented
          value={rel.direction ?? 'outgoing'}
          onChange={(v) => update(v === 'bidirectional' ? { direction: 'bidirectional' } : { direction: null, ...(rel.back ? { back: null } : {}) }, 'direction')}
          options={[{ value: 'outgoing', label: 'Unidireccional' }, { value: 'bidirectional', label: 'Bidireccional' }]}
        />
      </Field>
      {twoWay ? (
        <Field label={from ? `De vuelta, hacia ${from.name}` : 'De vuelta'}>
          <div className="flex flex-col gap-1.5" data-testid="relation-back">
            <TextInput
              value={rel.back?.label ?? ''}
              onChange={(e) => update({ back: relationBackWith(rel.back, { label: e.target.value || null }) }, 'back-label')}
              placeholder="Qué hace en este sentido (opcional)"
              aria-label="Etiqueta de la vuelta"
              data-testid="relation-back-label"
            />
            <ProtocolsField
              rel={rel.back ?? {}}
              to={from}
              withPorts={withPorts}
              testId="relation-back-protocols"
              update={(patch) => dispatch({ type: 'relation.update', id: rel.id, patch: { back: relationBackWith(rel.back, patch) } }, { label: 'Protocolos de la vuelta' })}
            />
          </div>
        </Field>
      ) : null}
      {view ? (
        <p className="m-0 text-[12px] leading-relaxed text-fg-subtle" data-testid="route-hint">
          {routed ? (
            <>
              Flecha acomodada a mano.{' '}
              <button type="button" className="text-accent hover:underline" onClick={() => resetRoute(rel.id)} data-testid="route-reset">
                Volver al trazo automático
              </button>
            </>
          ) : (
            <>Los puntos de la flecha se arrastran: los del medio la llevan por otro lado; los de las puntas eligen de qué lado toca a cada componente, o la llevan a otro si se sueltan sobre él. La etiqueta también se arrastra, a lo largo de la flecha.</>
          )}
        </p>
      ) : null}
      <div className="flex flex-col border-b border-line">
        <Section
          title="Detalles"
          id="detalles-relacion"
          summary={summarize(
            rel.calls !== undefined && rel.calls !== 1 ? `${numberText.format(rel.calls)} por pedido` : undefined,
            shape === 'straight' ? 'recta' : shape === 'step' ? 'escalonada' : undefined,
            rel.description?.trim(),
          )}
        >
          <Field label="Llamadas por pedido" hint="0.5 = una de cada dos">
            <OptionalNumber value={rel.calls} onChange={(n) => update({ calls: n !== null && n >= 0 && n !== 1 ? n : null }, 'calls')} placeholder="1" testId="relation-calls" />
          </Field>
          <Field label="Descripción">
            <TextArea rows={3} value={rel.description ?? ''} onChange={(e) => update({ description: e.target.value || null }, 'description')} />
          </Field>
          {view ? (
            <Field label="Forma en este lienzo">
              <Segmented
                value={shape}
                onChange={(v) => dispatch({ type: 'view.edge', view: view.id, relation: rel.id, style: edgeStyleWith(view, rel.id, { shape: v ?? null }) }, { label: 'Forma de la relación' })}
                options={[{ value: 'curved', label: 'Curva' }, { value: 'straight', label: 'Recta' }, { value: 'step', label: 'Escalonada' }]}
              />
            </Field>
          ) : null}
        </Section>
      </div>
      <div className="flex">
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

/** Relación lógica dibujada entre instancias en un lienzo de despliegue. */
function ProjectedInspector({ id, view }: { id: string; view: View }) {
  const model = useWorkspace((s) => s.model);
  const [from, to] = id.slice(PROJECTED_PREFIX.length).split('>');
  const edge = allViewEdges(model, view).find((e) => e.projected && e.from === from && e.to === to);
  return (
    <Panel>
      <Header icon={<Link2 size={15} className="text-fg-subtle" />} kind="Relación entre instancias" title={<div className="text-[15px] font-semibold">{model.elements[from!]?.name} → {model.elements[to!]?.name}</div>} />
      <p className="m-0 text-[12.5px] leading-relaxed text-fg-muted">
        Viene de la relación entre lo que despliegan estas instancias. Se dibuja porque el lienzo no muestra un camino de red entre ellas; si lo dibujás (por un balanceador, un egress…), esta línea desaparece.
      </p>
      <div className="flex flex-col gap-1">
        {(edge?.relations ?? []).map((r) => (
          <button key={r.id} type="button" onClick={() => useUi.getState().select([], [r.id])} className="flex flex-col rounded-sm border border-line px-2.5 py-2 text-left hover:bg-hover">
            <span className="text-[12.5px] text-fg">
              {model.elements[r.from]?.name} → {model.elements[r.to]?.name}
            </span>
            {r.label || relationTechnology(r) ? (
              <span className="text-[11.5px] text-fg-subtle">
                {r.label}
                {relationTechnology(r) ? ` [${relationTechnology(r)}]` : ''}
              </span>
            ) : null}
            {/* Lo que va en el otro sentido, si la relación lo declara. */}
            {[relationBack(r)].map((back) =>
              back ? (
                <span key="back" className="text-[11.5px] text-fg-subtle">
                  ← {back.label}
                  {relationTechnology(back) ? ` [${relationTechnology(back)}]` : ''}
                </span>
              ) : null,
            )}
          </button>
        ))}
      </div>
    </Panel>
  );
}

/** Sección "Ambientes": dónde existe un elemento de despliegue (sin marcar ninguno: en todos). */
function EnvironmentsField({ el, update }: { el: Element; update: Update }) {
  const model = useWorkspace((s) => s.model);
  const environments = environmentsOf(model);
  if (!environments.length) return null;
  const current = el.environments ?? [];
  const toggle = (env: string) => {
    const next = current.includes(env) ? current.filter((e) => e !== env) : environments.map((e) => e.id).filter((e) => e === env || current.includes(e));
    update({ environments: next.length && next.length < environments.length ? next : null }, 'environments');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Ambientes">
        {environments.map((env) => {
          const on = current.length === 0 || current.includes(env.id);
          return (
            <button
              key={env.id}
              type="button"
              onClick={() => toggle(env.id)}
              aria-pressed={current.includes(env.id)}
              className={cn(
                'h-7 rounded-sm border px-2.5 text-[12px] transition-colors',
                current.includes(env.id) ? 'border-accent bg-accent-soft text-fg' : on ? 'border-line text-fg-muted hover:bg-hover' : 'border-line text-fg-subtle hover:bg-hover',
              )}
            >
              {env.name}
            </button>
          );
        })}
      </div>
      {current.length ? null : <p className="m-0 text-[11.5px] leading-relaxed text-fg-subtle">Sin marcar ninguno, existe en todos los ambientes.</p>}
    </div>
  );
}

function MultiInspector({ ids, view }: { ids: Id[]; view: View | undefined }) {
  const model = useWorkspace((s) => s.model);
  const direct = view ? directSystemsIn(model, view).filter((e) => ids.includes(e.id)) : [];
  return (
    <Panel>
      <Header icon={<Glyph name="group" size={15} className="text-fg-subtle" />} kind="Selección múltiple" title={<div className="text-[15px] font-semibold">{ids.length} elementos</div>} />
      <p className="m-0 text-[12.5px] leading-relaxed text-fg-muted">
        Usá la barra sobre la selección para alinear y distribuir, <span className="font-mono">⇧L</span> para ordenar automáticamente, <span className="font-mono">Ctrl+D</span> para duplicarlos o <span className="font-mono">Supr</span> para eliminarlos.
      </p>
      <Field label="Marcar todos como">
        <div className="flex flex-wrap gap-1.5" data-testid="multi-status">
          {STATUS_MENU.map((status) => (
            <button key={status} type="button" className="status-chip" data-status={status} onClick={() => setSelectionStatus(status)} data-testid={`multi-status-${status}`}>
              <StatusDot status={status} />
              {STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      </Field>
      {direct.length ? (
        <WhatIsIt
          lead={`${direct.length === 1 ? 'Hay 1 sistema puesto' : `Hay ${direct.length} sistemas puestos`} directo en el despliegue: así no ${direct.length === 1 ? 'lleva' : 'llevan'} IP ni réplicas. ¿Qué ${direct.length === 1 ? 'es' : 'son'}?`}
          ids={direct.map((e) => e.id)}
        />
      ) : null}
    </Panel>
  );
}

/** Las dos salidas de un sistema puesto directo en un despliegue: es un equipo (nodo) o es software (instancia). */
function WhatIsIt({ lead, ids }: { lead: string; ids: Id[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent/30 bg-accent-soft/50 px-3 py-2.5 text-[12px] leading-relaxed text-fg-muted" data-testid="deploy-what-is-it">
      <span>{lead}</span>
      <div className="flex flex-col gap-1.5">
        <Button variant="secondary" size="sm" className="justify-start" onClick={() => convertToNodes(ids)} data-testid="convert-node">
          <Server size={13} className="shrink-0" /> {ids.length === 1 ? 'Un servidor o equipo' : 'Servidores o equipos'}
          <span className="ml-auto shrink-0 pl-2 text-[11px] text-fg-subtle">nodo, con IP</span>
        </Button>
        <Button variant="secondary" size="sm" className="justify-start" onClick={() => convertToInstances(ids)} data-testid="convert-instance">
          <Box size={13} className="shrink-0" /> <span className="truncate">Software que corre acá</span>
          <span className="ml-auto shrink-0 pl-2 text-[11px] text-fg-subtle">instancia, con puertos</span>
        </Button>
      </div>
    </div>
  );
}

/** Lo que conviene saber de un elemento según cómo está puesto en un lienzo de despliegue. */
function DeploymentAdvice({ el, view }: { el: Element; view: View }) {
  const model = useWorkspace((s) => s.model);
  if (view.level !== 'deployment' || !view.nodes[el.id]) return null;
  const system = el.kind === 'instance' ? model.elements[el.instance.of] : el;
  const parts = system?.kind === 'system' ? undeployedPartsOf(model, system.id, view.environment) : [];
  const direct = el.kind === 'system' && el.scope !== 'external';
  if (!direct && !parts.length) return null;
  return (
    <>
      {direct ? <WhatIsIt lead="Puesto directo en el despliegue no lleva IP ni réplicas. ¿Qué es en este diagrama?" ids={[el.id]} /> : null}
      {parts.length ? (
        <Button variant="secondary" size="sm" className="justify-start" onClick={() => detailInDeployment(el.id)} data-testid="deploy-detail">
          <Layers size={13} /> Detallar en sus contenedores
          <span className="ml-auto font-mono text-[11px] text-fg-subtle">{parts.length}</span>
        </Button>
      ) : null}
    </>
  );
}

function ViewInspector({ view }: { view: View }) {
  const model = useWorkspace((s) => s.model);
  const dispatch = useWorkspace((s) => s.dispatch);
  const scope = view.scope ? model.elements[view.scope] : undefined;
  const [name, setName] = useState(view.name);
  useEffect(() => setName(view.name), [view.name]);
  const count = Object.keys(view.nodes).length;
  const environments = environmentsOf(model);
  const systems = sortedValues(model.elements).filter((e) => e.kind === 'system' && e.scope !== 'external');
  return (
    <Panel>
      <Header
        icon={<span className="grid h-6 min-w-7 place-items-center rounded-sm bg-accent-soft px-1 text-[11px] font-bold text-accent">{viewBadge(view)}</span>}
        kind={view.level === 1 ? 'Lienzo de contexto' : view.level === 2 ? 'Lienzo de contenedores' : view.level === 3 ? 'Lienzo de componentes' : `${levelLabel(view.level)} por ambiente`}
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
      {view.level === 'deployment' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ambiente">
            <Select
              value={view.environment}
              onChange={(v) => v && dispatch({ type: 'view.update', id: view.id, patch: { environment: v } }, { label: 'Ambiente del lienzo' })}
              options={environments.map((e) => ({ value: e.id, label: e.name }))}
            />
          </Field>
          <Field label="Sistema">
            <Select
              value={view.scope}
              onChange={(v) => dispatch({ type: 'view.update', id: view.id, patch: { scope: v ?? null } }, { label: 'Sistema del lienzo' })}
              options={systems.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Todos"
            />
          </Field>
        </div>
      ) : null}
      {scope && view.level !== 'deployment' ? (
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
        {view.level === 'deployment' ? (
          <>
            <span className="font-medium text-fg">Cómo se arma:</span> un servidor, una VM o una red es un <span className="text-fg">nodo</span> y lleva la IP. Con doble click adentro se crea lo que corre ahí (un servicio, una base), que lleva sus puertos. Las flechas con protocolo y puerto son lo que hay que abrir en el firewall. Lo <span className="text-fg">nuevo</span>, lo que <span className="text-fg">se modifica</span> y lo que <span className="text-fg">se da de baja</span> se marca desde el estado (bajo el nombre, o con click derecho).
          </>
        ) : (
          <>
            <span className="font-medium text-fg">Tip:</span> doble click en el lienzo crea un elemento; doble click en un sistema o contenedor lo abre acá mismo, con lo que contiene adentro (con <span className="font-mono">Alt</span>, en un lienzo aparte).
          </>
        )}
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

