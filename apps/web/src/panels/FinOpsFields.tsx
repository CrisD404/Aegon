import { Fragment, useEffect, useMemo, useState } from 'react';
import { Plus, Settings2, X } from 'lucide-react';
import {
  COSTED_KINDS,
  SUGGESTED_TAG_KEYS,
  costRollup,
  currencyOf,
  deployedIn,
  environmentsOf,
  tagOf,
  type CostEntry,
  type Element,
  type ElementPatch,
  type FinOps,
} from '@aegon/core';
import { useWorkspace } from '../store/workspace.ts';
import { money, parseAmount } from '../lib/money.ts';
import { openFinOpsSettings } from '../lib/flows.tsx';
import { Button, IconButton, SectionTitle, TextInput, cn } from '../ui/primitives.tsx';

/** Campo numérico con texto libre mientras se escribe (acepta `1.450,50`); confirma valores válidos. */
export function AmountInput({
  value,
  onChange,
  placeholder,
  prefix,
  className,
  integer,
  disabled,
  testId,
}: {
  value: number | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  prefix?: string;
  className?: string;
  integer?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value).replace('.', ','));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === undefined ? '' : String(value).replace('.', ','));
  }, [value, focused]);
  return (
    <div className={cn('relative', className)}>
      {prefix ? (
        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-fg-subtle">
          {prefix}
        </span>
      ) : null}
      <TextInput
        inputMode={integer ? 'numeric' : 'decimal'}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseAmount(e.target.value);
          if (!e.target.value.trim()) onChange(null);
          else if (n !== null) onChange(integer ? Math.max(1, Math.round(n)) : n);
        }}
        className={cn('h-7 text-right font-mono text-[12px] tabular-nums', prefix && 'pl-6')}
        data-testid={testId}
      />
    </div>
  );
}

function cleanFinOps(finops: FinOps): FinOps | null {
  const out: FinOps = {};
  if (finops.costs && Object.keys(finops.costs).length) out.costs = finops.costs;
  if (finops.tags && Object.keys(finops.tags).length) out.tags = finops.tags;
  return Object.keys(out).length ? out : null;
}

/**
 * Sección "Costos y ambientes" del inspector: en qué ambientes está desplegado el elemento, su
 * costo mensual por ambiente (con réplicas y SKU) y sus etiquetas FinOps.
 */
export function FinOpsFields({
  el,
  update,
}: {
  el: Element;
  update: (patch: ElementPatch, field: string) => void;
}) {
  const model = useWorkspace((s) => s.model);
  const environments = environmentsOf(model);
  const currency = currencyOf(model);
  const rollup = useMemo(() => costRollup(model, null).get(el.id), [model, el.id]);
  if (!COSTED_KINDS.includes(el.kind)) return null;

  if (!environments.length) {
    return (
      <div className="flex flex-col gap-2" data-testid="finops-fields">
        <SectionTitle>Costos y ambientes</SectionTitle>
        <div className="rounded-md border border-dashed border-line px-3 py-3 text-[12px] leading-relaxed text-fg-subtle">
          Definí los ambientes del workspace (desarrollo, QA, producción…) para cargar dónde corre
          cada elemento y cuánto cuesta.
          <Button size="sm" className="mt-2" onClick={() => void openFinOpsSettings()}>
            <Settings2 size={13} /> Configurar ambientes
          </Button>
        </div>
      </div>
    );
  }

  const costs = el.finops?.costs ?? {};
  const setFinOps = (finops: FinOps, field: string) =>
    update({ finops: cleanFinOps(finops) }, field);
  const setCost = (env: string, patch: Partial<CostEntry> | null) => {
    const next = { ...costs };
    if (patch === null) delete next[env];
    else {
      const merged: CostEntry = { ...(next[env] ?? { monthly: 0 }), ...patch };
      for (const k of Object.keys(merged) as (keyof CostEntry)[])
        if (merged[k] === undefined) delete merged[k];
      next[env] = merged;
    }
    setFinOps({ ...el.finops, costs: next }, `finops.costs.${env}`);
  };
  const toggleEnv = (env: string) => {
    const current = el.environments ?? environments.map((e) => e.id);
    const next = current.includes(env)
      ? current.filter((e) => e !== env)
      : environments.map((e) => e.id).filter((e) => e === env || current.includes(e));
    update({ environments: next.length === environments.length ? null : next }, 'environments');
  };
  const own = environments.reduce(
    (sum, e) => sum + (deployedIn(el, e.id) ? (costs[e.id]?.monthly ?? 0) : 0),
    0,
  );
  const inherited = (rollup?.total ?? 0) - own;

  const tags = el.finops?.tags ?? {};
  const tagKeys = [...new Set([...(model.workspace.finops?.tagKeys ?? []), ...SUGGESTED_TAG_KEYS])];
  const nextKey = tagKeys.find((k) => !(k in tags)) ?? `tag-${Object.keys(tags).length + 1}`;
  const setTags = (next: Record<string, string>) =>
    setFinOps({ ...el.finops, tags: next }, 'finops.tags');
  const parent = el.parent ? model.elements[el.parent] : undefined;

  return (
    <div className="flex flex-col gap-2" data-testid="finops-fields">
      <SectionTitle
        action={
          <IconButton
            size="sm"
            label="Ambientes y moneda"
            onClick={() => void openFinOpsSettings()}
          >
            <Settings2 size={13} />
          </IconButton>
        }
      >
        Costos y ambientes
      </SectionTitle>
      <div className="grid grid-cols-[minmax(0,1fr)_84px_44px_minmax(0,1fr)] items-center gap-x-1.5 gap-y-1 text-[11px]">
        <span className="text-fg-subtle">Desplegado en</span>
        <span className="text-right text-fg-subtle">Mensual</span>
        <span className="text-right text-fg-subtle" title="Réplicas o instancias">
          Rép.
        </span>
        <span className="text-fg-subtle">SKU / tamaño</span>
        {environments.map((env) => {
          const on = deployedIn(el, env.id);
          const cost = costs[env.id];
          return (
            <Fragment key={env.id}>
              <button
                type="button"
                onClick={() => toggleEnv(env.id)}
                aria-pressed={on}
                title={
                  on
                    ? `Desplegado en ${env.name}: click para quitarlo`
                    : `No está en ${env.name}: click para agregarlo`
                }
                className={cn(
                  'flex h-7 min-w-0 items-center gap-1.5 rounded-sm border px-2 text-left text-[12px] transition-colors',
                  on
                    ? 'border-line bg-raised text-fg'
                    : 'border-dashed border-line text-fg-subtle line-through',
                )}
                data-testid={`env-toggle-${env.id}`}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    on ? 'bg-ok' : 'bg-line-strong',
                  )}
                />
                <span className="truncate">{env.name.length <= 9 ? env.name : env.id}</span>
              </button>
              <AmountInput
                value={cost?.monthly}
                disabled={!on}
                prefix={currencySymbol(currency)}
                onChange={(v) =>
                  v === null
                    ? cost?.sku || cost?.replicas
                      ? setCost(env.id, { monthly: 0 })
                      : setCost(env.id, null)
                    : setCost(env.id, { monthly: v })
                }
                testId={`cost-${env.id}`}
              />
              <AmountInput
                value={cost?.replicas}
                disabled={!on || !cost}
                integer
                onChange={(v) => setCost(env.id, { replicas: v ?? undefined })}
              />
              <TextInput
                value={cost?.sku ?? ''}
                disabled={!on || !cost}
                onChange={(e) => setCost(env.id, { sku: e.target.value || undefined })}
                placeholder={cost ? 'SKU' : ''}
                className="h-7 min-w-0 font-mono text-[11px]"
              />
            </Fragment>
          );
        })}
      </div>
      <div className="flex items-baseline justify-between rounded-md bg-raised/70 px-2.5 py-1.5 text-[12px]">
        <span className="text-fg-subtle">Total mensual{inherited > 0 ? ' propio' : ''}</span>
        <span className="font-mono font-semibold text-fg tabular-nums" data-testid="finops-total">
          {money(own, currency)}
        </span>
      </div>
      {inherited > 0 ? (
        <div className="flex items-baseline justify-between px-2.5 text-[11.5px] text-fg-subtle">
          <span>Con lo que contiene</span>
          <span className="font-mono tabular-nums">{money(rollup?.total ?? 0, currency)}</span>
        </div>
      ) : null}

      <SectionTitle
        action={
          <IconButton
            size="sm"
            label="Agregar etiqueta FinOps"
            onClick={() => setTags({ ...tags, [nextKey]: '' })}
          >
            <Plus size={13} />
          </IconButton>
        }
      >
        Etiquetas FinOps
      </SectionTitle>
      {Object.entries(tags).map(([k, v], i, all) => (
        <div key={i} className="flex items-center gap-1">
          <TextInput
            defaultValue={k}
            list="finops-tag-keys"
            onBlur={(e) => {
              const key = e.target.value.trim();
              if (key && key !== k)
                setTags(
                  Object.fromEntries(all.map(([kk, vv]) => (kk === k ? [key, vv] : [kk, vv]))),
                );
            }}
            className="h-7 w-[42%] font-mono text-[11.5px]"
          />
          <TextInput
            value={v}
            onChange={(e) => setTags({ ...tags, [k]: e.target.value })}
            placeholder={parent ? (tagOf(model, parent, k) ?? '') : ''}
            className="h-7 flex-1 text-[12px]"
          />
          <IconButton
            size="sm"
            label="Quitar etiqueta"
            onClick={() => setTags(Object.fromEntries(all.filter(([kk]) => kk !== k)))}
          >
            <X size={12} />
          </IconButton>
        </div>
      ))}
      {!Object.keys(tags).length ? (
        <p className="m-0 text-[11.5px] leading-relaxed text-fg-subtle">
          {parent && tagKeys.some((k) => tagOf(model, parent, k))
            ? `Hereda de ${parent.name}: ${tagKeys
                .map((k) => [k, tagOf(model, parent, k)] as const)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k} = ${v}`)
                .join(', ')}.`
            : 'Centro de costos, proyecto o unidad de negocio para repartir costos.'}
        </p>
      ) : null}
      <datalist id="finops-tag-keys">
        {tagKeys.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </div>
  );
}

export function currencySymbol(currency: string): string {
  try {
    return (
      new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
      })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value ?? currency
    );
  } catch {
    return currency;
  }
}
