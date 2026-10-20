import { create } from 'zustand';
import {
  applyOp,
  batch,
  builtinTemplates,
  diffModels,
  emptyModel,
  isNoop,
  mergeModels,
  OpError,
  revertChangeOp,
  slugify,
  workspaceFromTemplate,
  type Change,
  type Diagnostic,
  type Model,
  type Op,
  type Template,
  levelRank,
} from '@aegon/core';
import { isAegonWorkspace, planWrite } from '@aegon/format-yaml';
import {
  FolderStorage,
  IdbStorage,
  applyWritePlan,
  ensureDirectoryPermission,
  isFsAccessSupported,
  pickDirectory,
  readAll,
  type WorkspaceStorage,
} from '@aegon/storage';
import { CliGitSync, GitHubSync, type GitHubTarget, type GitSync } from '@aegon/git';
import { TauriGitBackend, TauriStorage, isDesktop, pickFolderNative, watchFolder } from '../lib/tauri.ts';
import {
  newKey,
  persist,
  setLastWorkspaceKey,
  type WorkspaceRecord,
} from '../lib/persist.ts';
import { parseFiles, serializeModel } from '../lib/yaml.ts';
import { DevFolderStorage } from '../lib/dev-folder.ts';
import { useUi } from './ui.ts';

type HistoryEntry =
  | { kind: 'op'; label: string; op: Op; inverse: Op; key?: string; at: number }
  | { kind: 'snapshot'; label: string; before: Model; after: Model; at: number };

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'needs-permission' | 'error';

interface WorkspaceState {
  status: LoadStatus;
  error: string | null;
  record: WorkspaceRecord | null;
  storage: WorkspaceStorage | null;
  /** Archivos tal como están en el almacenamiento (último guardado). */
  files: ReadonlyMap<string, string>;
  /** Modelo guardado (lo que hay en los archivos). */
  base: Model;
  /** Modelo actual (borrador). */
  model: Model;
  diagnostics: Diagnostic[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  saving: boolean;
  recents: WorkspaceRecord[];
  /** Sincronización con git (CLI en escritorio, GitHub API en web) o null si no hay repo. */
  git: GitSync | null;
  /** Último commit sincronizado. */
  synced: string | null;
  /** Modelo en ese commit: la base de los merges (puede diferir de `base` si hay guardados sin commitear). */
  syncBase: Model | null;
  /** Hay un push/pull en curso: los cambios de disco son nuestros, no externos. */
  syncing: boolean;

  dispatch(op: Op, opts?: { label?: string; coalesce?: string }): boolean;
  undo(): void;
  redo(): void;
  revertChange(change: Change): void;
  discardAll(): void;
  save(): Promise<void>;
  refreshRecents(): Promise<void>;
}

const placeholder = emptyModel('workspace', 'Workspace');

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  status: 'idle',
  error: null,
  record: null,
  storage: null,
  files: new Map(),
  base: placeholder,
  model: placeholder,
  diagnostics: [],
  past: [],
  future: [],
  saving: false,
  recents: [],
  git: null,
  synced: null,
  syncBase: null,
  syncing: false,

  dispatch(op, opts = {}) {
    if (isNoop(op)) return true;
    const { model, past } = get();
    let result;
    try {
      result = applyOp(model, op);
    } catch (error) {
      const message = error instanceof OpError ? error.message : String(error);
      useUi.getState().toast(message, 'error');
      if (!(error instanceof OpError)) console.error(error);
      return false;
    }
    const now = Date.now();
    const label = opts.label ?? (op.type === 'batch' && op.label ? op.label : describeOp(op));
    const top = past[past.length - 1];
    let nextPast: HistoryEntry[];
    if (opts.coalesce && top?.kind === 'op' && top.key === opts.coalesce && now - top.at < 1500) {
      nextPast = [
        ...past.slice(0, -1),
        { ...top, op: batch([top.op, op]), inverse: batch([result.inverse, top.inverse]), at: now },
      ];
    } else {
      nextPast = [...past.slice(-199), { kind: 'op', label, op, inverse: result.inverse, key: opts.coalesce, at: now }];
    }
    set({ model: result.model, past: nextPast, future: [] });
    return true;
  },

  undo() {
    const { past, future, model } = get();
    const entry = past[past.length - 1];
    if (!entry) return;
    try {
      const next = entry.kind === 'op' ? applyOp(model, entry.inverse).model : entry.before;
      set({ model: next, past: past.slice(0, -1), future: [...future, entry] });
      useUi.getState().toast(`Deshecho: ${entry.label}`);
    } catch (error) {
      useUi.getState().toast(`No se pudo deshacer: ${String((error as Error).message)}`, 'error');
    }
  },

  redo() {
    const { past, future, model } = get();
    const entry = future[future.length - 1];
    if (!entry) return;
    try {
      const next = entry.kind === 'op' ? applyOp(model, entry.op).model : entry.after;
      set({ model: next, past: [...past, entry], future: future.slice(0, -1) });
    } catch (error) {
      useUi.getState().toast(`No se pudo rehacer: ${String((error as Error).message)}`, 'error');
    }
  },

  revertChange(change) {
    const { model } = get();
    const base = get().syncBase ?? get().base;
    const op = revertChangeOp(base, model, change);
    if (!op) {
      useUi.getState().toast('Este cambio depende de otro: revertí primero el elemento que lo contiene.', 'error');
      return;
    }
    get().dispatch(op, { label: `Revertir ${change.name}` });
  },

  discardAll() {
    const { model, past } = get();
    const base = get().syncBase ?? get().base;
    if (base === model) return;
    set({
      model: base,
      past: [...past, { kind: 'snapshot', label: 'Descartar cambios', before: model, after: base, at: Date.now() }],
      future: [],
    });
    useUi.getState().toast('Cambios descartados', 'info', { label: 'Deshacer', run: () => get().undo() });
  },

  async save() {
    const { storage, model, files, record } = get();
    if (!storage || !record) return;
    if (record.source === 'github') {
      useUi.getState().setRightTab('changes');
      useUi.getState().toast('En un workspace de GitHub los cambios se publican con "Commit & push"');
      return;
    }
    set({ saving: true });
    try {
      const next = await serializeModel(model, { previous: files });
      const plan = planWrite(files, next);
      await applyWritePlan(storage, plan);
      const updated = new Map(files);
      for (const [path, content] of plan.writes) updated.set(path, content);
      for (const path of plan.deletes) updated.delete(path);
      set({ files: updated, base: model, saving: false });
      await persist.clearDraft(record.key);
      const count = plan.writes.size + plan.deletes.length;
      useUi.getState().toast(count ? `Guardado · ${count} ${count === 1 ? 'archivo' : 'archivos'}` : 'Sin cambios para guardar', 'success');
    } catch (error) {
      set({ saving: false });
      useUi.getState().toast(`No se pudo guardar: ${(error as Error).message}`, 'error');
    }
  },

  async refreshRecents() {
    set({ recents: await persist.listWorkspaces() });
  },
}));

function describeOp(op: Op): string {
  switch (op.type) {
    case 'element.add':
      return `Agregar ${op.element.name}`;
    case 'element.update':
      return 'Editar elemento';
    case 'element.remove':
      return 'Eliminar elemento';
    case 'relation.add':
      return 'Conectar';
    case 'relation.update':
      return 'Editar relación';
    case 'relation.remove':
      return 'Eliminar relación';
    case 'view.place':
      return 'Mover';
    case 'view.unplace':
      return 'Quitar del lienzo';
    case 'view.add':
      return `Crear lienzo ${op.view.name}`;
    case 'view.remove':
      return 'Eliminar lienzo';
    case 'batch':
      return op.label ?? 'Cambios';
    default:
      return 'Cambio';
  }
}

// -----------------------------------------------------------------------------------------------
// Ciclo de vida de workspaces

export function defaultViewOf(model: Model): string | null {
  if (model.workspace.defaultView && model.views[model.workspace.defaultView]) return model.workspace.defaultView;
  const views = Object.values(model.views).sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.name.localeCompare(b.name));
  return views[0]?.id ?? null;
}

function withStarterView(model: Model): Model {
  if (Object.keys(model.views).length) return model;
  return applyOp(model, {
    type: 'batch',
    ops: [
      { type: 'view.add', view: { id: 'contexto', name: 'Contexto', level: 1, nodes: {} } },
      { type: 'workspace.update', patch: { defaultView: 'contexto' } },
    ],
  }).model;
}

let stopWatching: (() => void) | null = null;

async function activate(record: WorkspaceRecord, storage: WorkspaceStorage, files: Map<string, string>, git: GitSync | null = null) {
  const { model: base, diagnostics } = await parseFiles(files);
  const draft = await persist.getDraft(record.key);
  const model = draft && diffModels(base, draft).length ? draft : base;
  let synced = record.synced ?? null;
  let syncBase: Model | null = null;
  if (git) {
    try {
      if (git instanceof CliGitSync) {
        synced = (await git.status()).head;
        syncBase = synced ? (await parseFiles(await git.readFiles(synced), { validate: false })).model : emptyModel(base.workspace.id, base.workspace.name);
      } else {
        // La copia local de un workspace de GitHub siempre es el último commit sincronizado.
        syncBase = base;
      }
    } catch (error) {
      useUi.getState().toast(`Git no disponible: ${(error as Error).message}`, 'error');
      git = null;
    }
  }
  const updated: WorkspaceRecord = { ...record, name: base.workspace.name, synced, openedAt: Date.now() };
  await persist.saveWorkspace(updated);
  setLastWorkspaceKey(record.key);
  useWorkspace.setState({
    status: 'ready',
    error: null,
    record: updated,
    storage,
    files,
    base,
    model,
    diagnostics,
    past: [],
    future: [],
    git,
    synced,
    syncBase,
  });
  stopWatching?.();
  stopWatching = null;
  if (storage instanceof TauriStorage) {
    watchFolder(storage.root, () => scheduleExternalReload())
      .then((stop) => (stopWatching = stop))
      .catch(() => undefined);
  }
  useUi.getState().openView(defaultViewOf(model), { transition: 'fade' });
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  if (errors) useUi.getState().toast(`${errors} ${errors === 1 ? 'archivo con errores' : 'problemas al leer el workspace'}: revisá la pestaña Cambios`, 'error');
  void useWorkspace.getState().refreshRecents();
}

export async function openRecord(record: WorkspaceRecord, opts: { requestPermission?: boolean } = {}) {
  useWorkspace.setState({ status: 'loading', error: null });
  try {
    let storage: WorkspaceStorage;
    let git: GitSync | null = null;
    if (record.source === 'browser') {
      storage = new IdbStorage(record.key);
    } else if (record.source === 'desktop') {
      if (!isDesktop() || !record.path) throw new Error('Este workspace se abre desde la app de escritorio');
      storage = new TauriStorage(record.path);
      git = await desktopGit(record.path, storage);
    } else if (record.source === 'dev') {
      if (!import.meta.env.DEV || !record.path) throw new Error('Este workspace se abre con el servidor de desarrollo');
      storage = new DevFolderStorage(record.path);
    } else if (record.source === 'github') {
      const token = await persist.getToken(record.key);
      if (!record.github || !token) throw new Error('Falta el token de GitHub de este workspace: volvé a conectarlo');
      storage = new IdbStorage(record.key);
      git = new GitHubSync({ ...record.github, token });
    } else {
      const handle = await persist.getHandle(record.key);
      if (!handle) throw new Error('No se encontró la carpeta vinculada');
      const granted = await ensureDirectoryPermission(handle, !!opts.requestPermission);
      if (!granted) {
        useWorkspace.setState({ status: 'needs-permission', record });
        return;
      }
      storage = new FolderStorage(handle);
    }
    const files = await readAll(storage);
    if (!isAegonWorkspace(files)) throw new Error('El workspace no tiene aegon.yaml');
    await activate(record, storage, files, git);
  } catch (error) {
    useWorkspace.setState({ status: 'error', error: (error as Error).message, record });
  }
}

export async function createBrowserWorkspace(name: string, model?: Model): Promise<void> {
  const key = newKey();
  const initial = withStarterView(model ?? emptyModel(slugify(name, 'workspace'), name));
  const storage = new IdbStorage(key);
  const files = await serializeModel(initial);
  await storage.replaceAll(files);
  await activate({ key, name: initial.workspace.name, source: 'browser', openedAt: Date.now() }, storage, files);
}

/** Workspace nuevo del navegador, vacío o a partir de un template. */
export async function createWorkspaceFromTemplate(name: string, template: Template | null): Promise<void> {
  await createBrowserWorkspace(name, initialModel(name, template));
}

/** Workspace de ejemplo (template incluido "Banca digital"). */
export async function createDemoWorkspace() {
  const demo = builtinTemplates().find((t) => t.kind === 'workspace');
  if (demo) await createWorkspaceFromTemplate(demo.name, demo);
}

function initialModel(name: string, template: Template | null): Model {
  const id = slugify(name, 'workspace');
  return template ? workspaceFromTemplate(template, { id, name }) : withStarterView(emptyModel(id, name));
}

/** Preguntas al usuario en los flujos de carpetas. Los modales los registra la UI (lib/flows.tsx). */
export const folderPrompts = {
  initFolder: async (_folder: string): Promise<{ template: Template | null } | null> => null,
  confirmReplace: async (_folder: string, _workspaceName: string): Promise<boolean> => false,
};

/** Carpeta sin workspace: pregunta si crear uno (vacío o desde un template). Null si se cancela. */
async function askInitModel(folder: string): Promise<Model | null> {
  const choice = await folderPrompts.initFolder(folder);
  return choice ? initialModel(folder, choice.template) : null;
}

const confirmReplace = (folder: string, workspaceName: string) => folderPrompts.confirmReplace(folder, workspaceName);

/** Workspace sintético de ~5k elementos para probar escala (paleta de comandos). */
export async function createLargeWorkspace() {
  const { largeModel } = await import('../lib/large.ts');
  const t0 = performance.now();
  await createBrowserWorkspace('Escala', largeModel());
  useUi.getState().toast(`Workspace de escala listo en ${Math.round(performance.now() - t0)} ms`, 'success');
}

async function desktopGit(path: string, storage: WorkspaceStorage): Promise<GitSync | null> {
  const git = new CliGitSync(new TauriGitBackend(path), storage);
  return (await git.isRepo()) ? git : null;
}

/** App de escritorio: carpeta del disco, con git si es un repo. */
async function openFolderDesktop(): Promise<void> {
  const path = await pickFolderNative();
  if (path) await openDesktopPath(path);
}

/** Abre (o inicializa) un workspace en una ruta del disco. Solo en la app de escritorio. */
export async function openDesktopPath(path: string): Promise<void> {
  if (!isDesktop()) throw new Error('Abrir por ruta solo está disponible en la app de escritorio');
  const storage = new TauriStorage(path);
  let files = await readAll(storage);
  const name = storage.label;
  if (!isAegonWorkspace(files)) {
    const model = await askInitModel(name);
    if (!model) return;
    await applyWritePlan(storage, planWrite(files, await serializeModel(model, { previous: files })));
    files = await readAll(storage);
  }
  const recents = await persist.listWorkspaces();
  const existing = recents.find((r) => r.source === 'desktop' && r.path === path);
  const record: WorkspaceRecord = existing ?? { key: newKey(), name, source: 'desktop', path, folderName: name, openedAt: Date.now() };
  await activate(record, storage, files, await desktopGit(path, storage));
}

export async function openFolder(): Promise<void> {
  if (isDesktop()) return openFolderDesktop();
  const ui = useUi.getState();
  if (!isFsAccessSupported()) {
    ui.toast('Tu navegador no permite abrir carpetas. Usá Chrome o Edge (o la app de escritorio).', 'error');
    return;
  }
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await pickDirectory();
  } catch {
    return; // cancelado
  }
  const storage = new FolderStorage(handle);
  const files = await readAll(storage);
  if (isAegonWorkspace(files)) {
    const key = newKey();
    await persist.setHandle(key, handle);
    await activate({ key, name: handle.name, source: 'folder', folderName: handle.name, openedAt: Date.now() }, storage, files);
    return;
  }
  const model = await askInitModel(handle.name);
  if (!model) return;
  const next = await serializeModel(model, { previous: files });
  await applyWritePlan(storage, planWrite(files, next));
  const key = newKey();
  await persist.setHandle(key, handle);
  await activate({ key, name: model.workspace.name, source: 'folder', folderName: handle.name, openedAt: Date.now() }, storage, await readAll(storage));
}

/** Pasa el workspace actual del navegador a una carpeta local (escribe lo guardado; el borrador sigue como borrador). */
export async function linkToFolder(): Promise<void> {
  if (isDesktop()) return linkToFolderDesktop();
  const state = useWorkspace.getState();
  const ui = useUi.getState();
  if (!state.record || !isFsAccessSupported()) {
    ui.toast('Tu navegador no permite elegir carpetas. Usá Chrome o Edge.', 'error');
    return;
  }
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await pickDirectory();
  } catch {
    return;
  }
  const storage = new FolderStorage(handle);
  const existing = await readAll(storage);
  if (isAegonWorkspace(existing) && !(await confirmReplace(handle.name, state.base.workspace.name))) return;
  const next = await serializeModel(state.base, { previous: existing });
  await applyWritePlan(storage, planWrite(existing, next));
  await persist.setHandle(state.record.key, handle);
  const record: WorkspaceRecord = { ...state.record, source: 'folder', folderName: handle.name, openedAt: Date.now() };
  await persist.saveWorkspace(record);
  useWorkspace.setState({ record, storage, files: await readAll(storage) });
  ui.toast(`Vinculado a la carpeta "${handle.name}"`, 'success');
  void useWorkspace.getState().refreshRecents();
}

export async function removeWorkspace(record: WorkspaceRecord) {
  if (record.source === 'browser') await new IdbStorage(record.key).destroy();
  await persist.removeWorkspace(record.key);
  await useWorkspace.getState().refreshRecents();
}

// -----------------------------------------------------------------------------------------------
// Autoguardado del borrador (IndexedDB) con debounce.

let draftTimer: ReturnType<typeof setTimeout> | undefined;
useWorkspace.subscribe((state, prev) => {
  if (state.model === prev.model && state.base === prev.base) return;
  const record = state.record;
  if (!record || state.status !== 'ready') return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const { model, base } = useWorkspace.getState();
    if (model === base) void persist.clearDraft(record.key);
    else void persist.setDraft(record.key, model);
  }, 400);
});

// -----------------------------------------------------------------------------------------------
// GitHub (web)

export interface GitHubConnect extends GitHubTarget {}

/** Abre un repo de GitHub que ya tiene un workspace de Aegon (copia local + sync por API). */
export async function openGitHubWorkspace(target: GitHubConnect): Promise<'opened' | 'empty'> {
  const git = new GitHubSync(target);
  const head = (await git.status()).head;
  const files = head ? await git.readFiles(head) : new Map<string, string>();
  if (!isAegonWorkspace(files)) return 'empty';
  const key = newKey();
  const storage = new IdbStorage(key);
  await storage.replaceAll(files);
  await persist.setToken(key, target.token);
  const record: WorkspaceRecord = {
    key,
    name: target.repo,
    source: 'github',
    github: { owner: target.owner, repo: target.repo, branch: target.branch },
    synced: head,
    openedAt: Date.now(),
  };
  await activate(record, storage, files, git);
  useUi.getState().toast(`Abierto desde GitHub: ${git.label}`, 'success');
  return 'opened';
}

/**
 * Vincula el workspace actual a un repo de GitHub y publica su estado (el repo puede estar vacío
 * o tener otros archivos: README, código… que se conservan).
 */
export async function linkGitHub(target: GitHubConnect): Promise<void> {
  const state = useWorkspace.getState();
  if (!state.record) return;
  const git = new GitHubSync(target);
  const prepared = await git.prepare({ base: state.base, synced: null });
  if (!prepared.upToDate && Object.keys(prepared.theirs.elements).length) {
    throw new Error('El repo ya tiene un workspace de Aegon: abrilo con "Abrir desde GitHub"');
  }
  const { head, files } = await git.publish(state.model, `Aegon: ${state.model.workspace.name}`, prepared, prepared.theirsFiles);
  const key = state.record.key;
  const storage = new IdbStorage(key);
  await storage.replaceAll(files);
  await persist.setToken(key, target.token);
  await persist.clearDraft(key);
  const record: WorkspaceRecord = {
    ...state.record,
    source: 'github',
    github: { owner: target.owner, repo: target.repo, branch: target.branch },
    synced: head,
  };
  await activate(record, storage, files, git);
  useUi.getState().toast(`Publicado en GitHub: ${git.label}`, 'success');
}

/** Después de un push o pull: la copia local, la base y el commit sincronizado se actualizan. */
export async function adoptSynced(next: { model: Model; files: Map<string, string>; head: string | null; syncBase: Model; base?: Model }) {
  const state = useWorkspace.getState();
  const { record, storage } = state;
  if (!record || !storage) return;
  if (storage instanceof IdbStorage) await storage.replaceAll(next.files);
  const base = next.base ?? (await parseFiles(next.files, { validate: false })).model;
  const updated: WorkspaceRecord = { ...record, synced: next.head };
  await persist.saveWorkspace(updated);
  useWorkspace.setState({ record: updated, files: next.files, base, model: next.model, syncBase: next.syncBase, synced: next.head });
  if (diffModels(base, next.model).length) await persist.setDraft(record.key, next.model);
  else await persist.clearDraft(record.key);
}

// -----------------------------------------------------------------------------------------------
// Cambios externos en la carpeta (escritorio): editor, agente de IA, git checkout…

let externalTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleExternalReload() {
  clearTimeout(externalTimer);
  externalTimer = setTimeout(() => void reloadFromDisk(), 350);
}

/**
 * Relee la carpeta. Si alguien cambió los archivos, la nueva versión pasa a ser la base y el
 * borrador se combina con ella (merge semántico); en conflicto se conserva la versión del borrador.
 */
export async function reloadFromDisk(): Promise<void> {
  const state = useWorkspace.getState();
  const { storage, files, base, model } = state;
  if (!storage || state.status !== 'ready') return;
  if (state.saving || state.syncing) {
    // Escrituras propias en curso: se vuelve a mirar cuando terminen.
    scheduleExternalReload();
    return;
  }
  const disk = await readAll(storage);
  const same = disk.size === files.size && [...disk].every(([p, c]) => files.get(p)?.replace(/\r\n/g, '\n') === c.replace(/\r\n/g, '\n'));
  if (same) return;
  const parsed = await parseFiles(disk);
  const result = mergeModels(base, model, parsed.model);
  useWorkspace.setState({ files: disk, base: parsed.model, model: result.merged, diagnostics: parsed.diagnostics });
  const ui = useUi.getState();
  if (result.conflicts.length) ui.toast(`Los archivos cambiaron afuera de Aegon: ${result.conflicts.length} conflictos, se conservó tu versión`, 'error');
  else ui.toast('Se actualizaron cambios hechos fuera de Aegon');
  if (state.git instanceof CliGitSync) {
    const head = (await state.git.status()).head;
    if (head !== state.synced) {
      const syncBase = head ? (await parseFiles(await state.git.readFiles(head), { validate: false })).model : null;
      useWorkspace.setState({ synced: head, syncBase });
    }
  }
}

/** Escritorio: escribe el workspace del navegador en una carpeta y lo abre desde ahí (con git si es un repo). */
async function linkToFolderDesktop(): Promise<void> {
  const state = useWorkspace.getState();
  if (!state.record) return;
  const path = await pickFolderNative();
  if (!path) return;
  const storage = new TauriStorage(path);
  const existing = await readAll(storage);
  if (isAegonWorkspace(existing) && !(await confirmReplace(storage.label, state.base.workspace.name))) return;
  await applyWritePlan(storage, planWrite(existing, await serializeModel(state.base, { previous: existing })));
  const record: WorkspaceRecord = { ...state.record, source: 'desktop', path, folderName: storage.label, openedAt: Date.now() };
  // El borrador viaja con el workspace (misma clave).
  await activate(record, storage, await readAll(storage), await desktopGit(path, storage));
  useUi.getState().toast(`Vinculado a ${path}`, 'success');
}

/**
 * Solo desarrollo: abre una carpeta del disco a través del servidor de Vite (`?dev-folder=<ruta>`).
 * La carpeta manda: se descarta el borrador local para ver exactamente lo que hay en disco.
 */
export async function openDevFolder(path: string): Promise<void> {
  useWorkspace.setState({ status: 'loading', error: null });
  const storage = new DevFolderStorage(path);
  const files = await readAll(storage);
  if (!isAegonWorkspace(files)) throw new Error(`${path} no tiene aegon.yaml`);
  const recents = await persist.listWorkspaces();
  const existing = recents.find((r) => r.source === 'dev' && r.path === path);
  const record: WorkspaceRecord = existing ?? { key: newKey(), name: storage.label, source: 'dev', path, folderName: storage.label, openedAt: Date.now() };
  await persist.clearDraft(record.key);
  await activate(record, storage, files);
}
