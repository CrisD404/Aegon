import { MessageSquarePlus, Plus, Search, Wand2 } from 'lucide-react';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { arrange } from '../lib/actions.ts';
import { IconButton, Tip } from '../ui/primitives.tsx';
import { canvasApi } from './api.ts';

/**
 * Deck flotante inferior: solo lo que se usa para construir el diagrama. Agregar abre el mismo
 * fantasma que el doble click (ahí se elige el tipo o se reutiliza un elemento del modelo). Cómo
 * se ve el lienzo (grilla, reglas, capas) y la navegación viven en `CanvasNav`.
 */
export function CanvasDock() {
  const viewId = useUi((s) => s.activeViewId);
  const hasView = useWorkspace((s) => !!(viewId && s.model.views[viewId]));
  const searchOpen = useUi((s) => s.search.open);
  const commentMode = useUi((s) => s.commentMode);
  const setPref = useUi((s) => s.setPref);
  if (!hasView) return null;

  return (
    <div
      className="canvas-dock animate-pop absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-line bg-panel p-1 shadow-pop"
      data-testid="dock"
    >
      <Tip label="Agregar un elemento nuevo o uno que ya está en el modelo" shortcut="N" side="top">
        <button
          type="button"
          onClick={() => canvasApi.ghostAtCenter()}
          className="flex h-8 items-center gap-1.5 rounded-sm bg-accent pr-2 pl-2.5 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
          data-testid="dock-add"
        >
          <Plus size={15} strokeWidth={2.25} />
          Agregar
          <span className="ml-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-xs bg-white/15 px-1 font-mono text-[10.5px]">N</span>
        </button>
      </Tip>
      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton label="Ordenar automáticamente" shortcut="⇧L" onClick={arrange}>
        <Wand2 size={16} />
      </IconButton>
      <IconButton
        label="Buscar en el lienzo"
        shortcut="Ctrl F"
        onClick={() => useUi.getState().setSearch({ open: !searchOpen })}
        active={searchOpen}
        data-testid="dock-search"
      >
        <Search size={16} />
      </IconButton>
      <IconButton
        label="Comentar en el lienzo"
        shortcut="C"
        onClick={() => {
          setPref('showComments', true);
          useUi.getState().setCommentMode(!commentMode);
        }}
        active={commentMode}
        data-testid="dock-comment"
      >
        <MessageSquarePlus size={16} />
      </IconButton>
    </div>
  );
}
