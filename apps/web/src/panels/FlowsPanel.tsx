import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import {
  ArrowLeftRight,
  ChevronLeft,
  Cog,
  Copy,
  CornerUpRight,
  Crosshair,
  FileText,
  GripVertical,
  MoreHorizontal,
  MoveRight,
  Play,
  Plus,
  Split,
  StickyNote,
  Trash2,
  Workflow,
} from 'lucide-react';
import {
  STEP_TYPE_LABEL,
  pathLetter,
  relationForStep,
  representativeInView,
  stepLabel,
  stepTitle,
  type Element,
  type Flow,
  type FlowStep,
  type Id,
  type LeafStep,
} from '@aegon/core';
import { Glyph } from '@aegon/icons';
import { useUi, type StepPath } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import {
  addStep,
  addStepFromSelection,
  copyFlow,
  createFlow,
  duplicateFlow,
  moveStep,
  openFlow,
  playFlow,
  removeFlow,
  replaceStep,
  selectStep,
  setSteps,
  startPick,
  updateFlow,
} from '../lib/flow-actions.ts';
import { confirmDialog } from '../store/dialogs.ts';
import {
  Button,
  IconButton,
  Segmented,
  Select,
  TextArea,
  TextInput,
  cn,
} from '../ui/primitives.tsx';

/** Estilo de cada tipo de paso: ícono y color (el mismo en el editor y al reproducir). */
export const STEP_STYLE: Record<FlowStep['type'], { icon: typeof Cog; color: string }> = {
  message: { icon: MoveRight, color: 'var(--accent)' },
  process: { icon: Cog, color: 'var(--kind-component)' },
  note: { icon: StickyNote, color: 'var(--fg-muted)' },
  goto: { icon: CornerUpRight, color: 'var(--warn)' },
  paths: { icon: Split, color: 'var(--ok)' },
};

/** Pestaña "Flujos" del explorador: la lista o el editor del flujo abierto. */
export function FlowsPanel() {
  const edit = useUi((s) => s.flowEdit);
  const flow = useWorkspace((s) => (edit ? s.model.flows?.[edit.id] : undefined));
  return flow ? <FlowEditor flow={flow} /> : <FlowList />;
}

// ---------------------------------------------------------------------------------------------
// Lista

function FlowList() {
  const flows = useWorkspace((s) => s.model.flows);
  const views = useWorkspace((s) => s.model.views);
  const activeViewId = useUi((s) => s.activeViewId);
  const all = useMemo(
    () => Object.values(flows ?? {}).sort((a, b) => a.name.localeCompare(b.name)),
    [flows],
  );
  const here = all.filter((f) => f.view === activeViewId);
  const others = all.filter((f) => f.view !== activeViewId);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="flows-panel">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <p className="m-0 flex-1 text-[12px] leading-snug text-fg-subtle">
          Secuencias de pasos que se reproducen como una presentación.
        </p>
        <Button size="sm" variant="primary" onClick={() => createFlow()} data-testid="flow-new">
          <Plus size={13} /> Nuevo
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
        {!all.length ? (
          <div className="mx-1.5 mt-2 flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-6 text-center">
            <Workflow size={22} className="text-fg-subtle" />
            <p className="m-0 text-[12.5px] leading-relaxed text-fg-subtle">
              Contá cómo viaja un pedido por la arquitectura: quién llama a quién, en qué orden y
              qué pasa si algo falla.
            </p>
          </div>
        ) : null}
        {here.length ? (
          <ListSection title="En este lienzo">
            {here.map((f) => (
              <FlowRow key={f.id} flow={f} viewName={null} />
            ))}
          </ListSection>
        ) : null}
        {others.length ? (
          <ListSection title={here.length ? 'Otros lienzos' : 'Flujos'}>
            {others.map((f) => (
              <FlowRow
                key={f.id}
                flow={f}
                viewName={f.view ? (views[f.view]?.name ?? f.view) : 'Sin lienzo'}
              />
            ))}
          </ListSection>
        ) : null}
      </div>
    </div>
  );
}

function ListSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-1">
      <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.05em] text-fg-subtle uppercase">
        {title}
      </div>
      {children}
    </div>
  );
}

function FlowRow({ flow, viewName }: { flow: Flow; viewName: string | null }) {
  const count = flow.steps.length;
  return (
    <div
      className="group flex h-12 cursor-pointer items-center gap-2.5 rounded-sm px-2 hover:bg-hover"
      onClick={() => openFlow(flow.id)}
      data-testid={`flow-row-${flow.id}`}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent">
        <Workflow size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] text-fg">{flow.name}</span>
        <span className="truncate text-[11px] text-fg-subtle">
          {count} {count === 1 ? 'paso' : 'pasos'}
          {viewName ? ` · ${viewName}` : ''}
        </span>
      </span>
      <IconButton
        size="sm"
        label="Reproducir"
        disabled={!count}
        onClick={(e) => {
          e.stopPropagation();
          playFlow(flow.id);
        }}
        className="text-accent"
        data-testid={`flow-play-${flow.id}`}
      >
        <Play size={13} />
      </IconButton>
      <FlowMenu flow={flow} />
    </div>
  );
}

function FlowMenu({ flow }: { flow: Flow }) {
  const remove = async () => {
    const ok = await confirmDialog({
      title: `¿Eliminar el flujo "${flow.name}"?`,
      description: `Se borran sus ${flow.steps.length} pasos. Los elementos y relaciones del modelo no cambian.`,
      confirmLabel: 'Eliminar flujo',
      tone: 'danger',
      icon: <Trash2 size={16} />,
    });
    if (ok) removeFlow(flow.id);
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Acciones del flujo"
          onClick={(e) => e.stopPropagation()}
          className="grid h-6 w-6 place-items-center rounded-xs text-fg-subtle hover:bg-press hover:text-fg"
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu min-w-[220px]"
          align="end"
          sideOffset={4}
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu.Item
            className="menu-item"
            onSelect={() => playFlow(flow.id)}
            disabled={!flow.steps.length}
          >
            <Play size={14} /> Reproducir
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => duplicateFlow(flow.id)}>
            <Copy size={14} /> Duplicar
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item className="menu-item" onSelect={() => void copyFlow(flow.id, 'text')}>
            <FileText size={14} /> Copiar como texto
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="menu-item"
            onSelect={() => void copyFlow(flow.id, 'mermaid')}
          >
            <Workflow size={14} /> Copiar como Mermaid
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item className="menu-item" data-danger onSelect={() => void remove()}>
            <Trash2 size={14} /> Eliminar
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ---------------------------------------------------------------------------------------------
// Editor

function FlowEditor({ flow }: { flow: Flow }) {
  const views = useWorkspace((s) => s.model.views);
  const selected = useUi((s) => s.flowEdit?.step ?? null);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const [showDesc, setShowDesc] = useState(!!flow.description);

  const drop = (e: DragEvent, index: number) => {
    e.preventDefault();
    if (drag && drag.from !== index && drag.from + 1 !== index) {
      const to = drag.from < index ? index - 1 : index;
      setSteps(flow.id, moveStep(flow.steps, [drag.from], to), 'Reordenar pasos');
      useUi.getState().setFlowEdit({ id: flow.id, step: [to] });
    }
    setDrag(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="flow-editor">
      <div className="flex items-center gap-1 px-2 pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => useUi.getState().setFlowEdit(null)}
          className="px-1.5"
          data-testid="flow-back"
        >
          <ChevronLeft size={14} /> Flujos
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="primary"
          disabled={!flow.steps.length}
          onClick={() => playFlow(flow.id)}
          data-testid="flow-play"
        >
          <Play size={12} /> Reproducir
        </Button>
        <FlowMenu flow={flow} />
      </div>

      <div className="flex flex-col gap-2 px-3 pt-2 pb-2">
        <input
          key={flow.id}
          defaultValue={flow.name}
          onChange={(e) =>
            e.target.value.trim() && updateFlow(flow.id, { name: e.target.value }, 'name')
          }
          className="-mx-1.5 h-8 rounded-sm border border-transparent bg-transparent px-1.5 text-[15px] font-semibold text-fg outline-none hover:border-line focus:border-accent focus:bg-raised"
          aria-label="Nombre del flujo"
          data-testid="flow-name"
          spellCheck={false}
        />
        {showDesc ? (
          <TextArea
            rows={2}
            defaultValue={flow.description ?? ''}
            onChange={(e) => updateFlow(flow.id, { description: e.target.value }, 'description')}
            placeholder="De qué se trata (se muestra en la portada al reproducir)"
            className="min-h-[52px] text-[12.5px]"
          />
        ) : (
          <button
            type="button"
            className="self-start text-[11.5px] text-fg-subtle hover:text-accent"
            onClick={() => setShowDesc(true)}
          >
            + Agregar descripción
          </button>
        )}
        <div className="flex items-center gap-2 text-[11.5px] text-fg-subtle">
          <span className="shrink-0">Se reproduce en</span>
          <div className="min-w-0 flex-1">
            <Select
              value={flow.view}
              onChange={(v) => updateFlow(flow.id, { view: v }, 'view')}
              options={Object.values(views)
                .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
                .map((v) => ({ value: v.id, label: `L${v.level} · ${v.name}` }))}
              placeholder="Lienzo actual"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-line px-2 pt-2 pb-3">
        {!flow.steps.length ? (
          <p className="m-1 rounded-md border border-dashed border-line px-3 py-3 text-[12px] leading-relaxed text-fg-subtle">
            Seleccioná una relación (o dos elementos) en el lienzo y tocá{' '}
            <b className="text-fg-muted">+ Paso</b>: el mensaje se completa solo. Con un elemento,
            se agrega un proceso.
          </p>
        ) : null}
        {flow.steps.map((step, i) => (
          <div
            key={i}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              setDrag({ ...drag, over: e.clientY < rect.top + rect.height / 2 ? i : i + 1 });
            }}
            onDrop={(e) => drop(e, drag?.over ?? i)}
          >
            {drag?.over === i && drag.from !== i && drag.from + 1 !== i ? <DropLine /> : null}
            <StepCard
              flow={flow}
              step={step}
              path={[i]}
              label={stepLabel(i)}
              selected={selected}
              dragHandle={{
                onDragStart: (e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(i));
                  setDrag({ from: i, over: null });
                },
                onDragEnd: () => setDrag(null),
              }}
            />
            {i === flow.steps.length - 1 && drag?.over === i + 1 && drag.from !== i ? (
              <DropLine />
            ) : null}
          </div>
        ))}
        <AddStepButton flow={flow} />
      </div>
    </div>
  );
}

function DropLine() {
  return <div className="mx-1 my-0.5 h-[2px] rounded-full bg-accent" />;
}

function AddStepButton({ flow, inPath }: { flow: Flow; inPath?: { top: number; path: number } }) {
  const selection = useUi((s) => s.selection);
  const hasSelection =
    selection.edges.length === 1 || (selection.nodes.length >= 1 && selection.nodes.length <= 2);
  const flows = useWorkspace((s) => s.model.flows);
  const otherFlows = useMemo(
    () => Object.values(flows ?? {}).filter((f) => f.id !== flow.id),
    [flows, flow.id],
  );
  const pick = (kind: 'message' | 'process') =>
    startPick({ flow: flow.id, path: null, kind, ...(inPath ? { append: inPath } : {}) });
  return (
    <div className={cn('flex gap-1', inPath ? 'mt-1' : 'mt-2')}>
      <Button
        size="sm"
        className={cn('flex-1 justify-center', inPath && 'h-7 text-[12px]')}
        onClick={() => {
          if (!addStepFromSelection(flow.id, inPath)) pick('message');
        }}
        title={
          hasSelection
            ? 'Agrega un paso con lo seleccionado en el lienzo'
            : 'Elegí origen y destino en el lienzo'
        }
        data-testid={inPath ? `add-step-path-${inPath.top}-${inPath.path}` : 'add-step'}
      >
        <Plus size={13} /> {inPath ? 'Paso en este camino' : 'Paso'}
        {hasSelection ? (
          <span className="ml-1 rounded-full bg-accent-soft px-1.5 text-[10.5px] font-semibold text-accent">
            de la selección
          </span>
        ) : null}
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton
            size="sm"
            label="Elegir el tipo de paso"
            className={cn('border border-line', inPath ? 'h-7 w-7' : 'h-8 w-8')}
            data-testid="add-step-menu"
          >
            <MoreHorizontal size={14} />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu min-w-[230px]" align="end" sideOffset={4}>
            <DropdownMenu.Item className="menu-item" onSelect={() => pick('message')}>
              <MoveRight size={14} /> Mensaje <span className="shortcut">elegir en el lienzo</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => pick('process')}>
              <Cog size={14} /> Proceso <span className="shortcut">elegir en el lienzo</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="menu-item"
              onSelect={() => addStep(flow.id, { type: 'note', title: 'Nota' }, inPath)}
              data-testid="add-note"
            >
              <StickyNote size={14} /> Nota
            </DropdownMenu.Item>
            {!inPath ? (
              <>
                <DropdownMenu.Separator className="menu-sep" />
                <DropdownMenu.Item
                  className="menu-item"
                  onSelect={() =>
                    addStep(flow.id, {
                      type: 'paths',
                      mode: 'alternate',
                      title: '¿Qué pasa?',
                      paths: [
                        { name: 'Sí', steps: [] },
                        { name: 'No', steps: [] },
                      ],
                    })
                  }
                  data-testid="add-alternate"
                >
                  <Split size={14} /> Caminos alternativos{' '}
                  <span className="shortcut">uno u otro</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="menu-item"
                  onSelect={() =>
                    addStep(flow.id, {
                      type: 'paths',
                      mode: 'parallel',
                      title: 'En paralelo',
                      paths: [
                        { name: 'Camino A', steps: [] },
                        { name: 'Camino B', steps: [] },
                      ],
                    })
                  }
                >
                  <Split size={14} className="rotate-90" /> Caminos paralelos{' '}
                  <span className="shortcut">a la vez</span>
                </DropdownMenu.Item>
              </>
            ) : null}
            {otherFlows.length ? (
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="menu-item">
                  <CornerUpRight size={14} /> Ir a otro flujo
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent className="menu" sideOffset={4}>
                    {otherFlows.map((f) => (
                      <DropdownMenu.Item
                        key={f.id}
                        className="menu-item"
                        onSelect={() => addStep(flow.id, { type: 'goto', flow: f.id }, inPath)}
                      >
                        {f.name}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

const samePath = (a: StepPath | null, b: StepPath) =>
  !!a && a.length === b.length && a.every((v, i) => v === b[i]);

function StepCard({
  flow,
  step,
  path,
  label,
  selected,
  dragHandle,
}: {
  flow: Flow;
  step: FlowStep;
  path: StepPath;
  label: string;
  selected: StepPath | null;
  dragHandle?: { onDragStart: (e: DragEvent) => void; onDragEnd: () => void };
}) {
  const model = useWorkspace((s) => s.model);
  const isSelected = samePath(selected, path);
  const style = STEP_STYLE[step.type];
  const name = (id: Id) => model.elements[id]?.name ?? id;
  const missing = (id: Id) => !model.elements[id];
  const subtitle =
    step.type === 'message' ? (
      <span className={cn((missing(step.from) || missing(step.to)) && 'text-danger')}>
        {name(step.from)} → {name(step.to)}
      </span>
    ) : step.type === 'process' ? (
      <span className={cn(missing(step.element) && 'text-danger')}>{name(step.element)}</span>
    ) : step.type === 'goto' ? (
      `→ ${model.flows?.[step.flow]?.name ?? step.flow}`
    ) : step.type === 'paths' ? (
      `${step.paths.length} caminos ${step.mode === 'alternate' ? 'alternativos' : 'en paralelo'}`
    ) : (
      STEP_TYPE_LABEL.note
    );
  const select = () => selectStep(flow.id, isSelected ? null : path);
  const write = (next: FlowStep | null, label2: string, coalesce?: string) =>
    setSteps(flow.id, replaceStep(flow.steps, path, next), label2, coalesce);
  const field = (key: 'title' | 'description', value: string) =>
    write(
      { ...step, [key]: value || undefined } as FlowStep,
      'Editar paso',
      `${path.join('.')}:${key}`,
    );

  return (
    <div
      className={cn(
        'group/step mb-1 rounded-md border bg-panel transition-colors',
        isSelected
          ? 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]'
          : 'border-line hover:border-line-strong',
      )}
      data-testid={`step-${path.join('-')}`}
    >
      <div className="flex cursor-pointer items-center gap-2 py-1.5 pr-1 pl-1" onClick={select}>
        {dragHandle ? (
          <span
            draggable
            onDragStart={dragHandle.onDragStart}
            onDragEnd={dragHandle.onDragEnd}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab text-fg-subtle opacity-0 group-hover/step:opacity-100 active:cursor-grabbing"
            title="Arrastrar para reordenar"
          >
            <GripVertical size={13} />
          </span>
        ) : (
          <span className="w-[13px]" />
        )}
        <span
          className="flex h-5 min-w-[22px] shrink-0 items-center justify-center rounded-full px-1.5 font-mono text-[10.5px] font-bold text-white"
          style={{ background: style.color }}
        >
          {label}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              'truncate text-[12.5px]',
              step.title ? 'text-fg' : 'text-fg-muted italic',
            )}
          >
            {stepTitle(model, step)}
          </span>
          <span className="truncate text-[11px] text-fg-subtle">{subtitle}</span>
        </span>
        <StepMenu flow={flow} step={step} path={path} />
      </div>
      {isSelected ? (
        <div
          className="flex flex-col gap-2 border-t border-line px-2.5 pt-2 pb-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <TextInput
            key={`t-${path.join('.')}`}
            defaultValue={step.title ?? ''}
            onChange={(e) => field('title', e.target.value)}
            placeholder={stepTitle(model, { ...step, title: undefined })}
            className="h-7 text-[12.5px]"
            aria-label="Título del paso"
            data-testid="step-title"
          />
          <TextArea
            key={`d-${path.join('.')}`}
            rows={2}
            defaultValue={step.description ?? ''}
            onChange={(e) => field('description', e.target.value)}
            placeholder="Detalle: payload, endpoint, reglas… (admite `código` y **negrita**)"
            className="min-h-[48px] text-[12px]"
          />
          {step.type === 'message' ? (
            <MessageFields flow={flow} step={step} path={path} write={write} />
          ) : null}
          {step.type === 'process' ? (
            <ElementField
              label="Elemento"
              value={step.element}
              flow={flow}
              onChange={(v) => write({ ...step, element: v }, 'Editar paso')}
              onPick={() => startPick({ flow: flow.id, path, kind: 'process' })}
            />
          ) : null}
          {step.type === 'goto' ? (
            <Select
              value={step.flow}
              onChange={(v) => v && write({ ...step, flow: v }, 'Editar paso')}
              options={Object.values(model.flows ?? {})
                .filter((f) => f.id !== flow.id)
                .map((f) => ({ value: f.id, label: f.name }))}
            />
          ) : null}
          {step.type === 'paths' && path.length === 1 ? (
            <PathsFields flow={flow} step={step} top={path[0]} selected={selected} write={write} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MessageFields({
  flow,
  step,
  path,
  write,
}: {
  flow: Flow;
  step: Extract<LeafStep, { type: 'message' }>;
  path: StepPath;
  write: (s: FlowStep, label: string) => void;
}) {
  const model = useWorkspace((s) => s.model);
  const rel = relationForStep(model, step);
  const view = flow.view ? model.views[flow.view] : undefined;
  const sameNode =
    view &&
    representativeInView(model, view, step.from) &&
    representativeInView(model, view, step.from) === representativeInView(model, view, step.to);
  const set = (patch: Partial<typeof step>) => {
    const next = { ...step, ...patch };
    delete next.relation;
    write(next, 'Editar paso');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-1">
        <ElementField
          label="Origen"
          value={step.from}
          flow={flow}
          onChange={(v) => set({ from: v })}
        />
        <IconButton
          size="sm"
          label="Invertir"
          className="mb-1"
          onClick={() => set({ from: step.to, to: step.from })}
        >
          <ArrowLeftRight size={12} />
        </IconButton>
        <ElementField
          label="Destino"
          value={step.to}
          flow={flow}
          onChange={(v) => set({ to: v })}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[11.5px]"
          onClick={() => startPick({ flow: flow.id, path, kind: 'message' })}
        >
          <Crosshair size={12} /> Elegir en el lienzo
        </Button>
        <span className="flex-1" />
        <span
          className={cn('truncate text-[11px]', rel ? 'text-fg-subtle' : 'text-warn')}
          title={rel ? `Relación ${rel.id}` : undefined}
        >
          {rel ? `Sobre «${rel.label ?? 'relación'}»` : 'Sin relación: se dibuja una flecha'}
        </span>
      </div>
      {sameNode ? (
        <p className="m-0 text-[11px] text-warn">
          En este lienzo los dos caen en el mismo nodo: se va a abrir el lienzo de más detalle.
        </p>
      ) : null}
    </div>
  );
}

function ElementField({
  label,
  value,
  flow,
  onChange,
  onPick,
}: {
  label: string;
  value: Id;
  flow: Flow;
  onChange: (v: Id) => void;
  onPick?: () => void;
}) {
  const model = useWorkspace((s) => s.model);
  const options = useMemo(() => {
    const view = flow.view ? model.views[flow.view] : undefined;
    const rank = (el: Element) => (view?.nodes[el.id] ? 0 : 1);
    return Object.values(model.elements)
      .filter((el) => el.kind !== 'group')
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .map((el) => ({
        value: el.id,
        label: `${el.name}${view && !view.nodes[el.id] ? ' ·' : ''}`,
      }));
  }, [model.elements, model.views, flow.view]);
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
        {model.elements[value] ? (
          <Glyph
            name={model.elements[value]!.kind}
            size={11}
            style={{ color: `var(--kind-${model.elements[value]!.kind})` }}
          />
        ) : null}
        {label}
        {onPick ? (
          <button
            type="button"
            className="ml-auto text-fg-subtle hover:text-accent"
            title="Elegir en el lienzo"
            onClick={onPick}
          >
            <Crosshair size={11} />
          </button>
        ) : null}
      </span>
      <Select value={value} onChange={(v) => v && onChange(v)} options={options} />
    </label>
  );
}

function PathsFields({
  flow,
  step,
  top,
  selected,
  write,
}: {
  flow: Flow;
  step: Extract<FlowStep, { type: 'paths' }>;
  top: number;
  selected: StepPath | null;
  write: (s: FlowStep, label: string) => void;
}) {
  const setPaths = (paths: typeof step.paths, label: string) => write({ ...step, paths }, label);
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        value={step.mode}
        onChange={(v) => v && write({ ...step, mode: v }, 'Editar paso')}
        options={[
          {
            value: 'alternate',
            label: 'Alternativos',
            title: 'Uno u otro (al reproducir se elige)',
          },
          { value: 'parallel', label: 'Paralelos', title: 'Todos a la vez' },
        ]}
      />
      {step.paths.map((p, pi) => (
        <div
          key={pi}
          className="rounded-md border border-line bg-raised/40 p-1.5"
          data-testid={`path-${top}-${pi}`}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-xs bg-ok/15 font-mono text-[10.5px] font-bold text-ok">
              {pathLetter(pi)}
            </span>
            <TextInput
              key={`p-${pi}-${p.name}`}
              defaultValue={p.name}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== p.name &&
                setPaths(
                  step.paths.map((x, k) => (k === pi ? { ...x, name: e.target.value.trim() } : x)),
                  'Renombrar camino',
                )
              }
              className="h-7 flex-1 text-[12px]"
              aria-label="Nombre del camino"
            />
            <IconButton
              size="sm"
              label="Quitar camino"
              disabled={step.paths.length < 2}
              onClick={() =>
                setPaths(
                  step.paths.filter((_, k) => k !== pi),
                  'Quitar camino',
                )
              }
            >
              <Trash2 size={12} />
            </IconButton>
          </div>
          {p.steps.map((s, j) => (
            <StepCard
              key={j}
              flow={flow}
              step={s}
              path={[top, pi, j]}
              label={stepLabel(top, pi, j)}
              selected={selected}
            />
          ))}
          <AddStepButton flow={flow} inPath={{ top, path: pi }} />
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() =>
          setPaths(
            [...step.paths, { name: `Camino ${pathLetter(step.paths.length)}`, steps: [] }],
            'Agregar camino',
          )
        }
      >
        <Plus size={13} /> Camino
      </Button>
    </div>
  );
}

function StepMenu({ flow, step, path }: { flow: Flow; step: FlowStep; path: StepPath }) {
  const list =
    path.length === 1
      ? flow.steps
      : (flow.steps[path[0]] as Extract<FlowStep, { type: 'paths' }>).paths[path[1]]!.steps;
  const index = path[path.length - 1]!;
  const move = (to: number) => {
    setSteps(flow.id, moveStep(flow.steps, path, to), 'Reordenar pasos');
    useUi
      .getState()
      .setFlowEdit({
        id: flow.id,
        step: (path.length === 1 ? [to] : [path[0], path[1], to]) as StepPath,
      });
  };
  const toPaths = (mode: 'alternate' | 'parallel') =>
    setSteps(
      flow.id,
      replaceStep(flow.steps, path, {
        type: 'paths',
        mode,
        title: step.title,
        paths: [
          { name: mode === 'alternate' ? 'Sí' : 'Camino A', steps: [step as LeafStep] },
          { name: mode === 'alternate' ? 'No' : 'Camino B', steps: [] },
        ],
      }),
      'Convertir en caminos',
    );
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Acciones del paso"
          onClick={(e) => e.stopPropagation()}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-xs text-fg-subtle opacity-0 group-hover/step:opacity-100 hover:bg-press hover:text-fg data-[state=open]:opacity-100"
        >
          <MoreHorizontal size={13} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu min-w-[210px]"
          align="end"
          sideOffset={4}
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu.Item
            className="menu-item"
            disabled={index === 0}
            onSelect={() => move(index - 1)}
          >
            Subir
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="menu-item"
            disabled={index === list.length - 1}
            onSelect={() => move(index + 1)}
          >
            Bajar
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="menu-item"
            onSelect={() => {
              const copy = structuredClone(step);
              const steps =
                path.length === 1
                  ? [...flow.steps.slice(0, index + 1), copy, ...flow.steps.slice(index + 1)]
                  : replaceStep(flow.steps, path, step);
              if (path.length === 1) setSteps(flow.id, steps, 'Duplicar paso');
              else {
                const top = flow.steps[path[0]] as Extract<FlowStep, { type: 'paths' }>;
                const inner = [...top.paths[path[1]]!.steps];
                inner.splice(index + 1, 0, structuredClone(step as LeafStep));
                setSteps(
                  flow.id,
                  replaceStep(flow.steps, [path[0]], {
                    ...top,
                    paths: top.paths.map((p, k) => (k === path[1] ? { ...p, steps: inner } : p)),
                  }),
                  'Duplicar paso',
                );
              }
            }}
          >
            <Copy size={14} /> Duplicar
          </DropdownMenu.Item>
          {path.length === 1 && step.type !== 'paths' ? (
            <>
              <DropdownMenu.Separator className="menu-sep" />
              <DropdownMenu.Item className="menu-item" onSelect={() => toPaths('alternate')}>
                <Split size={14} /> Convertir en caminos alternativos
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => toPaths('parallel')}>
                <Split size={14} className="rotate-90" /> Convertir en caminos paralelos
              </DropdownMenu.Item>
            </>
          ) : null}
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item
            className="menu-item"
            data-danger
            onSelect={() => {
              setSteps(flow.id, replaceStep(flow.steps, path, null), 'Eliminar paso');
              useUi.getState().setFlowEdit({ id: flow.id, step: null });
            }}
          >
            <Trash2 size={14} /> Eliminar paso
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
