import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, Repeat2, ShieldAlert, TriangleAlert, Unlink } from 'lucide-react';
import { analyzeModel, type Analysis, type Diagnostic, type Id, type Model } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { revealElement } from '../lib/actions.ts';
import { Switch, cn } from '../ui/primitives.tsx';

/** Con modelos muy grandes el análisis corre solo cuando se mira el panel (no en cada edición). */
const AUTO_LIMIT = 1500;
const PREVIEW = 6;

const cache = new WeakMap<Model, Analysis>();

function healthOf(model: Model): Analysis {
  let analysis = cache.get(model);
  if (!analysis) {
    analysis = analyzeModel(model, { hotspotLimit: 8 });
    cache.set(model, analysis);
  }
  return analysis;
}

/**
 * Salud del modelo: el mismo análisis de `aegon lint` y del servidor MCP, a la vista. `null` si el
 * modelo es grande y nadie está mirando el panel (para no analizar en cada edición).
 */
export function useHealth(force = false): Analysis | null {
  const model = useWorkspace((s) => s.model);
  const deferred = useDeferredValue(model);
  return useMemo(
    () => (!force && Object.keys(deferred.elements).length > AUTO_LIMIT ? null : healthOf(deferred)),
    [deferred, force],
  );
}

/** Lo que conviene mirar ya: errores, avisos y ciclos (lo demás son sugerencias). */
export function healthCount(analysis: Analysis | null): { errors: number; warnings: number } {
  if (!analysis) return { errors: 0, warnings: 0 };
  return { errors: analysis.summary.errors, warnings: analysis.summary.warnings + analysis.summary.cycles };
}

/** Lleva al lienzo lo que señala un hallazgo. */
function reveal(model: Model, entity: Diagnostic['entity']) {
  if (!entity) return;
  const ui = useUi.getState();
  if (entity.type === 'element') revealElement(entity.id);
  else if (entity.type === 'relation') {
    const rel = model.relations[entity.id];
    if (!rel) return;
    revealElement(rel.from);
    ui.select([], [rel.id]);
  } else if (entity.type === 'view') {
    if (model.views[entity.id]) ui.openView(entity.id, { transition: 'fade' });
  } else if (entity.type === 'flow') {
    ui.setPref('sidebarTab', 'flows');
    ui.setPref('sidebarOpen', true);
    ui.setFlowEdit({ id: entity.id, step: null });
  }
}

interface Row {
  key: string;
  text: ReactNode;
  onClick?: () => void;
}

function Section({ icon, title, tone, rows }: { icon: ReactNode; title: string; tone: 'danger' | 'warn' | 'muted'; rows: Row[] }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, PREVIEW);
  return (
    <section className="flex flex-col gap-1" data-testid={`health-${title}`}>
      <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">
        <span className={cn(tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-fg-subtle')}>{icon}</span>
        {title}
        <span className="ml-auto font-normal tabular-nums">{rows.length}</span>
      </div>
      {shown.map((row) => (
        <button
          key={row.key}
          type="button"
          onClick={row.onClick}
          disabled={!row.onClick}
          className="rounded-sm px-2 py-1.5 text-left text-[12.5px] leading-snug text-fg-muted transition-colors enabled:hover:bg-hover enabled:hover:text-fg"
        >
          {row.text}
        </button>
      ))}
      {rows.length > PREVIEW ? (
        <button type="button" onClick={() => setAll(!all)} className="self-start rounded-sm px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft">
          {all ? 'Ver menos' : `Ver ${rows.length - PREVIEW} más`}
        </button>
      ) : null}
    </section>
  );
}

/**
 * Panel Salud: qué conviene revisar del modelo, sin preguntar nada. Cada hallazgo lleva al lienzo;
 * lo que no tiene hallazgos no ocupa lugar.
 */
export function HealthPanel() {
  const model = useWorkspace((s) => s.model);
  const dispatch = useWorkspace((s) => s.dispatch);
  const analysis = useHealth(true)!;
  const name = (id: Id) => model.elements[id]?.name ?? id;

  const diag = (d: Diagnostic, i: number): Row => ({ key: `${d.code}:${d.entity?.id ?? ''}:${i}`, text: d.message, onClick: d.entity ? () => reveal(model, d.entity) : undefined });
  const errors = analysis.violations.filter((d) => d.severity === 'error').map(diag);
  const warnings = analysis.violations.filter((d) => d.severity === 'warning').map(diag);
  const cycles = analysis.cycles.map((c, i): Row => ({
    key: `cycle:${i}`,
    text: [...c.elements, c.elements[0]!].map(name).join(' → '),
    onClick: () => reveal(model, { type: 'element', id: c.elements[0]! }),
  }));
  const hotspots = analysis.hotspots.map((h): Row => ({
    key: `hot:${h.id}`,
    text: (
      <>
        <span className="font-medium text-fg">{h.name}</span> · {h.reasons.join(', ')}
      </>
    ),
    onClick: () => reveal(model, { type: 'element', id: h.id }),
  }));
  const orphans = analysis.orphans.map((o): Row => ({ key: `orphan:${o.id}`, text: o.name, onClick: () => reveal(model, { type: 'element', id: o.id }) }));
  const protocols = analysis.missingProtocols.map((m): Row => ({
    key: `proto:${m.relation}`,
    text: (
      <>
        {m.name}
        {m.suggestions.length ? <span className="text-fg-subtle"> · sugerido: {m.suggestions.join(', ')}</span> : null}
      </>
    ),
    onClick: () => reveal(model, { type: 'relation', id: m.relation }),
  }));

  const { errors: e, warnings: w } = healthCount(analysis);
  const clean = !e && !w;
  const suggestions = hotspots.length + orphans.length + protocols.length;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="health-panel">
      <div className={cn('flex items-start gap-2.5 rounded-md border px-3 py-2.5', clean ? 'border-line' : e ? 'border-danger/35' : 'border-warn/35')}>
        <span className={cn('mt-px', clean ? 'text-ok' : e ? 'text-danger' : 'text-warn')}>{clean ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}</span>
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold text-fg" data-testid="health-summary">
            {clean ? 'Sin problemas' : [e ? `${e} ${e === 1 ? 'error' : 'errores'}` : '', w ? `${w} ${w === 1 ? 'aviso' : 'avisos'}` : ''].filter(Boolean).join(' · ')}
          </p>
          <p className="m-0 text-[12px] leading-snug text-fg-subtle">
            {analysis.summary.elements} elementos, {analysis.summary.relations} relaciones
            {suggestions ? ` · ${suggestions} ${suggestions === 1 ? 'sugerencia' : 'sugerencias'}` : ''}
          </p>
        </div>
      </div>

      <Section icon={<CircleAlert size={12} />} title="Errores" tone="danger" rows={errors} />
      <Section icon={<TriangleAlert size={12} />} title="Avisos" tone="warn" rows={warnings} />
      <Section icon={<Repeat2 size={12} />} title="Ciclos de dependencias" tone="warn" rows={cycles} />
      <Section icon={<ShieldAlert size={12} />} title="Riesgo concentrado" tone="muted" rows={hotspots} />
      <Section icon={<Unlink size={12} />} title="Sin relaciones" tone="muted" rows={orphans} />
      <Section icon={<Info size={12} />} title="Relaciones sin protocolo" tone="muted" rows={protocols} />

      <div className="border-t border-line pt-3">
        <Switch
          checked={!!model.workspace.strictC4}
          onChange={(v) => dispatch({ type: 'workspace.update', patch: { strictC4: v ? true : null } }, { label: 'C4 estricto' })}
          label="C4 estricto"
          description="Avisa cuando un lienzo mezcla niveles. Apagado, cada lienzo muestra lo que haga falta."
        />
      </div>
    </div>
  );
}
