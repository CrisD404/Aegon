import { create } from 'zustand';
import type { ElementKind, Id, Level } from '@aegon/core';
import { loadPrefs, savePrefs } from '../lib/persist.ts';

export type ThemePref = 'system' | 'light' | 'dark';
export type GridMode = 'dots' | 'lines' | 'none';
export type RightTab = 'inspector' | 'changes';
export type SidebarTab = 'model' | 'groups' | 'views';
export type Transition = 'in' | 'out' | 'fade' | null;

interface Prefs {
  theme: ThemePref;
  grid: GridMode;
  snap: boolean;
  rulers: boolean;
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
  sidebarOpen: true,
  rightOpen: true,
  sidebarTab: 'model',
};

const prefs = loadPrefs(PREF_DEFAULTS);
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

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
    savePrefs({
      theme: s.theme,
      grid: s.grid,
      snap: s.snap,
      rulers: s.rulers,
      sidebarOpen: s.sidebarOpen,
      rightOpen: s.rightOpen,
      sidebarTab: s.sidebarTab,
    } satisfies Prefs);
  },

  openView(id, opts = {}) {
    if (id === get().activeViewId && !opts.focus) return;
    set({
      activeViewId: id,
      transition: opts.transition ?? 'fade',
      focusId: opts.focus ?? null,
      selection: { nodes: opts.focus ? [opts.focus] : [], edges: [] },
      ghost: null,
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
    const next = current.includes(level) ? current.filter((l) => l !== level) : [...current, level].sort();
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
