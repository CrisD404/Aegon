import { create } from 'zustand';
import type { ElementKind, Id, Level } from '@aegon/core';
import { loadPrefs, savePrefs } from '../lib/persist.ts';

export type ThemePref = 'system' | 'light' | 'dark';
export type GridMode = 'dots' | 'lines' | 'none';
export type RightTab = 'inspector' | 'changes' | 'costs' | 'comments';
export type SidebarTab = 'model' | 'groups' | 'views' | 'flows';

/** Ubicación de un paso: `[i]` en el flujo o `[i, camino, j]` dentro de una bifurcación. */
export type StepPath = [number] | [number, number, number];

/** Elegir en el lienzo los elementos de un paso (origen y destino, o el elemento de un proceso). */
export interface StepPick {
  flow: Id;
  /** Dónde va el paso: reemplaza el de `path` o se agrega al final (`append`) de la lista. */
  path: StepPath | null;
  append?: { top?: number; path?: number };
  kind: 'message' | 'process';
  from?: Id;
}

/** Estado del reproductor de flujos (modo presentación). */
export interface PlayerState {
  flow: Id;
  /** -1 = portada; `frames.length` = cierre. */
  index: number;
  /** Camino elegido en cada bifurcación alternativa (por índice de paso de primer nivel). */
  choices: Record<number, number>;
  autoplay: boolean;
  /** Flujos desde los que se saltó con "ir a otro flujo" (para volver). */
  stack: { flow: Id; index: number; choices: Record<number, number> }[];
  /** Lienzo activo antes de reproducir (se vuelve al salir). */
  returnView: Id | null;
}
export type Transition = 'in' | 'out' | 'fade' | null;

interface Prefs {
  theme: ThemePref;
  grid: GridMode;
  snap: boolean;
  rulers: boolean;
  /** Minimapa del lienzo (abajo a la derecha). */
  minimap: boolean;
  /** Modo foco: con algo seleccionado, se atenúa lo que no es dependencia directa. */
  focusMode: boolean;
  /** Capa de costos en el lienzo (badges y calor). */
  costOverlay: boolean;
  /** Comentarios visibles en el lienzo. */
  showComments: boolean;
  /** Nombre con el que se firman los comentarios (en este equipo). */
  commentAuthor: string;
  /** Ambiente elegido para costos (null = todos). */
  costEnv: string | null;
  sidebarOpen: boolean;
  rightOpen: boolean;
  sidebarTab: SidebarTab;
}

export interface GhostState {
  /** Posición en pantalla (relativa al lienzo) y en coordenadas del flujo. */
  screen: { x: number; y: number };
  flow: { x: number; y: number };
  /** Si viene de soltar una conexión en el vacío: conectar el nuevo elemento a este. */
  connectFrom?: Id;
  /** Tipo sugerido (botones "agregar" de la toolbar). */
  kind?: ElementKind;
}

export interface Toast {
  id: number;
  tone: 'info' | 'error' | 'success';
  text: string;
  action?: { label: string; run: () => void };
}

interface UiState extends Prefs {
  resolvedTheme: 'light' | 'dark';
  activeViewId: Id | null;
  transition: Transition;
  /** Elemento a centrar/seleccionar al abrir el lienzo. */
  focusId: Id | null;
  selection: { nodes: Id[]; edges: Id[] };
  rightTab: RightTab;
  levelFilter: Level[];
  paletteOpen: boolean;
  ghost: GhostState | null;
  /** IDs recién creados (animación de entrada). */
  fresh: ReadonlySet<Id>;
  toasts: Toast[];
  renameRequest: number;
  /** Flujo abierto en el editor y paso seleccionado. */
  flowEdit: { id: Id; step: StepPath | null } | null;
  setFlowEdit(edit: { id: Id; step: StepPath | null } | null): void;
  stepPick: StepPick | null;
  setStepPick(pick: StepPick | null): void;
  player: PlayerState | null;
  setPlayer(player: PlayerState | null): void;
  /** Modo "comentar": el próximo click en el lienzo crea un comentario ahí. */
  commentMode: boolean;
  setCommentMode(on: boolean): void;
  /** Comentario abierto (tarjeta expandida). */
  openComment: Id | null;
  setOpenComment(id: Id | null): void;
  /** Búsqueda en el lienzo activo (Ctrl+F). */
  search: { open: boolean; query: string; index: number };
  setSearch(patch: Partial<UiState['search']>): void;
  /** Diálogo de GitHub abierto: vincular el workspace actual o abrir uno del repo. */
  githubDialog: 'link' | 'open' | null;
  setGitHubDialog(mode: 'link' | 'open' | null): void;

  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
  openView(id: Id | null, opts?: { transition?: Transition; focus?: Id | null }): void;
  setSelection(selection: { nodes: Id[]; edges: Id[] }): void;
  select(nodes: Id[], edges?: Id[]): void;
  setRightTab(tab: RightTab): void;
  toggleLevel(level: Level): void;
  setPalette(open: boolean): void;
  setGhost(ghost: GhostState | null): void;
  markFresh(ids: Id[]): void;
  toast(text: string, tone?: Toast['tone'], action?: Toast['action']): void;
  dismissToast(id: number): void;
  requestRename(): void;
}

const PREF_DEFAULTS: Prefs = {
  theme: 'system',
  grid: 'dots',
  snap: true,
  rulers: true,
  minimap: false,
  // Foco en la selección por defecto (atenúa suave lo no relacionado); se apaga en Vista o con ⇧F.
  focusMode: true,
  costOverlay: false,
  costEnv: null,
  showComments: true,
  commentAuthor: '',
  sidebarOpen: true,
  rightOpen: true,
  sidebarTab: 'model',
};

const prefs = migratePrefs(loadPrefs(PREF_DEFAULTS));

/**
 * Cambios de default que también aplican a quien ya tenía preferencias guardadas (versión 2: el
 * foco en la selección pasa a estar activado).
 */
function migratePrefs(p: Prefs): Prefs {
  try {
    if (localStorage.getItem('aegon.prefs.version') === '2') return p;
    localStorage.setItem('aegon.prefs.version', '2');
    return { ...p, focusMode: true };
  } catch {
    return p;
  }
}
const media =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolveTheme(theme: ThemePref): 'light' | 'dark' {
  if (theme === 'system') return media?.matches ? 'dark' : 'light';
  return theme;
}

function applyTheme(theme: 'light' | 'dark') {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
}

let toastSeq = 0;
let freshTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiState>((set, get) => ({
  ...prefs,
  resolvedTheme: resolveTheme(prefs.theme),
  activeViewId: null,
  transition: null,
  focusId: null,
  selection: { nodes: [], edges: [] },
  rightTab: 'inspector',
  levelFilter: [1, 2, 3],
  paletteOpen: false,
  ghost: null,
  fresh: new Set(),
  toasts: [],
  renameRequest: 0,
  githubDialog: null,
  flowEdit: null,
  setFlowEdit(edit) {
    set({ flowEdit: edit });
  },
  stepPick: null,
  setStepPick(pick) {
    set({ stepPick: pick, ghost: null });
  },
  player: null,
  setPlayer(player) {
    set({ player });
  },
  commentMode: false,
  setCommentMode(on) {
    set({ commentMode: on, ghost: null, stepPick: null });
  },
  openComment: null,
  setOpenComment(id) {
    set({ openComment: id });
  },
  search: { open: false, query: '', index: 0 },
  setSearch(patch) {
    set({ search: { ...get().search, ...patch } });
  },
  setGitHubDialog(mode) {
    set({ githubDialog: mode });
  },

  setPref(key, value) {
    set({ [key]: value } as Partial<UiState>);
    if (key === 'theme') {
      const resolved = resolveTheme(value as ThemePref);
      applyTheme(resolved);
      set({ resolvedTheme: resolved });
    }
    const s = get();
    savePrefs(
      Object.fromEntries(
        Object.keys(PREF_DEFAULTS).map((k) => [k, s[k as keyof Prefs]]),
      ) as unknown as Prefs,
    );
  },

  openView(id, opts = {}) {
    if (id === get().activeViewId && !opts.focus) return;
    set({
      activeViewId: id,
      transition: opts.transition ?? 'fade',
      focusId: opts.focus ?? null,
      selection: { nodes: opts.focus ? [opts.focus] : [], edges: [] },
      ghost: null,
      search: { ...get().search, index: 0 },
    });
  },

  setSelection(selection) {
    const prev = get().selection;
    if (sameIds(prev.nodes, selection.nodes) && sameIds(prev.edges, selection.edges)) return;
    set({ selection });
  },

  select(nodes, edges = []) {
    set({ selection: { nodes, edges } });
  },

  setRightTab(tab) {
    set({ rightTab: tab, rightOpen: true });
  },

  toggleLevel(level) {
    const current = get().levelFilter;
    const next = current.includes(level)
      ? current.filter((l) => l !== level)
      : [...current, level].sort();
    set({ levelFilter: next.length ? next : [1, 2, 3] });
  },

  setPalette(open) {
    set({ paletteOpen: open });
  },

  setGhost(ghost) {
    set({ ghost });
  },

  markFresh(ids) {
    set({ fresh: new Set([...get().fresh, ...ids]) });
    clearTimeout(freshTimer);
    freshTimer = setTimeout(() => set({ fresh: new Set() }), 700);
  },

  toast(text, tone = 'info', action) {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-3), { id, text, tone, action }] });
    setTimeout(() => get().dismissToast(id), action ? 6000 : 3800);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  requestRename() {
    set({ renameRequest: get().renameRequest + 1, rightOpen: true, rightTab: 'inspector' });
  },
}));

function sameIds(a: readonly Id[], b: readonly Id[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

media?.addEventListener('change', () => {
  const { theme } = useUi.getState();
  if (theme !== 'system') return;
  const resolved = resolveTheme('system');
  applyTheme(resolved);
  useUi.setState({ resolvedTheme: resolved });
});

applyTheme(resolveTheme(prefs.theme));
