import { useEffect } from 'react';
import { childLevelOf } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { canvasApi } from '../canvas/api.ts';
import {
  activeView,
  arrange,
  copySelection,
  deleteSelectionFromModel,
  drillInto,
  duplicateSelection,
  goUp,
  paste,
  removeSelectionFromView,
} from './actions.ts';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** Atajos globales de teclado. Los que editan se ignoran mientras se escribe en un campo. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      // En modo presentación el reproductor maneja el teclado.
      if (ui.player) return;
      const ws = useWorkspace.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const typing = isTyping(e.target);

      if (mod && key === 'k') {
        e.preventDefault();
        ui.setPalette(!ui.paletteOpen);
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        void ws.save();
        return;
      }
      if (mod && key === 'b') {
        e.preventDefault();
        ui.setPref('sidebarOpen', !ui.sidebarOpen);
        return;
      }
      if (mod && key === 'i') {
        e.preventDefault();
        ui.setPref('rightOpen', !ui.rightOpen);
        return;
      }
      if (mod && key === 'f' && ui.activeViewId) {
        e.preventDefault();
        ui.setSearch({ open: true });
        // Si ya estaba abierta, vuelve a enfocar el campo.
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-testid="canvas-search-input"]')?.select());
        return;
      }
      if (typing || ui.paletteOpen || ui.ghost) return;

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) ws.redo();
        else ws.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        ws.redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && key === 'c') {
        copySelection();
        return;
      }
      if (mod && key === 'v') {
        paste();
        return;
      }
      if (mod && key === 'a') {
        const view = activeView();
        if (view) {
          e.preventDefault();
          ui.select(Object.keys(view.nodes));
        }
        return;
      }
      if (mod) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (e.shiftKey) deleteSelectionFromModel();
        else removeSelectionFromView();
        return;
      }
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        goUp();
        return;
      }
      if (e.key === 'Escape') {
        ui.select([]);
        return;
      }
      if (e.key === 'Enter' && ui.selection.nodes.length === 1) {
        const id = ui.selection.nodes[0]!;
        const el = ws.model.elements[id];
        if (el && childLevelOf(el.kind)) {
          e.preventDefault();
          void canvasApi.zoomToNode(id).then(() => drillInto(id));
        }
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        ui.requestRename();
        return;
      }
      if (e.shiftKey && key === 'l') {
        e.preventDefault();
        void arrange();
        return;
      }
      if (e.shiftKey && key === 'f') {
        e.preventDefault();
        ui.setPref('focusMode', !ui.focusMode);
        return;
      }
      if (e.key === '$') {
        ui.setPref('costOverlay', !ui.costOverlay);
        return;
      }
      if (e.shiftKey || e.altKey) return;
      if (key === 'f') canvasApi.fit();
      else if (key === 'g') ui.setPref('grid', ui.grid === 'dots' ? 'lines' : ui.grid === 'lines' ? 'none' : 'dots');
      else if (key === 'r') ui.setPref('rulers', !ui.rulers);
      else if (key === 'm') ui.setPref('minimap', !ui.minimap);
      else if (key === 'c') {
        ui.setPref('showComments', true);
        ui.setCommentMode(!ui.commentMode);
      } else if (e.key === '$') ui.setPref('costOverlay', !ui.costOverlay);
      else if (key === 'n') canvasApi.ghostAtCenter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
