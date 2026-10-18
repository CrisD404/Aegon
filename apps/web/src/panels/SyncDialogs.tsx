import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { ExternalLink, Loader2, X } from 'lucide-react';
import type { MergeConflict, Resolution } from '@aegon/core';
import { TechIcon } from '@aegon/icons';
import { useSync } from '../store/sync.ts';
import { useUi } from '../store/ui.ts';
import { linkGitHub, openGitHubWorkspace, useWorkspace } from '../store/workspace.ts';
import { Button, Field, Segmented, TextInput, cn } from '../ui/primitives.tsx';

function Modal({ open, onClose, title, description, children, footer, wide }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade fixed inset-0 z-50 bg-[var(--overlay)]" />
        <Dialog.Content
          className={cn(
            'animate-pop fixed top-1/2 left-1/2 z-50 flex max-h-[min(720px,90vh)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-pop',
            wide ? 'w-[min(760px,calc(100vw-32px))]' : 'w-[min(460px,calc(100vw-32px))]',
          )}
        >
          <div className="flex items-start gap-3 border-b border-line px-5 pt-4 pb-3">
            <div className="flex-1">
              <Dialog.Title className="m-0 text-[15px] font-semibold text-fg">{title}</Dialog.Title>
              {description ? <Dialog.Description className="m-0 mt-1 text-[12.5px] leading-relaxed text-fg-muted">{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close className="rounded-sm p-1 text-fg-subtle hover:bg-hover hover:text-fg" aria-label="Cerrar">
              <X size={15} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
          <div className="flex items-center gap-2 border-t border-line px-5 py-3">{footer}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// -----------------------------------------------------------------------------------------------
// Conflictos

const ENTITY_LABEL: Record<MergeConflict['entity'], string> = {
  element: 'Elemento',
  relation: 'Relación',
  view: 'Lienzo',
  flow: 'Flujo',
  comment: 'Comentario',
  workspace: 'Workspace',
  file: 'Archivo',
};

const KIND_LABEL: Record<MergeConflict['kind'], string> = {
  'both-modified': 'Ambos lo modificaron',
  'both-added': 'Ambos lo crearon distinto',
  'modified-deleted': 'Lo modificaste y en el remoto lo borraron',
  'deleted-modified': 'Lo borraste y en el remoto lo modificaron',
};

function show(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object')) return value.join(', ');
  return JSON.stringify(value);
}

export function ConflictDialog() {
  const pending = useSync((s) => s.pending);
  const resolve = useSync((s) => s.resolve);
  const cancel = useSync((s) => s.cancel);
  const [choices, setChoices] = useState<Record<string, Resolution>>({});
  useEffect(() => setChoices({}), [pending]);
  if (!pending) return null;
  const { conflicts, repairs } = pending.result;
  const setAll = (r: Resolution) => setChoices(Object.fromEntries(conflicts.map((c) => [c.key, r])));

  return (
    <Modal
      open
      wide
      onClose={cancel}
      title={pending.mode === 'push' ? 'Conflictos al publicar' : 'Conflictos al actualizar'}
      description={`Vos y el remoto cambiaron lo mismo en ${conflicts.length} ${conflicts.length === 1 ? 'lugar' : 'lugares'}. Elegí qué versión queda; todo lo demás ya se combinó solo.`}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => setAll('ours')}>
            Todo lo mío
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAll('theirs')}>
            Todo lo remoto
          </Button>
          <span className="flex-1" />
          <Button size="sm" onClick={cancel}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" onClick={() => void resolve(choices)} data-testid="resolve-button">
            {pending.mode === 'push' ? 'Aplicar y publicar' : 'Aplicar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="conflict-list">
        {conflicts.map((c) => {
          const choice = choices[c.key] ?? 'ours';
          return (
            <div key={c.key} className="rounded-md border border-line" data-testid={`conflict-${c.key}`}>
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className="text-[11px] font-medium text-fg-subtle">{ENTITY_LABEL[c.entity]}</span>
                <span className="truncate text-[13px] font-semibold text-fg">{c.name}</span>
                <span className="ml-auto shrink-0 rounded-full bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] px-2 py-0.5 text-[10.5px] font-medium text-warn">{KIND_LABEL[c.kind]}</span>
              </div>
              {c.fields.length ? (
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="text-left text-[10.5px] tracking-[0.04em] text-fg-subtle uppercase">
                      <th className="px-3 py-1.5 font-semibold">Campo</th>
                      <th className={cn('px-3 py-1.5 font-semibold', choice === 'ours' && 'text-accent')}>Tuyo</th>
                      <th className={cn('px-3 py-1.5 font-semibold', choice === 'theirs' && 'text-accent')}>Remoto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.fields.map((f) => (
                      <tr key={f.path.join('.')} className="border-t border-line align-top">
                        <td className="px-3 py-1.5 font-mono text-[11px] text-fg-subtle">{f.path.join('.')}</td>
                        <td className={cn('px-3 py-1.5 break-all', choice === 'ours' ? 'text-fg' : 'text-fg-subtle line-through')}>{show(f.ours)}</td>
                        <td className={cn('px-3 py-1.5 break-all', choice === 'theirs' ? 'text-fg' : 'text-fg-subtle line-through')}>{show(f.theirs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              <div className="px-3 py-2">
                <Segmented
                  value={choice}
                  onChange={(v) => setChoices({ ...choices, [c.key]: v ?? 'ours' })}
                  options={[
                    { value: 'ours', label: c.kind === 'deleted-modified' ? 'Mantener borrado' : 'Mantener lo mío' },
                    { value: 'theirs', label: c.kind === 'modified-deleted' ? 'Aceptar el borrado' : 'Usar lo remoto' },
                  ]}
                />
              </div>
            </div>
          );
        })}
        {repairs.length ? (
          <div className="rounded-md border border-line bg-raised px-3 py-2 text-[12px] text-fg-muted">
            <div className="mb-1 font-medium text-fg">Ajustes automáticos</div>
            {repairs.map((r, i) => (
              <div key={i}>· {r}</div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------------------------
// GitHub

export function parseRepo(input: string): { owner: string; repo: string } | null {
  const text = input.trim().replace(/\.git$/, '');
  const url = text.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i);
  if (url) return { owner: url[1]!, repo: url[2]! };
  const short = text.match(/^([\w.-]+)\/([\w.-]+)$/);
  return short ? { owner: short[1]!, repo: short[2]! } : null;
}

export function GitHubDialog() {
  const mode = useUi((s) => s.githubDialog);
  const setMode = useUi((s) => s.setGitHubDialog);
  const workspaceName = useWorkspace((s) => s.model.workspace.name);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [mode]);
  if (!mode) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseRepo(repo);
    if (!parsed) return setError('Escribí el repo como "organización/repo" o pegá su URL de GitHub');
    if (!token.trim()) return setError('Falta el token');
    setBusy(true);
    setError(null);
    try {
      const target = { ...parsed, branch: branch.trim() || 'main', token: token.trim() };
      if (mode === 'open') {
        const result = await openGitHubWorkspace(target);
        if (result === 'empty') {
          setError(`${parsed.owner}/${parsed.repo} no tiene un workspace de Aegon. Podés publicar el actual ahí con "Vincular este workspace".`);
          return;
        }
      } else {
        await linkGitHub(target);
      }
      setMode(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => setMode(null)}
      title={mode === 'open' ? 'Abrir desde GitHub' : `Publicar "${workspaceName}" en GitHub`}
      description={
        mode === 'open'
          ? 'Trae un repo que ya tiene un workspace de Aegon. Los cambios quedan como borrador hasta que los publiques con Commit & push.'
          : 'El workspace se sube al repo (puede estar vacío o tener otros archivos, que se conservan). Desde ahí en adelante se sincroniza con Commit & push.'
      }
      footer={
        <>
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[12px] text-accent hover:underline"
          >
            Crear token <ExternalLink size={11} />
          </a>
          <span className="flex-1" />
          <Button size="sm" onClick={() => setMode(null)}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" type="submit" form="github-form" disabled={busy} data-testid="github-submit">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <TechIcon icon="github" size={13} />}
            {mode === 'open' ? 'Abrir' : 'Publicar'}
          </Button>
        </>
      }
    >
      <form id="github-form" onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Segmented
          value={mode}
          onChange={(v) => v && setMode(v)}
          options={[
            { value: 'open', label: 'Abrir un repo' },
            { value: 'link', label: 'Vincular este workspace' },
          ]}
        />
        <Field label="Repositorio">
          <TextInput value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="organización/repo o https://github.com/…" autoFocus data-testid="github-repo" />
        </Field>
        <Field label="Rama">
          <TextInput value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" data-testid="github-branch" />
        </Field>
        <Field label="Token de acceso" hint="Contents: read and write">
          <TextInput type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" data-testid="github-token" />
        </Field>
        <p className="m-0 text-[11.5px] leading-relaxed text-fg-subtle">
          Usá un token <i>fine-grained</i> limitado a ese repo. Se guarda solo en este navegador (IndexedDB) y se usa únicamente para hablar con la API de GitHub.
        </p>
        {error ? <p className="m-0 rounded-sm border border-danger/30 bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[12px] text-danger" data-testid="github-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
