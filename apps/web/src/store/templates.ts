import { create } from 'zustand';
import { builtinTemplates, type Template } from '@aegon/core';
import { persist } from '../lib/persist.ts';

/** Templates incluidos + biblioteca del usuario (IndexedDB). */
interface TemplatesState {
  user: Template[];
  loaded: boolean;
  load(): Promise<void>;
  add(template: Template): Promise<void>;
  update(id: string, patch: Pick<Template, 'name' | 'description'>): Promise<void>;
  remove(id: string): Promise<void>;
}

export const useTemplates = create<TemplatesState>((set, get) => ({
  user: [],
  loaded: false,

  async load() {
    set({ user: await persist.listTemplates(), loaded: true });
  },

  async add(template) {
    const user = [{ ...template, createdAt: Date.now() }, ...get().user.filter((t) => t.id !== template.id)];
    set({ user });
    await persist.saveTemplates(user);
  },

  async update(id, patch) {
    const user = get().user.map((t) => (t.id === id ? { ...t, ...patch, model: { ...t.model, workspace: { ...t.model.workspace, name: patch.name } } } : t));
    set({ user });
    await persist.saveTemplates(user);
  },

  async remove(id) {
    const user = get().user.filter((t) => t.id !== id);
    set({ user });
    await persist.saveTemplates(user);
  },
}));

export function allTemplates(user: readonly Template[]): Template[] {
  return [...builtinTemplates(), ...user];
}

export function newTemplateId(): string {
  return `user:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
