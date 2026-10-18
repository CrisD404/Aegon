import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { Tone } from '../ui/Modal.tsx';

/**
 * Diálogos imperativos: `await confirmDialog(...)` o `await promptDialog(...)` desde cualquier
 * flujo (abrir carpeta, descartar, etc.) en lugar de window.confirm/prompt. Los diálogos con
 * forma propia usan `showDialog`, que recibe un render con la función para cerrarlo.
 */

export interface OpenDialog {
  id: number;
  render: (close: (value: unknown) => void) => ReactNode;
  /** Cierra el diálogo y resuelve la promesa con ese valor. */
  close: (value: unknown) => void;
  /** Valor con el que se resuelve si se cierra sin elegir (Esc, click afuera). */
  cancelValue: unknown;
}

interface DialogState {
  stack: OpenDialog[];
}

export const useDialogs = create<DialogState>(() => ({ stack: [] }));

let seq = 0;

export function showDialog<T>(render: (close: (value: T) => void) => ReactNode, cancelValue: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = ++seq;
    const close = (value: unknown) => {
      useDialogs.setState((s) => ({ stack: s.stack.filter((d) => d.id !== id) }));
      resolve(value as T);
    };
    useDialogs.setState((s) => ({
      stack: [...s.stack, { id, render: render as OpenDialog['render'], close, cancelValue }],
    }));
  });
}

export interface ConfirmSpec {
  title: string;
  description?: ReactNode;
  /** Detalle opcional (lista de consecuencias, archivos, etc.). */
  details?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: Tone;
  icon?: ReactNode;
}

export interface PromptSpec {
  title: string;
  description?: ReactNode;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel: string;
  icon?: ReactNode;
  /** Mensaje de error o null si el valor es válido. */
  validate?: (value: string) => string | null;
  mono?: boolean;
  hint?: ReactNode;
}

// Los componentes concretos viven en panels/Dialogs.tsx; acá solo se registran para evitar ciclos.
type Renderer<S> = (spec: S, close: (value: never) => void) => ReactNode;
const renderers: { confirm?: Renderer<ConfirmSpec>; prompt?: Renderer<PromptSpec> } = {};

export function registerDialogRenderers(r: { confirm: Renderer<ConfirmSpec>; prompt: Renderer<PromptSpec> }) {
  renderers.confirm = r.confirm;
  renderers.prompt = r.prompt;
}

export function confirmDialog(spec: ConfirmSpec): Promise<boolean> {
  return showDialog<boolean>((close) => renderers.confirm!(spec, close as (v: never) => void), false);
}

export function promptDialog(spec: PromptSpec): Promise<string | null> {
  return showDialog<string | null>((close) => renderers.prompt!(spec, close as (v: never) => void), null);
}
