import { useMemo, useState } from 'react';
import {
  CircleAlert,
  CircleDollarSign,
  Download,
  Eye,
  EyeOff,
  Settings2,
  Wallet,
} from 'lucide-react';
import { costSummary, findProvider, type CostLine, type CostSummary } from '@aegon/core';
import { Glyph, TechIcon } from '@aegon/icons';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { revealElement } from '../lib/actions.ts';
import { exportCostsCsv, openFinOpsSettings } from '../lib/flows.tsx';
import { money, moneyCompact } from '../lib/money.ts';
import { Button, IconButton, Segmented, Select, cn } from '../ui/primitives.tsx';

/**
 * Panel de costos (FinOps): total mensual por ambiente contra presupuesto y reparto por sistema,
 * grupo (cloud, datacenter) y etiqueta. El ambiente elegido acá es el mismo de la capa de costos
 * del lienzo.
 */
export function CostsPanel() {
  const model = useWorkspace((s) => s.model);
  const env = useUi((s) => s.costEnv);
  const overlay = useUi((s) => s.costOverlay);
  const setPref = useUi((s) => s.setPref);
  const environments = model.workspace.environments ?? [];
  const activeEnv = env && environments.some((e) => e.id === env) ? env : null;
  const summary = useMemo(() => costSummary(model, activeEnv), [model, activeEnv]);

  if (!environments.length) {
    return (
      <div
        className="flex flex-col items-center gap-3 px-6 py-10 text-center"
        data-testid="costs-panel"
      >
        <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent">
          <Wallet size={20} />
        </span>
        <p className="m-0 text-[13.5px] font-semibold text-fg">Costos por ambiente</p>
        <p className="m-0 text-[12.5px] leading-relaxed text-fg-subtle">
          Definí los ambientes (desarrollo, QA, producción…) y cargá en cada elemento cuánto cuesta
          por mes. Acá vas a ver el total contra el presupuesto y en qué se va.
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void openFinOpsSettings()}
          data-testid="costs-setup"
        >
          <Settings2 size={13} /> Configurar ambientes
        </Button>
      </div>
    );
  }

  const envTotal = activeEnv ? summary.byEnvironment.find((e) => e.id === activeEnv) : undefined;
  const currency = summary.currency;
  return (
    <div className="flex flex-col gap-4 p-4" data-testid="costs-panel">
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">
          Costo mensual · {currency}
        </span>
        <span className="flex-1" />
        <IconButton
          size="sm"
          label={overlay ? 'Ocultar costos en el lienzo' : 'Ver costos en el lienzo'}
          active={overlay}
          onClick={() => setPref('costOverlay', !overlay)}
          data-testid="costs-overlay-toggle"
        >
          {overlay ? <Eye size={13} /> : <EyeOff size={13} />}
        </IconButton>
        <IconButton
          size="sm"
          label="Exportar CSV"
          onClick={exportCostsCsv}
          data-testid="costs-export"
        >
          <Download size={13} />
        </IconButton>
        <IconButton size="sm" label="Ambientes y moneda" onClick={() => void openFinOpsSettings()}>
          <Settings2 size={13} />
        </IconButton>
      </div>

      <Segmented
        value={activeEnv ?? 'all'}
        onChange={(v) => setPref('costEnv', !v || v === 'all' ? null : v)}
        options={[
          { value: 'all', label: 'Todos' },
          ...environments.map((e) => ({ value: e.id, label: shortName(e), title: e.name })),
        ]}
      />

      <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-raised/50 px-3.5 py-3">
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-[24px] font-semibold tracking-[-0.02em] text-fg tabular-nums"
            data-testid="costs-total"
          >
            {money(summary.total, currency)}
          </span>
          <span className="text-[12px] text-fg-subtle">
            / mes
            {activeEnv
              ? ` en ${environments.find((e) => e.id === activeEnv)?.name}`
              : ' en todos los ambientes'}
          </span>
        </div>
        {envTotal?.budget !== undefined ? (
          <BudgetBar total={envTotal.total} budget={envTotal.budget} currency={currency} />
        ) : null}
      </div>

      {!activeEnv ? (
        <Section title="Por ambiente">
          {summary.byEnvironment.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setPref('costEnv', e.id)}
              className="group flex flex-col gap-1 rounded-sm px-1 py-1 text-left hover:bg-hover"
              data-testid={`costs-env-${e.id}`}
            >
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="text-fg">{e.name}</span>
                <span className="font-mono text-fg-muted tabular-nums">
                  {money(e.total, currency)}
                  {e.budget !== undefined ? (
                    <span className="text-fg-subtle"> / {moneyCompact(e.budget, currency)}</span>
                  ) : null}
                </span>
              </div>
              <Bar
                value={e.total}
                max={Math.max(
                  ...summary.byEnvironment.map((x) => Math.max(x.total, x.budget ?? 0)),
                  1,
                )}
                budget={e.budget}
              />
            </button>
          ))}
        </Section>
      ) : null}

      <Lines title="Por sistema" lines={summary.bySystem} summary={summary} />
      <Lines title="Por grupo" lines={summary.byGroup} summary={summary} />
      <TagBreakdown summary={summary} />
      <Lines title="Elementos más costosos" lines={summary.top} summary={summary} compact />
      <Missing ids={summary.missing} />
    </div>
  );
}

/** Etiqueta corta para el selector: el nombre si entra, si no el ID (`PROD`, `QA`…). */
function shortName(env: { id: string; name: string }) {
  return env.name.length <= 7 ? env.name : env.id.toUpperCase().slice(0, 6);
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="m-0 flex items-center gap-2 text-[11px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">
        <span className="flex-1">{title}</span>
        {action}
      </h3>
      {children}
    </section>
  );
}

function Bar({ value, max, budget }: { value: number; max: number; budget?: number }) {
  const over = budget !== undefined && value > budget;
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-raised">
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300',
          over ? 'bg-danger' : 'bg-accent',
        )}
        style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
      />
      {budget !== undefined ? (
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-fg-muted"
          style={{ left: `calc(${Math.min(100, (budget / max) * 100)}% - 1px)` }}
          title="Presupuesto"
        />
      ) : null}
    </div>
  );
}

function BudgetBar({
  total,
  budget,
  currency,
}: {
  total: number;
  budget: number;
  currency: string;
}) {
  const ratio = budget ? total / budget : 0;
  const tone = ratio > 1 ? 'text-danger' : ratio > 0.85 ? 'text-warn' : 'text-ok';
  return (
    <div className="flex flex-col gap-1" data-testid="costs-budget">
      <div className="h-2 overflow-hidden rounded-full bg-raised">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300',
            ratio > 1 ? 'bg-danger' : ratio > 0.85 ? 'bg-warn' : 'bg-ok',
          )}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-[11.5px]">
        <span className={tone}>{Math.round(ratio * 100)}% del presupuesto</span>
        <span className="font-mono text-fg-subtle tabular-nums">
          {ratio > 1
            ? `+${money(total - budget, currency)}`
            : `${money(budget - total, currency)} libres`}
        </span>
      </div>
    </div>
  );
}

function Lines({
  title,
  lines,
  summary,
  compact,
}: {
  title: string;
  lines: CostLine[];
  summary: CostSummary;
  compact?: boolean;
}) {
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const max = Math.max(...lines.map((l) => l.total), 1);
  const shown = all ? lines : lines.slice(0, compact ? 5 : 6);
  return (
    <Section
      title={title}
      action={
        lines.length > shown.length || all ? (
          <button
            type="button"
            className="text-[11px] font-medium tracking-normal text-accent normal-case"
            onClick={() => setAll(!all)}
          >
            {all ? 'Ver menos' : `Ver ${lines.length}`}
          </button>
        ) : null
      }
    >
      {shown.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => revealElement(l.id)}
          className="flex flex-col gap-1 rounded-sm px-1 py-1 text-left hover:bg-hover"
          data-testid={`costs-line-${l.id}`}
        >
          <div className="flex items-center gap-2 text-[12.5px]">
            {l.kind === 'group' ? (
              <TechIcon
                icon={findProvider(l.provider ?? 'other')?.icon ?? 'glyph:group'}
                size={13}
              />
            ) : (
              <Glyph name={l.kind} size={13} style={{ color: `var(--kind-${l.kind})` }} />
            )}
            <span className="min-w-0 flex-1 truncate text-fg">{l.name}</span>
            <span className="font-mono text-fg-muted tabular-nums">
              {money(l.total, summary.currency)}
            </span>
          </div>
          {!compact ? <Bar value={l.total} max={max} /> : null}
        </button>
      ))}
    </Section>
  );
}

function TagBreakdown({ summary }: { summary: CostSummary }) {
  const keys = Object.keys(summary.byTag);
  const [key, setKey] = useState<string | undefined>(keys[0]);
  const current = key && summary.byTag[key] ? key : keys[0];
  if (!current) return null;
  const rows = summary.byTag[current]!;
  if (!rows.some((r) => r.value !== '—')) return null;
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <Section title="Por etiqueta">
      <Select
        value={current}
        onChange={(v) => setKey(v)}
        options={keys.map((k) => ({ value: k, label: k }))}
      />
      {rows.map((r) => (
        <div key={r.value} className="flex flex-col gap-1 px-1 py-1">
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className={cn('truncate', r.value === '—' ? 'text-fg-subtle italic' : 'text-fg')}>
              {r.value === '—' ? 'Sin etiqueta' : r.value}
            </span>
            <span className="font-mono text-fg-muted tabular-nums">
              {money(r.total, summary.currency)}
            </span>
          </div>
          <Bar value={r.total} max={max} />
        </div>
      ))}
    </Section>
  );
}

function Missing({ ids }: { ids: string[] }) {
  const model = useWorkspace((s) => s.model);
  const [open, setOpen] = useState(false);
  if (!ids.length) return null;
  return (
    <div className="rounded-md border border-warn/30 bg-[color-mix(in_srgb,var(--warn)_7%,transparent)] px-3 py-2 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left text-fg-muted"
        data-testid="costs-missing"
      >
        <CircleAlert size={13} className="text-warn" />
        <span className="flex-1">
          {ids.length}{' '}
          {ids.length === 1 ? 'elemento sin costo cargado' : 'elementos sin costo cargado'}
        </span>
        <span className="text-[11px] text-accent">{open ? 'Ocultar' : 'Ver'}</span>
      </button>
      {open ? (
        <div className="mt-1.5 flex flex-col">
          {ids.map((id) => {
            const el = model.elements[id];
            if (!el) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => revealElement(id)}
                className="flex items-center gap-2 rounded-xs px-1 py-0.5 text-left hover:bg-hover"
              >
                <Glyph name={el.kind} size={12} style={{ color: `var(--kind-${el.kind})` }} />
                <span className="truncate text-fg">{el.name}</span>
                <CircleDollarSign size={11} className="ml-auto text-fg-subtle" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
