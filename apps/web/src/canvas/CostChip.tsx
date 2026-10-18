import { useEffect, useMemo } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown, CircleDollarSign, X } from 'lucide-react';
import { costRollup, currencyOf, environmentsOf, type Model, type View } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { money } from '../lib/money.ts';
import { useCostOverlay } from './costs.ts';

/** Total del lienzo: los nodos ubicados cuyo ancestro no está también en el lienzo (sin contar dos veces). */
export function viewCostTotal(
  model: Model,
  view: View,
  totals: ReturnType<typeof costRollup>,
): number {
  let sum = 0;
  for (const id of Object.keys(view.nodes)) {
    const el = model.elements[id];
    if (!el) continue;
    // Los grupos aportan solo su costo propio (red, cuenta compartida); sus miembros ya se suman.
    if (el.kind === 'group') {
      sum += totals.get(id)?.own ?? 0;
      continue;
    }
    let parent = el.parent;
    let covered = false;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      if (view.nodes[parent]) {
        covered = true;
        break;
      }
      seen.add(parent);
      parent = model.elements[parent]?.parent;
    }
    if (!covered) sum += totals.get(id)?.total ?? 0;
  }
  return sum;
}

/**
 * Capa de costos del lienzo: publica los totales por nodo (badges con calor) y muestra arriba a la
 * izquierda el ambiente elegido y el total del lienzo.
 */
export function CostChip({ view }: { view: View }) {
  const model = useWorkspace((s) => s.model);
  const overlay = useUi((s) => s.costOverlay);
  const env = useUi((s) => s.costEnv);
  const setPref = useUi((s) => s.setPref);
  const environments = environmentsOf(model);
  const activeEnv = env && environments.some((e) => e.id === env) ? env : null;
  const totals = useMemo(
    () => (overlay ? costRollup(model, activeEnv) : null),
    [overlay, model, activeEnv],
  );
  const currency = currencyOf(model);

  useEffect(() => {
    if (!totals) {
      useCostOverlay.setState({ totals: null, max: 0 });
      return;
    }
    let max = 0;
    for (const id of Object.keys(view.nodes))
      if (model.elements[id]?.kind !== 'group') max = Math.max(max, totals.get(id)?.total ?? 0);
    useCostOverlay.setState({ totals, currency, max });
  }, [totals, view, model, currency]);
  useEffect(() => () => useCostOverlay.setState({ totals: null, max: 0 }), []);

  if (!overlay || !totals) return null;
  const total = viewCostTotal(model, view, totals);
  const envName = activeEnv
    ? environments.find((e) => e.id === activeEnv)?.name
    : 'Todos los ambientes';

  return (
    <div
      className="animate-pop absolute top-10 left-10 z-30 flex h-9 items-center gap-1 rounded-lg border border-line bg-panel pr-1 pl-2.5 shadow-pop"
      data-testid="cost-chip"
    >
      <CircleDollarSign size={14} className="text-accent" />
      <span
        className="font-mono text-[12.5px] font-semibold text-fg tabular-nums"
        data-testid="cost-chip-total"
      >
        {money(total, currency)}
      </span>
      <span className="text-[11.5px] text-fg-subtle">/ mes</span>
      {environments.length ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="ml-1 flex h-7 items-center gap-1 rounded-sm px-2 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
              data-testid="cost-chip-env"
            >
              {envName}
              <ChevronDown size={12} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu min-w-[180px]" align="start" sideOffset={6}>
              {[{ id: null as string | null, name: 'Todos los ambientes' }, ...environments].map(
                (e) => (
                  <DropdownMenu.Item
                    key={e.id ?? 'all'}
                    className="menu-item"
                    onSelect={() => setPref('costEnv', e.id)}
                  >
                    {e.name}
                    {activeEnv === e.id ? (
                      <Check size={14} className="ml-auto text-accent" />
                    ) : null}
                  </DropdownMenu.Item>
                ),
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : (
        <span className="ml-1 text-[11.5px] text-fg-subtle">sin ambientes</span>
      )}
      <button
        type="button"
        aria-label="Ocultar costos"
        className="grid h-7 w-7 place-items-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg"
        onClick={() => setPref('costOverlay', false)}
      >
        <X size={13} />
      </button>
    </div>
  );
}
