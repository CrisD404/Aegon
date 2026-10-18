import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, CircleAlert, Eye, FolderOpen, GitBranch, GitCommitHorizontal, HardDrive, Loader2, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { commitMessage, diffModels, entityLabel, type Change, type FieldChange } from '@aegon/core';
import { Glyph, TechIcon } from '@aegon/icons';
import { linkToFolder, useWorkspace } from '../store/workspace.ts';
import { useSync } from '../store/sync.ts';
import { useUi } from '../store/ui.ts';
import { isDesktop } from '../lib/tauri.ts';
import { revealElement } from '../lib/actions.ts';
import { discardChangesFlow } from '../lib/flows.tsx';
import { Button, IconButton, Tip, cn } from '../ui/primitives.tsx';

const BADGE: Record<Change['kind'], { letter: string; color: string; title: string }> = {
  added: { letter: 'A', color: 'var(--ok)', title: 'Agregado' },
  modified: { letter: 'M', color: 'var(--warn)', title: 'Modificado' },
  removed: { letter: 'E', color: 'var(--danger)', title: 'Eliminado' },
};

function short(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object')) return value.join(', ') || '[]';
  const json = JSON.stringify(value);
  return json.length > 60 ? `${json.slice(0, 57)}…` : json;
}

/**
 * Cambios pendientes: con git, contra el último commit sincronizado (lo que falta publicar);
 * sin git, contra lo guardado.
 */
export function useChanges() {
  const base = useWorkspace((s) => s.syncBase ?? s.base);
  const model = useWorkspace((s) => s.model);
  return useMemo(() => diffModels(base, model), [base, model]);
}

/** ¿Hay cambios sin guardar en disco/navegador? */
export function useUnsaved() {
  const base = useWorkspace((s) => s.base);
  const model = useWorkspace((s) => s.model);
  return useMemo(() => diffModels(base, model).length > 0, [base, model]);
}

export function ChangesPanel() {
  const changes = useChanges();
  const diagnostics = useWorkspace((s) => s.diagnostics);
  const saving = useWorkspace((s) => s.saving);
  const save = useWorkspace((s) => s.save);
  const git = useWorkspace((s) => s.git);
  const unsaved = useUnsaved();
  const message = useMemo(() => commitMessage(changes), [changes]);
  const errors = diagnostics.filter((d) => d.severity !== 'info');

  const sections: [string, Change[]][] = [
    ['Elementos', changes.filter((c) => c.entity === 'element')],
    ['Relaciones', changes.filter((c) => c.entity === 'relation')],
    ['Lienzos', changes.filter((c) => c.entity === 'view')],
    ['Workspace', changes.filter((c) => c.entity === 'workspace')],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="changes-panel">
      <div className="min-h-0 flex-1 overflow-auto px-3 pt-3 pb-4">
        {errors.length ? (
          <div className="mb-3 flex flex-col gap-1 rounded-md border border-danger/30 bg-[color-mix(in_srgb,var(--danger)_7%,transparent)] px-3 py-2">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-danger">
              <CircleAlert size={13} /> {errors.length} {errors.length === 1 ? 'problema' : 'problemas'} al leer los archivos
            </span>
            {errors.slice(0, 6).map((d, i) => (
              <span key={i} className="text-[11.5px] text-fg-muted">
                {d.file ? <span className="font-mono text-fg-subtle">{d.file}: </span> : null}
                {d.message}
              </span>
            ))}
          </div>
        ) : null}

        {!changes.length ? (
          <div className="flex flex-col items-center gap-2 px-4 pt-16 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-raised text-fg-subtle">
              <GitCommitHorizontal size={18} />
            </span>
            <p className="m-0 text-[13px] font-medium text-fg">Sin cambios pendientes</p>
            <p className="m-0 text-[12px] leading-relaxed text-fg-subtle">Todo lo que edites se guarda como borrador local y aparece acá antes de guardarlo o subirlo al repo.</p>
          </div>
        ) : (
          sections.map(([title, list]) =>
            list.length ? (
              <div key={title} className="mb-3">
                <div className="flex h-7 items-center justify-between px-1 text-[10.5px] font-semibold tracking-[0.05em] text-fg-subtle uppercase">
                  {title}
                  <span className="tabular-nums font-normal">{list.length}</span>
                </div>
                {list.map((c) => (
                  <ChangeRow key={c.key} change={c} />
                ))}
              </div>
            ) : null,
          )
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-panel px-3 pt-3 pb-3">
        <StorageLine />
        {git ? (
          <GitFooter changes={changes.length} autoMessage={message} unsaved={unsaved} saving={saving} onSave={() => void save()} />
        ) : (
          <>
            {changes.length ? (
              <pre className="mb-2 max-h-[84px] overflow-auto rounded-sm border border-line bg-raised px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-muted" data-testid="commit-message">
                {message}
              </pre>
            ) : null}
            <Button variant="primary" size="sm" className="w-full" disabled={!changes.length || saving} onClick={() => void save()} data-testid="save-button">
              <Save size={13} /> {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </>
        )}
        {changes.length ? (
          <button
            type="button"
            className="mt-2 text-[11.5px] text-fg-subtle hover:text-danger"
            onClick={() => void discardChangesFlow()}
            data-testid="discard-all"
          >
            Descartar todos los cambios
          </button>
        ) : null}
      </div>
    </div>
  );
}

function StorageLine() {
  const record = useWorkspace((s) => s.record);
  const source = record?.source;
  const where =
    source === 'github' && record?.github
      ? `GitHub · ${record.github.owner}/${record.github.repo}`
      : source === 'desktop'
        ? (record?.path ?? 'carpeta')
        : source === 'folder'
          ? `carpeta "${record?.folderName}"`
          : 'este navegador';
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
      {source === 'github' ? <TechIcon icon="github" size={12} /> : source === 'folder' || source === 'desktop' ? <FolderOpen size={12} /> : <HardDrive size={12} />}
      Se guarda en: <span className="truncate text-fg-muted" title={where}>{where}</span>
      {source === 'browser' ? (
        <span className="ml-auto flex shrink-0 gap-2">
          {!isDesktop() ? (
            <button type="button" className="text-accent hover:underline" onClick={() => useUi.getState().setGitHubDialog('link')}>
              GitHub
            </button>
          ) : null}
          <button type="button" className="text-accent hover:underline" onClick={() => void linkToFolder()}>
            Carpeta
          </button>
        </span>
      ) : null}
    </div>
  );
}

function GitFooter({ changes, autoMessage, unsaved, saving, onSave }: { changes: number; autoMessage: string; unsaved: boolean; saving: boolean; onSave: () => void }) {
  const status = useSync((s) => s.status);
  const busy = useSync((s) => s.busy);
  const error = useSync((s) => s.error);
  const push = useSync((s) => s.push);
  const pull = useSync((s) => s.pull);
  const refresh = useSync((s) => s.refresh);
  const source = useWorkspace((s) => s.record?.source);
  const [message, setMessage] = useState('');
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    if (!edited) setMessage(autoMessage);
  }, [autoMessage, edited]);
  const canPush = changes > 0 || (status?.ahead ?? 0) > 0;

  return (
    <div className="flex flex-col gap-2" data-testid="git-footer">
      <div className="flex items-center gap-1.5 rounded-sm border border-line bg-raised px-2 py-1.5 text-[11.5px]">
        <GitBranch size={12} className="shrink-0 text-fg-subtle" />
        <span className="truncate font-medium text-fg" data-testid="git-branch">{status?.label ?? '…'}</span>
        {status?.ahead ? (
          <span className="flex items-center text-fg-muted" title="Commits locales sin publicar">
            <ArrowUp size={11} />
            {status.ahead}
          </span>
        ) : null}
        {status?.behind ? (
          <span className="flex items-center text-warn" title="Commits remotos sin traer">
            <ArrowDown size={11} />
            {status.behind}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-0.5">
          <IconButton size="sm" label="Actualizar estado" onClick={() => void refresh()} disabled={!!busy}>
            <RefreshCw size={12} className={busy === 'status' ? 'animate-spin' : undefined} />
          </IconButton>
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => void pull()} disabled={!!busy} data-testid="pull-button">
            {busy === 'pull' ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}
            Actualizar
          </Button>
        </span>
      </div>
      {error ? <p className="m-0 text-[11.5px] leading-snug text-danger">{error}</p> : null}
      {changes ? (
        <textarea
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setEdited(true);
          }}
          rows={3}
          className="w-full resize-y rounded-sm border border-line bg-raised px-2.5 py-2 font-mono text-[11px] leading-relaxed text-fg outline-none focus:border-accent"
          aria-label="Mensaje del commit"
          data-testid="commit-message"
        />
      ) : null}
      <div className={cn('grid gap-2', source === 'desktop' ? 'grid-cols-2' : 'grid-cols-1')}>
        {source === 'desktop' ? (
          <Tip label="Escribe los YAML en la carpeta sin hacer commit">
            <Button size="sm" disabled={!unsaved || saving} onClick={onSave} data-testid="save-button">
              <Save size={13} /> {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </Tip>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          disabled={!canPush || !!busy}
          onClick={() => {
            void push(message).then(() => setEdited(false));
          }}
          data-testid="push-button"
        >
          {busy === 'push' ? <Loader2 size={13} className="animate-spin" /> : <GitCommitHorizontal size={13} />}
          {busy === 'push' ? 'Publicando…' : 'Commit & push'}
        </Button>
      </div>
    </div>
  );
}

function ChangeRow({ change }: { change: Change }) {
  const [open, setOpen] = useState(false);
  const revertChange = useWorkspace((s) => s.revertChange);
  const badge = BADGE[change.kind];
  const detail = change.entity === 'view' && change.layout ? layoutText(change) : change.fields.map((f) => f.path.split('.')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  const canOpen = change.fields.length > 0;
  return (
    <div className="group rounded-sm hover:bg-hover/60" data-testid={`change-${change.key}`}>
      <div className="flex h-8 items-center gap-2 px-1.5">
        <button type="button" onClick={() => canOpen && setOpen(!open)} className={cn('grid h-4 w-4 place-items-center text-fg-subtle', !canOpen && 'invisible')} aria-label="Ver detalle">
          <ChevronRight size={12} className={cn('transition-transform duration-150', open && 'rotate-90')} />
        </button>
        <span title={badge.title} className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[4px] font-mono text-[10px] font-bold" style={{ color: badge.color, background: `color-mix(in srgb, ${badge.color} 14%, transparent)` }}>
          {badge.letter}
        </span>
        {change.elementKind ? <Glyph name={change.elementKind} size={13} className="shrink-0" style={{ color: `var(--kind-${change.elementKind})` }} /> : null}
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg" title={`${entityLabel(change)}: ${change.name}`}>
          {change.name}
          {detail ? <span className="ml-1.5 text-[11.5px] text-fg-subtle">{detail}</span> : null}
        </span>
        <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
          {change.entity === 'element' && change.kind !== 'removed' ? (
            <IconButton size="sm" label="Mostrar" onClick={() => revealElement(change.id)}>
              <Eye size={12} />
            </IconButton>
          ) : null}
          <IconButton size="sm" label="Revertir este cambio" onClick={() => revertChange(change)}>
            <RotateCcw size={12} />
          </IconButton>
        </span>
      </div>
      {open ? (
        <div className="animate-fade mb-1 ml-[30px] flex flex-col gap-1 border-l border-line pb-1 pl-3">
          {change.fields.map((f) => (
            <FieldDiff key={f.path} field={f} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FieldDiff({ field }: { field: FieldChange }) {
  return (
    <div className="flex flex-col text-[11.5px] leading-snug">
      <span className="font-mono text-fg-subtle">{field.path}</span>
      <span className="flex flex-wrap items-center gap-1">
        <span className="rounded-[3px] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-1 text-fg-muted line-through decoration-danger/50">{short(field.before)}</span>
        <span className="text-fg-subtle">→</span>
        <span className="rounded-[3px] bg-[color-mix(in_srgb,var(--ok)_12%,transparent)] px-1 text-fg">{short(field.after)}</span>
      </span>
    </div>
  );
}

function layoutText(change: Change): string {
  const l = change.layout!;
  const parts: string[] = [];
  if (l.moved) parts.push(`${l.moved} movidos`);
  if (l.added) parts.push(`${l.added} ubicados`);
  if (l.removed) parts.push(`${l.removed} quitados`);
  for (const f of change.fields) parts.push(f.path === 'edges' ? 'estilos' : f.path);
  return parts.join(' · ');
}

export function useChangeCount() {
  return useChanges().length;
}

