import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Check, FilePlus2, FolderPlus, LayoutTemplate, MoreHorizontal, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import {
  blockProblem,
  sizeOf,
  templateMainView,
  templateStats,
  type ElementKind,
  type Template,
  type View,
} from '@aegon/core';
import { useTemplates, allTemplates } from '../store/templates.ts';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { confirmDialog, promptDialog } from '../store/dialogs.ts';
import { Modal } from '../ui/Modal.tsx';
import { Button, Field, Segmented, TextArea, TextInput, Tip, cn } from '../ui/primitives.tsx';

// -----------------------------------------------------------------------------------------------
// Vista previa

/** Miniatura del lienzo principal del template: rectángulos por tipo y líneas por relación. */
export function TemplatePreview({ template, className }: { template: Template; className?: string }) {
  const shape = useMemo(() => {
    const preview = previewView(template);
    return preview ? layoutOf(template, preview.view, preview.scope) : null;
  }, [template]);
  if (!shape) return <div className={cn('grid place-items-center text-[11px] text-fg-subtle', className)}>Sin lienzo</div>;
  const { rects, lines, box } = shape;
  return (
    <svg className={className} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {lines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} style={{ stroke: 'var(--edge)', strokeWidth: box.w / 260 }} />
      ))}
      {rects.map((r) => {
        const frame = r.kind === 'group' || r.frame;
        return (
          <rect
            key={r.id}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx={frame ? 24 : 14}
            style={{
              fill: frame ? 'transparent' : `color-mix(in srgb, var(--kind-${r.kind}) 16%, var(--node-bg))`,
              stroke: `var(--kind-${r.kind})`,
              strokeWidth: box.w / 300,
              strokeDasharray: frame ? `${box.w / 80} ${box.w / 120}` : undefined,
            }}
          />
        );
      })}
    </svg>
  );
}

/** Lienzo de la miniatura: el principal o, si tiene un solo elemento, su lienzo de detalle. */
function previewView(template: Template): { view: View; scope?: string } | null {
  const main = templateMainView(template);
  if (!main) return null;
  const ids = Object.keys(main.nodes);
  if (ids.length === 1) {
    const detail = Object.values(template.model.views).find((v) => v.scope === ids[0] && Object.keys(v.nodes).length);
    if (detail) return { view: detail, scope: ids[0] };
  }
  return { view: main };
}

type PreviewRect = { id: string; kind: ElementKind; x: number; y: number; w: number; h: number; frame?: boolean };

function layoutOf(template: Template, view: View, scope?: string) {
  const rects: PreviewRect[] = Object.entries(view.nodes).flatMap(([id, l]) => {
    const el = template.model.elements[id];
    if (!el) return [];
    const s = sizeOf(el, l);
    return [{ id, kind: el.kind as ElementKind, x: l.x, y: l.y, w: s.w, h: s.h }];
  });
  if (!rects.length) return null;
  // En un lienzo de detalle, el elemento abierto se dibuja como el marco de sus hijos.
  const scoped = scope ? template.model.elements[scope] : undefined;
  const inner = scoped ? rects.filter((r) => template.model.elements[r.id]?.parent === scope) : [];
  if (scoped && inner.length) {
    const m = 28;
    const fx = Math.min(...inner.map((r) => r.x)) - m;
    const fy = Math.min(...inner.map((r) => r.y)) - m;
    rects.unshift({
      id: `frame:${scope}`,
      kind: scoped.kind,
      x: fx,
      y: fy,
      w: Math.max(...inner.map((r) => r.x + r.w)) + m - fx,
      h: Math.max(...inner.map((r) => r.y + r.h)) + m - fy,
      frame: true,
    });
  }
  const byId = new Map(rects.map((r) => [r.id, r]));
  const lines = Object.values(template.model.relations).flatMap((rel) => {
    const a = byId.get(rel.from);
    const b = byId.get(rel.to);
    return a && b ? [{ x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2 }] : [];
  });
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  const pad = Math.max(x2 - x1, y2 - y1) * 0.08;
  return { rects, lines, box: { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 } };
}

function statsText(t: Template) {
  const s = templateStats(t);
  return `${s.elements} ${s.elements === 1 ? 'elemento' : 'elementos'} · ${s.relations} ${s.relations === 1 ? 'relación' : 'relaciones'}`;
}

function KindBadge({ t }: { t: Template }) {
  const level = templateStats(t).level;
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold', t.kind === 'workspace' ? 'bg-accent-soft text-accent' : 'bg-raised text-fg-muted')}>
      {t.kind === 'workspace' ? 'Workspace' : `Bloque · L${level ?? '?'}`}
    </span>
  );
}

// -----------------------------------------------------------------------------------------------
// Galería

export interface TemplatesResult {
  action: 'use' | 'insert';
  template: Template;
}

export function TemplatesDialog({ close, initialFilter = 'all' }: { close: (r: TemplatesResult | null) => void; initialFilter?: 'all' | 'workspace' | 'block' }) {
  const user = useTemplates((s) => s.user);
  const load = useTemplates((s) => s.load);
  const loaded = useTemplates((s) => s.loaded);
  const activeView = useWorkspace((s) => {
    const id = useUi.getState().activeViewId;
    return id ? s.model.views[id] : undefined;
  });
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const q = query.trim().toLowerCase();
  const visible = allTemplates(user).filter(
    (t) => (filter === 'all' || t.kind === filter) && (!q || t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)),
  );
  const userHasTemplates = user.length > 0;
  const builtins = visible.filter((t) => t.builtin);
  const mine = visible.filter((t) => !t.builtin);

  const card = (t: Template) => {
    const problem = t.kind === 'block' ? (activeView ? blockProblem(t, activeView) : 'Abrí un lienzo para insertar') : null;
    return (
      <div key={t.id} className="group flex flex-col overflow-hidden rounded-lg border border-line bg-panel transition-shadow hover:shadow-pop" data-testid={`template-${t.id}`}>
        <div className="relative h-32 border-b border-line bg-canvas">
          <TemplatePreview template={t} className="h-full w-full p-3" />
          {!t.builtin ? (
            <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
              <TemplateMenu template={t} />
            </div>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <div className="flex items-start gap-2">
            <span className="flex-1 text-[13px] leading-snug font-semibold text-fg">{t.name}</span>
            <KindBadge t={t} />
          </div>
          {t.description ? <p className="m-0 line-clamp-2 text-[12px] leading-snug text-fg-muted">{t.description}</p> : null}
          <div className="mt-auto flex items-center gap-2 pt-1.5">
            <span className="text-[11px] text-fg-subtle tabular-nums">{statsText(t)}</span>
            <span className="flex-1" />
            {t.kind === 'workspace' ? (
              <Button size="sm" variant="secondary" onClick={() => close({ action: 'use', template: t })} data-testid={`use-${t.id}`}>
                <FolderPlus size={13} /> Usar
              </Button>
            ) : problem ? (
              <Tip label={problem}>
                <span>
                  <Button size="sm" disabled>
                    <Plus size={13} /> Insertar
                  </Button>
                </span>
              </Tip>
            ) : (
              <Button size="sm" variant="primary" onClick={() => close({ action: 'insert', template: t })} data-testid={`insert-${t.id}`}>
                <Plus size={13} /> Insertar
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Modal
      open
      onClose={() => close(null)}
      size="xl"
      icon={<LayoutTemplate size={17} />}
      title="Templates"
      description="Puntos de partida para workspaces nuevos y bloques que se repiten entre soluciones (API gateways, event-driven, tres capas…)."
      testId="templates-dialog"
    >
      <div className="sticky top-0 z-10 -mx-5 mb-3 flex items-center gap-3 bg-panel px-5 pb-3">
        <div className="w-[300px]">
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v ?? 'all')}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'workspace', label: 'Workspaces' },
              { value: 'block', label: 'Bloques' },
            ]}
          />
        </div>
        <div className="relative flex-1">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" />
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar templates" className="pl-7" />
        </div>
      </div>
      {/* Los del usuario van primero en cuanto existe alguno: son los que más se reutilizan. */}
      <div className={cn('flex', userHasTemplates ? 'flex-col-reverse' : 'flex-col')}>
        <Section title="Incluidos" icon={<Sparkles size={12} />}>
          {builtins.length ? <div className="grid grid-cols-3 gap-3">{builtins.map(card)}</div> : <Empty text="Nada coincide con la búsqueda." />}
        </Section>
        <Section title="Tuyos" icon={<LayoutTemplate size={12} />}>
          {mine.length ? (
            <div className="grid grid-cols-3 gap-3">{mine.map(card)}</div>
          ) : (
            <Empty
              text={
                userHasTemplates
                  ? 'Nada coincide con la búsqueda.'
                  : 'Todavía no creaste templates. Seleccioná elementos en el lienzo y elegí "Guardar como template", o guardá un workspace entero desde el menú de workspaces.'
              }
            />
          )}
        </Section>
      </div>
    </Modal>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="m-0 rounded-lg border border-dashed border-line px-4 py-6 text-center text-[12.5px] leading-relaxed text-fg-subtle">{text}</p>;
}

function TemplateMenu({ template }: { template: Template }) {
  const update = useTemplates((s) => s.update);
  const remove = useTemplates((s) => s.remove);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label="Acciones del template" className="grid h-7 w-7 place-items-center rounded-sm border border-line bg-panel text-fg-muted shadow-sm hover:text-fg">
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu z-[70]" align="end" sideOffset={4}>
          <DropdownMenu.Item
            className="menu-item"
            onSelect={async () => {
              const name = await promptDialog({ title: 'Renombrar template', label: 'Nombre', defaultValue: template.name, confirmLabel: 'Renombrar', icon: <Pencil size={16} /> });
              if (name) await update(template.id, { name, description: template.description });
            }}
          >
            <Pencil size={14} /> Renombrar
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item
            className="menu-item"
            data-danger
            onSelect={async () => {
              const ok = await confirmDialog({
                title: `¿Eliminar "${template.name}"?`,
                description: 'El template se borra de tu biblioteca. Los workspaces y lienzos donde ya lo usaste no cambian.',
                confirmLabel: 'Eliminar template',
                tone: 'danger',
                icon: <Trash2 size={16} />,
              });
              if (ok) await remove(template.id);
            }}
          >
            <Trash2 size={14} /> Eliminar
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// -----------------------------------------------------------------------------------------------
// Elegir punto de partida (workspace nuevo, carpeta nueva)

function StartPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const user = useTemplates((s) => s.user);
  const load = useTemplates((s) => s.load);
  const loaded = useTemplates((s) => s.loaded);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  const options = allTemplates(user).filter((t) => t.kind === 'workspace');
  const tile = (id: string | null, label: string, body: React.ReactNode, sub?: string) => (
    <button
      key={id ?? 'blank'}
      type="button"
      onClick={() => onChange(id)}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors',
        value === id ? 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-line hover:border-line-strong',
      )}
      data-testid={`start-${id ?? 'blank'}`}
    >
      <div className="h-24 border-b border-line bg-canvas">{body}</div>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex-1">
          <span className="block text-[12.5px] font-semibold text-fg">{label}</span>
          {sub ? <span className="block text-[11px] text-fg-subtle">{sub}</span> : null}
        </span>
        {value === id ? <Check size={14} className="text-accent" /> : null}
      </div>
    </button>
  );
  return (
    <div className="grid grid-cols-3 gap-3">
      {tile(null, 'En blanco', <div className="grid h-full place-items-center text-fg-subtle"><FilePlus2 size={22} /></div>, 'Un lienzo de contexto vacío')}
      {options.map((t) => tile(t.id, t.name, <TemplatePreview template={t} className="h-full w-full p-2" />, statsText(t)))}
    </div>
  );
}

export interface NewWorkspaceResult {
  name: string;
  template: Template | null;
}

export function NewWorkspaceDialog({ close, initialTemplate = null }: { close: (r: NewWorkspaceResult | null) => void; initialTemplate?: Template | null }) {
  const user = useTemplates((s) => s.user);
  const [name, setName] = useState(initialTemplate ? `${initialTemplate.name}` : '');
  const [templateId, setTemplateId] = useState<string | null>(initialTemplate?.id ?? null);
  const [touched, setTouched] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim()) return;
    close({ name: name.trim(), template: allTemplates(user).find((t) => t.id === templateId) ?? null });
  };
  return (
    <Modal
      open
      onClose={() => close(null)}
      size="lg"
      icon={<FolderPlus size={17} />}
      title="Nuevo workspace"
      description="Se crea en este navegador. Después lo podés vincular a una carpeta o a un repo de GitHub."
      testId="new-workspace-dialog"
      footer={
        <>
          <span className="flex-1" />
          <Button size="sm" onClick={() => close(null)}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" type="submit" form="new-workspace-form" data-testid="new-workspace-create">
            Crear workspace
          </Button>
        </>
      }
    >
      <form id="new-workspace-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nombre">
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Plataforma de pagos" data-testid="new-workspace-name" />
        </Field>
        {touched && !name.trim() ? <p className="-mt-2 m-0 text-[12px] text-danger">Poné un nombre para el workspace</p> : null}
        <div className="flex flex-col gap-2">
          <span className="text-[11.5px] font-medium text-fg-subtle">Empezar con</span>
          <StartPicker value={templateId} onChange={setTemplateId} />
        </div>
      </form>
    </Modal>
  );
}

/** Carpeta sin workspace: confirma la creación y deja elegir con qué empezar. */
export function InitFolderDialog({ folder, close }: { folder: string; close: (r: { template: Template | null } | null) => void }) {
  const user = useTemplates((s) => s.user);
  const [templateId, setTemplateId] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={() => close(null)}
      size="lg"
      icon={<FolderPlus size={17} />}
      title={`Crear un workspace en "${folder}"`}
      description="La carpeta no tiene un workspace de Aegon. Se agregan solo estos archivos; nada de lo que ya hay se modifica ni se borra."
      testId="init-folder-dialog"
      footer={
        <>
          <span className="flex-1" />
          <Button size="sm" onClick={() => close(null)}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" onClick={() => close({ template: allTemplates(user).find((t) => t.id === templateId) ?? null })} data-testid="init-folder-create">
            Crear workspace
          </Button>
        </>
      }
    >
      <ul className="m-0 mb-4 grid list-none grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-line bg-raised/60 p-3 text-[12px] text-fg-muted">
        <li><code className="text-fg">aegon.yaml</code> · manifiesto del workspace</li>
        <li><code className="text-fg">model/</code> · elementos y relaciones</li>
        <li><code className="text-fg">views/</code> · lienzos</li>
        <li><code className="text-fg">AGENTS.md</code> · guía para agentes de IA</li>
        <li className="col-span-2"><code className="text-fg">.gitignore</code> y <code className="text-fg">.gitattributes</code> · solo si no existen</li>
      </ul>
      <div className="flex flex-col gap-2">
        <span className="text-[11.5px] font-medium text-fg-subtle">Empezar con</span>
        <StartPicker value={templateId} onChange={setTemplateId} />
      </div>
    </Modal>
  );
}

/** Nombre y descripción de un template nuevo, con su vista previa. */
export function SaveTemplateDialog({ template, close }: { template: Template; close: (r: { name: string; description?: string } | null) => void }) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const level = templateStats(template).level;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) close({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) });
  };
  return (
    <Modal
      open
      onClose={() => close(null)}
      size="md"
      icon={<LayoutTemplate size={17} />}
      title={template.kind === 'block' ? 'Guardar bloque como template' : 'Guardar workspace como template'}
      description={
        template.kind === 'block'
          ? `Lo vas a poder insertar en cualquier lienzo de nivel ${level} desde Templates o con doble click en el lienzo.`
          : 'Aparece como punto de partida al crear un workspace nuevo.'
      }
      testId="save-template-dialog"
      footer={
        <>
          <span className="text-[11.5px] text-fg-subtle tabular-nums">{statsText(template)}</span>
          <span className="flex-1" />
          <Button size="sm" onClick={() => close(null)}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" type="submit" form="save-template-form" disabled={!name.trim()} data-testid="save-template-accept">
            Guardar template
          </Button>
        </>
      }
    >
      <form id="save-template-form" onSubmit={submit} className="flex flex-col gap-3">
        <div className="h-36 overflow-hidden rounded-lg border border-line bg-canvas">
          <TemplatePreview template={template} className="h-full w-full p-3" />
        </div>
        <Field label="Nombre">
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} data-testid="save-template-name" />
        </Field>
        <Field label="Descripción" hint="Opcional">
          <TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para qué sirve, qué incluye" />
        </Field>
      </form>
    </Modal>
  );
}
