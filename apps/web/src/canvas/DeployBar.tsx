import { useMemo, useState, type DragEvent } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown, Columns3, CopyPlus, PackageOpen, Plus, Rocket, Square } from 'lucide-react';
import {
  deploymentMatrix,
  deploymentViewsByEnvironment,
  environmentsOf,
  undeployedInView,
  type DeploymentCell,
  type Element,
  type Id,
  type View,
} from '@aegon/core';
import { TechIcon } from '@aegon/icons';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { copyDeploymentTo, createEmptyDeployment, deployAll, deployAt, revealElement } from '../lib/actions.ts';
import { cn } from '../ui/primitives.tsx';
import { DRAG_MIME, canvasApi } from './api.ts';
import { elementIcon } from './nodes/ElementNode.tsx';

const CHIP = 'flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors';
type Panel = 'tray' | 'compare' | 'none';

/**
 * Barra del modo Desplegar: en qué ambiente se está, qué falta desplegar ahí y cómo se compara con
 * los demás. Los ambientes del workspace están siempre a la vista: uno con lienzo se abre con un
 * click; uno sin lienzo se crea copiando este despliegue o vacío. Lo que falta se arrastra a un
 * nodo o se despliega todo junto.
 */
export function DeployBar({ view }: { view: View }) {
  const model = useWorkspace((s) => s.model);
  const selection = useUi((s) => s.selection.nodes);
  const environments = environmentsOf(model);
  const byEnv = useMemo(() => deploymentViewsByEnvironment(model, view.scope), [model, view.scope]);
  const missing = useMemo(() => undeployedInView(model, view), [model, view]);
  const empty = Object.keys(view.nodes).length === 0;
  // En un lienzo vacío la bandeja está abierta (es por donde se empieza) y se cierra sola en
  // cuanto hay algo en el lienzo, para no taparlo; después manda lo que elija el usuario.
  const [chosen, setPanel] = useState<Panel | null>(null);
  const panel: Panel = chosen ?? (empty && missing.length ? 'tray' : 'none');
  const toggle = (p: Panel) => setPanel(panel === p ? 'none' : p);
  const envName = environments.find((e) => e.id === view.environment)?.name ?? view.environment ?? '';
  // Con un nodo seleccionado, "desplegar todo" va adentro de ese nodo.
  const target = selection.length === 1 && view.nodes[selection[0]!] && model.elements[selection[0]!]?.kind === 'node' ? model.elements[selection[0]!] : undefined;
  const shown = environments.some((e) => e.id === view.environment) || !view.environment ? environments : [...environments, { id: view.environment, name: view.environment }];
  const comparable = byEnv.size > 1;

  return (
    <div className="pointer-events-none absolute top-10 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2" data-testid="deploy-bar">
      <div className="animate-pop pointer-events-auto flex items-center gap-0.5 rounded-[10px] border border-line bg-panel p-[3px] shadow-pop" role="group" aria-label="Ambiente">
        {shown.map((env) => {
          const current = env.id === view.environment;
          const existing = byEnv.get(env.id);
          if (current || existing) {
            return (
              <button
                key={env.id}
                type="button"
                aria-pressed={current}
                onClick={() => existing && !current && useUi.getState().openView(existing.id, { transition: 'fade' })}
                className={cn(CHIP, current ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-hover hover:text-fg')}
                title={current ? `Despliegue en ${env.name}` : `Ir al despliegue en ${env.name}`}
                data-testid={`deploy-env-${env.id}`}
              >
                {env.name}
              </button>
            );
          }
          return (
            <DropdownMenu.Root key={env.id}>
              <DropdownMenu.Trigger asChild>
                <button type="button" className={cn(CHIP, 'text-fg-subtle hover:bg-hover hover:text-fg')} title={`Todavía no hay despliegue en ${env.name}`} data-testid={`deploy-env-${env.id}`}>
                  <Plus size={12} />
                  {env.name}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu min-w-[250px]" align="center" sideOffset={8}>
                  <div className="menu-label">Despliegue en {env.name}</div>
                  {!empty ? (
                    <DropdownMenu.Item className="menu-item" onSelect={() => copyDeploymentTo(env.id)} data-testid={`deploy-copy-${env.id}`}>
                      <CopyPlus size={14} /> Copiar el de {envName}
                    </DropdownMenu.Item>
                  ) : null}
                  <DropdownMenu.Item className="menu-item" onSelect={() => createEmptyDeployment(env.id)} data-testid={`deploy-empty-${env.id}`}>
                    <Square size={14} /> Empezar vacío
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          );
        })}
        {missing.length || !empty || comparable ? <div className="mx-1 h-5 w-px bg-line" /> : null}
        {missing.length ? (
          <button
            type="button"
            aria-expanded={panel === 'tray'}
            onClick={() => toggle('tray')}
            className={cn(CHIP, 'text-warn hover:bg-hover', panel === 'tray' && 'bg-[color-mix(in_srgb,var(--warn)_12%,transparent)]')}
            data-testid="deploy-missing"
          >
            <PackageOpen size={13} />
            {missing.length} sin desplegar
            <ChevronDown size={12} className={cn('transition-transform', panel === 'tray' && 'rotate-180')} />
          </button>
        ) : !empty ? (
          <span className={cn(CHIP, 'text-fg-subtle')} data-testid="deploy-complete">
            <Check size={13} className="text-ok" /> Todo desplegado
          </span>
        ) : null}
        {comparable ? (
          <button
            type="button"
            aria-expanded={panel === 'compare'}
            onClick={() => toggle('compare')}
            className={cn(CHIP, panel === 'compare' ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}
            title="Qué corre en cada ambiente y con cuántas réplicas"
            data-testid="deploy-compare"
          >
            <Columns3 size={13} />
            Comparar
          </button>
        ) : null}
      </div>

      {panel === 'tray' && missing.length ? (
        <div className="animate-pop pointer-events-auto flex w-[300px] flex-col gap-2 rounded-lg border border-line bg-panel p-2.5 shadow-pop" data-testid="deploy-tray">
          <p className="m-0 px-0.5 text-[12px] leading-snug text-fg-subtle">Arrastrá cada uno al nodo donde corre, o desplegalos todos y después acomodás.</p>
          <div className="flex max-h-[232px] flex-col gap-0.5 overflow-auto">
            {missing.map((el) => (
              <TrayRow key={el.id} el={el} system={systemName(model.elements, el)} />
            ))}
          </div>
          <button
            type="button"
            onClick={() => deployAll(target?.id)}
            className="flex h-8 items-center justify-center gap-1.5 rounded-sm bg-accent text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
            data-testid="deploy-all"
          >
            <Rocket size={13} />
            {target ? `Desplegar todo en ${target.name}` : 'Desplegar todo'}
          </button>
        </div>
      ) : null}

      {panel === 'compare' && comparable ? <Compare view={view} /> : null}
    </div>
  );
}

function systemName(elements: Readonly<Record<Id, Element>>, el: Element): string | undefined {
  let current = el.parent ? elements[el.parent] : undefined;
  while (current && current.kind !== 'system') current = current.parent ? elements[current.parent] : undefined;
  return current?.name;
}

/** Algo que falta desplegar: se arrastra al lienzo (cae como instancia) o se despliega con un click. */
function TrayRow({ el, system }: { el: Element; system?: string }) {
  const { icon, label } = elementIcon(el);
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, el.id);
    e.dataTransfer.setData('text/plain', el.id);
    e.dataTransfer.effectAllowed = 'link';
  };
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={() => deployAt(el.id, canvasApi.viewportCenter())}
      title="Arrastralo a un nodo, o hacé click para desplegarlo en el centro del lienzo"
      className="flex h-8 cursor-grab items-center gap-2 rounded-sm px-2 text-left text-[12.5px] text-fg-muted transition-colors hover:bg-hover hover:text-fg active:cursor-grabbing"
      data-testid={`deploy-row-${el.id}`}
    >
      <span className="shrink-0" style={{ color: `var(--kind-${el.kind})` }}>
        <TechIcon icon={icon} label={label} size={14} />
      </span>
      <span className="truncate">{el.name}</span>
      {system ? <span className="ml-auto shrink-0 pl-2 text-[11px] text-fg-subtle">{system}</span> : null}
    </button>
  );
}

function CellView({ cell }: { cell: DeploymentCell }) {
  if (cell.state === 'absent') return <span className="text-fg-subtle" title="No existe en este ambiente">·</span>;
  if (cell.state === 'missing') return <span className="font-semibold text-warn" title="Falta desplegarlo">falta</span>;
  return (
    <span className="tabular-nums text-fg" title={cell.nodes.length ? `En ${cell.nodes.join(', ')}` : undefined}>
      ×{cell.replicas}
    </span>
  );
}

/**
 * Comparación entre ambientes: una fila por contenedor, base o bus y una columna por ambiente con
 * despliegue. Se lee de un vistazo qué falta y dónde cambian las réplicas.
 */
function Compare({ view }: { view: View }) {
  const model = useWorkspace((s) => s.model);
  const matrix = useMemo(() => deploymentMatrix(model, view.scope), [model, view.scope]);
  return (
    <div className="animate-pop pointer-events-auto max-h-[340px] overflow-auto rounded-lg border border-line bg-panel p-2 shadow-pop" data-testid="deploy-matrix">
      <table className="border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr>
            <th className="sticky top-0 bg-panel px-2 pb-1.5 text-left text-[11px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">Réplicas</th>
            {matrix.environments.map((env) => (
              <th
                key={env.id}
                className={cn('sticky top-0 bg-panel px-3 pb-1.5 text-right text-[11px] font-semibold tracking-[0.04em] uppercase', env.id === view.environment ? 'text-accent' : 'text-fg-subtle')}
              >
                {env.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map(({ element, cells }) => {
            const { icon, label } = elementIcon(element);
            return (
              <tr key={element.id} className="group">
                <td className="rounded-l-sm px-2 py-1 group-hover:bg-hover">
                  <button type="button" onClick={() => revealElement(element.id)} className="flex items-center gap-2 text-left text-fg-muted hover:text-fg" title="Ver en el modelo">
                    <span className="shrink-0" style={{ color: `var(--kind-${element.kind})` }}>
                      <TechIcon icon={icon} label={label} size={13} />
                    </span>
                    <span className="max-w-[180px] truncate">{element.name}</span>
                  </button>
                </td>
                {matrix.environments.map((env, i) => (
                  <td
                    key={env.id}
                    className={cn('px-3 py-1 text-right group-hover:bg-hover', i === matrix.environments.length - 1 && 'rounded-r-sm')}
                    data-testid={`matrix-${element.id}-${env.id}`}
                  >
                    <CellView cell={cells[env.id]!} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
