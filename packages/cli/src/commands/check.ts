import { analyzeModel, type Diagnostic } from '@aegon/core';
import { countBySeverity, formatDiagnostic, json, plural, type Io } from '../io.ts';
import type { Workspace } from '../workspace.ts';

export function workspaceHeader(ws: Workspace): string {
  const m = ws.model;
  const counts = [
    plural(Object.keys(m.elements).length, 'elemento', 'elementos'),
    plural(Object.keys(m.relations).length, 'relación', 'relaciones'),
    plural(Object.keys(m.views).length, 'lienzo', 'lienzos'),
  ].join(' · ');
  return `Workspace "${m.workspace.name}" · ${counts}`;
}

export function workspaceJson(ws: Workspace) {
  return {
    id: ws.model.workspace.id,
    name: ws.model.workspace.name,
    root: ws.root,
    elements: Object.keys(ws.model.elements).length,
    relations: Object.keys(ws.model.relations).length,
    views: Object.keys(ws.model.views).length,
  };
}

function totals(diagnostics: readonly Diagnostic[]): string {
  const c = countBySeverity(diagnostics);
  const parts = [plural(c.errors, 'error', 'errores'), plural(c.warnings, 'aviso', 'avisos')];
  if (c.infos) parts.push(plural(c.infos, 'info', 'info'));
  return parts.join(' · ');
}

function failed(diagnostics: readonly Diagnostic[], strict: boolean): boolean {
  return diagnostics.some((d) => d.severity === 'error' || (strict && d.severity === 'warning'));
}

/** `aegon validate`: formato, referencias y reglas C4. */
export function validate(io: Io, ws: Workspace, opts: { info: boolean; strict: boolean; json: boolean }): number {
  const diagnostics = ws.validate({ info: opts.info });
  const ok = !failed(diagnostics, opts.strict);
  if (opts.json) {
    json(io, { ok, workspace: workspaceJson(ws), ...countBySeverity(diagnostics), diagnostics });
    return ok ? 0 : 1;
  }
  io.stdout(`${workspaceHeader(ws)}\n`);
  for (const d of diagnostics) io.stdout(`${formatDiagnostic(d)}\n`);
  io.stdout(diagnostics.length ? `${ok ? '✓' : '✗'} ${totals(diagnostics)}\n` : '✓ Sin errores ni avisos\n');
  return ok ? 0 : 1;
}

/** `aegon lint`: validación + análisis (huérfanos, ciclos, violaciones C4, protocolos, riesgo). */
export function lint(io: Io, ws: Workspace, opts: { strict: boolean; json: boolean; hotspots: number }): number {
  const model = ws.model;
  const analysis = analyzeModel(model, { hotspotLimit: opts.hotspots });
  // Los errores de validación ya vienen en los diagnósticos de lectura (con su archivo).
  const seen = new Set(ws.diagnostics.map((d) => `${d.code}|${d.message}`));
  const violations = [...ws.diagnostics, ...analysis.violations.filter((d) => !seen.has(`${d.code}|${d.message}`))];
  // Huérfanos y ciclos cuentan como avisos: con --strict también hacen fallar.
  const ok = !failed(violations, opts.strict) && !(opts.strict && (analysis.orphans.length || analysis.cycles.length));
  if (opts.json) {
    json(io, { ok, workspace: workspaceJson(ws), ...analysis, violations });
    return ok ? 0 : 1;
  }

  const name = (id: string) => model.elements[id]?.name ?? id;
  io.stdout(`${workspaceHeader(ws)}\n`);
  const section = (title: string, lines: string[]) => {
    if (!lines.length) return;
    io.stdout(`\n${title}\n`);
    for (const l of lines) io.stdout(`  ${l}\n`);
  };
  section('Violaciones', violations.map(formatDiagnostic));
  section('Huérfanos (sin relaciones)', analysis.orphans.map((o) => `! ${o.name} (${o.id}, ${o.kind})`));
  section('Ciclos de dependencias', analysis.cycles.map((c) => `! ${[...c.elements, c.elements[0]!].map(name).join(' → ')}  [${c.relations.join(', ')}]`));
  section(
    'Relaciones sin protocolo',
    analysis.missingProtocols.map((m) => `· ${m.name} (${m.relation})${m.suggestions.length ? ` → sugeridos: ${m.suggestions.join(', ')}` : ''}`),
  );
  section(
    'Hotspots de riesgo',
    analysis.hotspots.map((h) => `· ${h.name} (${h.id}): ${h.reasons.join(', ')}${h.dependents.length ? ` — lo usan ${h.dependents.map(name).join(', ')}` : ''}`),
  );
  const s = analysis.summary;
  const c = countBySeverity(violations);
  io.stdout(
    `\n${ok ? '✓' : '✗'} ${plural(c.errors, 'error', 'errores')} · ${plural(c.warnings, 'aviso', 'avisos')} · ` +
      `huérfanos ${s.orphans} · ciclos ${s.cycles} · sin protocolo ${s.missingProtocols} · hotspots ${s.hotspots}\n`,
  );
  return ok ? 0 : 1;
}
