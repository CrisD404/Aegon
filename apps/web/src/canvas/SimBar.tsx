import { useEffect, useMemo } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown, Gauge, TriangleAlert } from 'lucide-react';
import { descendantsOf, environmentsOf, simulateLoad, type Id, type LoadResult, type Model, type View } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { revealElement } from '../lib/actions.ts';
import { cn } from '../ui/primitives.tsx';
import { defaultLoadEnvironment, loadScope, rpsText, rpsToSlider, sliderToRps, useLoadOverlay } from './load.ts';

const escape = (id: string) => `[data-id="${CSS.escape(id)}"]`;

/** Qué decir del resultado, en una línea: cuánto aguanta y qué cede primero. */
function verdict(model: Model, result: LoadResult, rps: number): { tone: 'ok' | 'warn' | 'danger' | 'muted'; text: string; target?: Id } {
  const name = (id: Id) => model.elements[id]?.name ?? id;
  if (!result.entries.length) return { tone: 'muted', text: 'No hay tráfico que seguir: conectá un actor con lo que usa' };
  const failing = result.saturated.filter((id) => !(result.nodes[id]!.backlog > 0 && result.nodes[id]!.backlog >= result.nodes[id]!.load - result.nodes[id]!.served - 1e-9));
  if (failing.length) {
    const more = failing.length > 1 ? ` y ${failing.length - 1} más` : '';
    return { tone: 'danger', text: `Satura ${name(failing[0]!)}${more}`, target: failing[0] };
  }
  if (result.saturated.length) {
    const first = result.saturated[0]!;
    const fail = result.failureLimit ? ` · falla desde ${rpsText(result.failureLimit.rps)}` : '';
    return { tone: 'warn', text: `Se atrasa ${name(first)}${fail}`, target: first };
  }
  if (!result.limit) return { tone: 'ok', text: 'Nada de lo que recorre tiene un límite conocido' };
  const room = result.limit.rps - rps;
  const what = result.limit.backlog ? 'se atrasa' : 'satura';
  return { tone: room < result.limit.rps * 0.3 ? 'warn' : 'ok', text: `Aguanta hasta ${rpsText(result.limit.rps)} · primero ${what} ${name(result.limit.bottleneck)}`, target: result.limit.bottleneck };
}

/**
 * Barra del modo Simular: cuánto tráfico entra y en qué ambiente, y el veredicto. Calcula la
 * simulación para el lienzo y la deja a mano de los nodos, que muestran su uso; lo saturado y lo
 * que arrastra se marcan sobre el lienzo.
 */
export function SimBar({ view }: { view: View }) {
  const model = useWorkspace((s) => s.model);
  const rps = useUi((s) => s.simRps);
  const pref = useUi((s) => s.simEnv);
  const setPref = useUi((s) => s.setPref);
  const environments = environmentsOf(model);
  // En un lienzo de despliegue se simula su ambiente; en los demás, el elegido (por defecto, producción).
  const fixed = view.level === 'deployment' ? view.environment : undefined;
  const env = fixed ?? (pref && environments.some((e) => e.id === pref) ? pref : defaultLoadEnvironment(model));
  const scope = loadScope(model, view);

  const result = useMemo(() => simulateLoad(model, { rps, environment: env, scope }), [model, rps, env, scope]);
  // Qué carga muestra cada nodo del lienzo que no se simula por sí mismo: una instancia, la de lo
  // que despliega; un sistema cerrado, la de su parte más exigida.
  const alias = useMemo(() => {
    const out: Record<Id, Id> = {};
    for (const id of Object.keys(view.nodes)) {
      const el = model.elements[id];
      if (!el) continue;
      if (el.kind === 'instance') out[id] = el.instance.of;
      else if (!result.nodes[id]) {
        const worst = descendantsOf(model, id)
          .map((d) => result.nodes[d])
          .filter((n): n is NonNullable<typeof n> => !!n)
          .sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1) || b.load - a.load)[0];
        if (worst) out[id] = worst.id;
      }
    }
    return out;
  }, [model, view.nodes, result]);
  useEffect(() => {
    useLoadOverlay.setState({ result, alias });
  }, [result, alias]);
  useEffect(() => () => useLoadOverlay.setState({ result: null, alias: {} }), []);

  // Marcas sobre el lienzo sin re-renderizar nodos: lo saturado en rojo, lo que arrastra en ámbar.
  const css = useMemo(() => {
    const shown = (unit: Id) => Object.keys(view.nodes).filter((id) => (alias[id] ?? id) === unit);
    const hot = result.saturated.flatMap(shown);
    const dragged = Object.values(result.nodes)
      .filter((n) => n.affectedBy.length && n.state !== 'saturated')
      .flatMap((n) => shown(n.id));
    const rules: string[] = [];
    if (hot.length) rules.push(`.canvas-shell :is(${hot.map(escape).join(',')}) :is(.c4-node, .c4-open) { border-color: var(--danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent); }`);
    if (dragged.length) rules.push(`.canvas-shell :is(${dragged.map(escape).join(',')}) :is(.c4-node, .c4-open) { border-color: var(--warn); border-style: dashed; }`);
    return rules.join('\n');
  }, [result, view.nodes, alias]);

  const v = verdict(model, result, rps);
  const envName = environments.find((e) => e.id === env)?.name;
  return (
    <div className="animate-pop absolute top-10 left-10 z-20 flex flex-col rounded-[10px] border border-line bg-panel shadow-pop" data-testid="sim-bar">
      {css ? <style data-testid="sim-highlight">{css}</style> : null}
      <div className="flex h-[34px] items-center gap-2 pr-1 pl-2.5">
        <Gauge size={14} className="shrink-0 text-accent" />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={rpsToSlider(rps)}
          onChange={(e) => setPref('simRps', sliderToRps(Number(e.target.value)))}
          className="sim-range w-[130px]"
          aria-label="Tráfico que entra, en pedidos por segundo"
          data-testid="sim-range"
        />
        <label className="flex shrink-0 items-baseline gap-1 text-[11.5px] text-fg-subtle">
          <input
            type="number"
            min={0}
            value={rps}
            onChange={(e) => setPref('simRps', Math.max(0, Math.round(Number(e.target.value) || 0)))}
            className="h-6 w-[68px] rounded-xs border border-transparent bg-raised px-1.5 text-right font-mono text-[12.5px] font-semibold text-fg tabular-nums outline-none focus:border-accent"
            aria-label="Pedidos por segundo"
            data-testid="sim-rps"
          />
          por segundo
        </label>
        {environments.length && !fixed ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-[12px] whitespace-nowrap text-fg-muted hover:bg-hover hover:text-fg" title="De qué ambiente salen las réplicas" data-testid="sim-env">
                {envName ?? 'Ambiente'}
                <ChevronDown size={12} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu min-w-[180px]" align="center" sideOffset={8}>
                <div className="menu-label">Réplicas de</div>
                {environments.map((e) => (
                  <DropdownMenu.Item key={e.id} className="menu-item" onSelect={() => setPref('simEnv', e.id)}>
                    {e.name}
                    {e.id === env ? <Check size={14} className="ml-auto text-accent" /> : null}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : envName ? (
          <span className="shrink-0 px-1 text-[12px] whitespace-nowrap text-fg-subtle">{envName}</span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => {
          if (v.target) revealElement(v.target);
          useUi.getState().setRightTab('load');
        }}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-b-[10px] border-t border-line px-2.5 text-left text-[12px] font-medium whitespace-nowrap transition-colors hover:bg-hover',
          v.tone === 'danger' ? 'text-danger' : v.tone === 'warn' ? 'text-warn' : v.tone === 'ok' ? 'text-fg' : 'text-fg-subtle',
        )}
        title="Ver el detalle de la carga"
        data-testid="sim-verdict"
      >
        {v.tone === 'danger' || v.tone === 'warn' ? <TriangleAlert size={13} className="shrink-0" /> : v.tone === 'ok' ? <Check size={13} className="shrink-0 text-ok" /> : null}
        {v.text}
      </button>
    </div>
  );
}
