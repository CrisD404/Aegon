import { create } from 'zustand';
import { applyResolutions, commitMessage, diffModels, mergeModels, type MergeResult, type Model, type Resolution } from '@aegon/core';
import { RemoteMovedError, type Prepared, type RepoStatus } from '@aegon/git';
import { useUi } from './ui.ts';
import { adoptSynced, useWorkspace } from './workspace.ts';

/** Merge con conflictos esperando la decisión del usuario. */
export interface PendingMerge {
  mode: 'push' | 'pull';
  result: MergeResult;
  ours: Model;
  theirs: Model;
  prepared: Prepared;
  message: string;
}

interface SyncState {
  status: RepoStatus | null;
  busy: 'status' | 'push' | 'pull' | null;
  error: string | null;
  pending: PendingMerge | null;
  refresh(): Promise<void>;
  push(message?: string): Promise<void>;
  pull(): Promise<void>;
  resolve(choices: Record<string, Resolution>): Promise<void>;
  cancel(): void;
}

const ui = () => useUi.getState();
const ws = () => useWorkspace.getState();

function short(sha: string | null | undefined) {
  return sha ? sha.slice(0, 7) : '—';
}

export const useSync = create<SyncState>((set, get) => ({
  status: null,
  busy: null,
  error: null,
  pending: null,

  async refresh() {
    const git = ws().git;
    if (!git) return set({ status: null, error: null });
    set({ busy: get().busy ?? 'status' });
    try {
      set({ status: await git.status(), error: null });
    } catch (error) {
      set({ error: (error as Error).message });
    } finally {
      if (get().busy === 'status') set({ busy: null });
    }
  },

  async push(message) {
    const { git, model, base, syncBase, synced, files } = ws();
    if (!git || get().busy) return;
    const msg = message?.trim() || commitMessage(diffModels(syncBase ?? base, model));
    set({ busy: 'push', error: null });
    useWorkspace.setState({ syncing: true });
    try {
      for (let attempt = 0; ; attempt++) {
        const prepared = await git.prepare({ base: syncBase ?? base, synced, files });
        let final = ws().model;
        if (!prepared.upToDate) {
          const result = mergeModels(prepared.base, final, prepared.theirs);
          if (result.conflicts.length) {
            set({ pending: { mode: 'push', result, ours: final, theirs: prepared.theirs, prepared, message: msg }, busy: null });
            ui().setRightTab('changes');
            return;
          }
          final = result.merged;
        }
        try {
          await publish(final, msg, prepared);
          break;
        } catch (error) {
          if (error instanceof RemoteMovedError && attempt < 2) continue;
          throw error;
        }
      }
    } catch (error) {
      set({ error: (error as Error).message });
      ui().toast(`No se pudo publicar: ${(error as Error).message}`, 'error');
    } finally {
      if (get().busy === 'push') set({ busy: null });
      useWorkspace.setState({ syncing: false });
      void get().refresh();
    }
  },

  async pull() {
    const { git, model, base, syncBase, synced, files } = ws();
    if (!git || get().busy) return;
    set({ busy: 'pull', error: null });
    useWorkspace.setState({ syncing: true });
    try {
      const prepared = await git.prepare({ base: syncBase ?? base, synced, files });
      if (prepared.upToDate) {
        ui().toast('Ya estás al día con el remoto');
        return;
      }
      const result = mergeModels(syncBase ?? base, model, prepared.theirs);
      if (result.conflicts.length) {
        set({ pending: { mode: 'pull', result, ours: model, theirs: prepared.theirs, prepared, message: '' }, busy: null });
        ui().setRightTab('changes');
        return;
      }
      await adopt(result.merged, prepared, result.repairs);
    } catch (error) {
      set({ error: (error as Error).message });
      ui().toast(`No se pudo actualizar: ${(error as Error).message}`, 'error');
    } finally {
      if (get().busy === 'pull') set({ busy: null });
      useWorkspace.setState({ syncing: false });
      void get().refresh();
    }
  },

  async resolve(choices) {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null, busy: pending.mode });
    useWorkspace.setState({ syncing: true });
    const { model, repairs } = applyResolutions(pending.result, pending.ours, pending.theirs, choices);
    try {
      if (pending.mode === 'pull') await adopt(model, pending.prepared, repairs);
      else await publish(model, pending.message, pending.prepared);
    } catch (error) {
      set({ error: (error as Error).message });
      ui().toast(`No se pudo completar: ${(error as Error).message}`, 'error');
    } finally {
      set({ busy: null });
      useWorkspace.setState({ syncing: false });
      void get().refresh();
    }
  },

  cancel() {
    set({ pending: null });
  },
}));

async function publish(final: Model, message: string, prepared: Prepared) {
  const state = ws();
  const { head, files } = await state.git!.publish(final, message, prepared, state.files);
  await adoptSynced({ model: final, files, head, syncBase: final, base: final });
  ui().toast(`Publicado · ${short(head)}`, 'success');
}

async function adopt(merged: Model, prepared: Prepared, repairs: string[]) {
  const { head, files } = await ws().git!.adopt(prepared);
  await adoptSynced({ model: merged, files, head, syncBase: prepared.theirs });
  const changes = diffModels(prepared.base, prepared.theirs).length;
  ui().toast(`Actualizado a ${short(head)} · ${changes} ${changes === 1 ? 'cambio remoto' : 'cambios remotos'}${repairs.length ? ` · ${repairs.length} ajustes` : ''}`, 'success');
}

// Estado de git al cambiar de workspace.
useWorkspace.subscribe((state, prev) => {
  if (state.git !== prev.git) {
    useSync.setState({ status: null, error: null, pending: null });
    void useSync.getState().refresh();
  }
});
