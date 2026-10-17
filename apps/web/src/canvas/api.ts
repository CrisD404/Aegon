import type { ElementKind, Id } from '@aegon/core';

/** Tipo MIME para arrastrar elementos del explorador al lienzo. */
export const DRAG_MIME = 'application/x-aegon-element';

/**
 * Puente entre el lienzo (que tiene la instancia de ReactFlow) y el resto de la app
 * (paleta, menús, atajos). El lienzo registra las implementaciones al montarse.
 */
export const canvasApi = {
  /** Zoom animado hacia un nodo (antes de bajar de nivel). */
  zoomToNode: async (_id: Id): Promise<void> => {},
  fit: (): void => {},
  zoomIn: (): void => {},
  zoomOut: (): void => {},
  /** Abre el componente fantasma en el centro visible del lienzo. */
  ghostAtCenter: (_kind?: ElementKind): void => {},
};
