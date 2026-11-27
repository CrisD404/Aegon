import { Gauge } from 'lucide-react';
import type { LoadNode } from '@aegon/core';
import { TechIcon } from '@aegon/icons';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { revealElement } from '../lib/actions.ts';
import { goToMode } from '../lib/modes.ts';
import { rpsText, usageText, useLoadOverlay } from '../canvas/load.ts';
import { elementIcon } from '../canvas/nodes/ElementNode.tsx';
import { Button, cn } from '../ui/primitives.tsx';

const TONE: Record<LoadNode['state'], string> = { idle: 'bg-fg-subtle', ok: 'bg-ok', busy: 'bg-warn', saturated: 'bg-danger' };

/**
 * Panel Carga: cada parte con lo que le llega contra lo que aguanta, de la más exigida a la menos.
 * El único dato que se puede cargar es la capacidad por réplica, y solo donde se la conoce: lo
 * demás sale del modelo (relaciones, réplicas del despliegue) o es un supuesto marcado como tal.
 */
export function LoadPanel() {
  const model = useWorkspace((s) => s.model);
  const dispatch = useWorkspace((s) => s.dispatch);
  const simulate = useUi((s) => s.simulate);
  const result = useLoadOverlay((s) => s.result);

  if (!simulate || !result) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" data-testid="load-panel">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent">
          <Gauge size={20} />
        </span>
        <p className="m-0 text-[13.5px] font-semibold text-fg">Simular carga</p>
        <p className="m-0 text-[12.5px] leading-relaxed text-fg-subtle">
          Elegí cuánto tráfico entra y mirá qué parte se queda sin margen primero. Usa las relaciones y las réplicas que ya están en el modelo; no hace falta cargar nada para empezar.
        </p>
        <Button variant="primary" size="sm" onClick={() => goToMode('simulate')} data-testid="load-start">
          <Gauge size={13} /> Simular
        </Button>
      </div>
    );
  }

  const rows = Object.values(result.nodes).sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1) || b.load - a.load || a.id.localeCompare(b.id));
  const setCapacity = (id: string, value: string) => {
    const n = Number(value);
    const el = model.elements[id];
    if (!el) return;
    dispatch({ type: 'element.update', id, patch: { load: value.trim() && n > 0 ? { capacity: n } : null } }, { coalesce: `${id}:load`, label: `Capacidad de ${el.name}` });
  };

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="load-panel">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">Carga por parte</span>
        <span className="ml-auto text-[11.5px] text-fg-subtle">pedidos por segundo</span>
      </div>
      {!rows.length ? <p className="m-0 text-[12.5px] leading-relaxed text-fg-subtle">Todavía no hay un camino para el tráfico: conectá un actor con lo que usa.</p> : null}
      {rows.map((node) => {
        const el = model.elements[node.id];
        if (!el) return null;
        const { icon, label } = elementIcon(el);
        const width = node.utilization === null ? 0 : Math.min(100, Math.round(node.utilization * 100));
        return (
          <div key={node.id} className="flex flex-col gap-1.5" data-testid={`load-row-${node.id}`}>
            <div className="flex items-center gap-2 text-[12.5px]">
              <button type="button" onClick={() => revealElement(node.id)} className="flex min-w-0 items-center gap-2 text-left text-fg-muted hover:text-fg" title="Ver en el lienzo">
                <span className="shrink-0" style={{ color: `var(--kind-${el.kind})` }}>
                  <TechIcon icon={icon} label={label} size={13} />
                </span>
                <span className="truncate">{el.name}</span>
              </button>
              <span
                className={cn(
                  'ml-auto shrink-0 tabular-nums',
                  node.utilization === null ? 'text-[11.5px] text-fg-subtle' : 'font-mono text-[12px] font-semibold',
                  node.state === 'saturated' ? 'text-danger' : node.state === 'busy' ? 'text-warn' : node.utilization === null ? '' : 'text-fg',
                )}
              >
                {usageText(node.utilization)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-raised">
              <div className={cn('h-full rounded-full transition-[width] duration-200', TONE[node.state])} style={{ width: `${width}%` }} />
            </div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
              <span className="min-w-0 truncate tabular-nums">
                {rpsText(node.load)}
                {node.capacity !== null ? ` de ${rpsText(node.capacity)}` : ''}
                {node.backlog > 0 ? <span className="text-warn"> · se acumulan {rpsText(node.backlog)}</span> : null}
                {node.affectedBy.length && node.state !== 'saturated' ? <span className="text-warn"> · lo frena {model.elements[node.affectedBy[0]!]?.name ?? node.affectedBy[0]}</span> : null}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {node.replicas > 1 ? <span className="tabular-nums">{node.replicas} ×</span> : null}
                <input
                  type="number"
                  min={1}
                  defaultValue={node.assumed || node.perReplica === null ? '' : node.perReplica}
                  key={`${node.id}:${node.assumed ? 'a' : node.perReplica}`}
                  placeholder={node.perReplica === null ? '—' : String(node.perReplica)}
                  onBlur={(e) => setCapacity(node.id, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="h-6 w-[72px] rounded-xs border border-transparent bg-raised px-1.5 text-right font-mono text-[11.5px] text-fg tabular-nums outline-none placeholder:text-fg-subtle focus:border-accent"
                  title={node.assumed ? 'Capacidad por réplica: es un supuesto por tipo. Escribí la real si la conocés.' : 'Capacidad por réplica, en pedidos por segundo'}
                  aria-label={`Capacidad por réplica de ${el.name}`}
                  data-testid={`load-capacity-${node.id}`}
                />
              </span>
            </div>
          </div>
        );
      })}
      {result.notes.length ? (
        <div className="flex flex-col gap-1 border-t border-line pt-3 text-[11.5px] leading-snug text-fg-subtle">
          <span className="font-semibold tracking-[0.04em] uppercase">Supuestos</span>
          <span>Es un modelo: cada pedido recorre todas las relaciones de lo que toca. Ajustá las llamadas por pedido en la relación si no es así.</span>
          {result.notes.map((note) => (
            <span key={note}>{note}.</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
