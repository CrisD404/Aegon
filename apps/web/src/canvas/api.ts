import type { ElementKind, Id, NodeLayout } from '@aegon/core';

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
  /** Centro visible del lienzo en coordenadas del flujo (donde se insertan bloques). */
  viewportCenter: (): { x: number; y: number } => ({ x: 0, y: 0 }),
  /** Anima los nodos hasta esas posiciones (absolutas, como en el modelo) antes de aplicarlas. */
  animateTo: async (_nodes: Record<Id, NodeLayout>): Promise<void> => {},
  /**
   * Encuadra esos nodos dentro del área libre del lienzo (descontando `insets` en px: paneles o
   * tarjetas que tapan una parte), con animación.
   */
  focusArea: (
    _ids: Id[],
    _opts: { insets?: { top?: number; right?: number; bottom?: number; left?: number }; padding?: number; maxZoom?: number; duration?: number },
  ): void => {},
  /** Centra la vista en un punto del lienzo (acercando hasta un zoom legible). */
  centerOnPoint: (_x: number, _y: number): void => {},
  /** Pantalla → coordenadas del lienzo. */
  screenToFlow: (x: number, y: number): { x: number; y: number } => ({ x, y }),
  /** Centra la vista en un nodo (acercando hasta un zoom legible si hace falta). */
  centerOn: (_id: Id): void => {},
  /** Mueve la vista (sin cambiar el zoom) para que esos nodos se vean enteros. */
  reveal: (_ids: Id[]): void => {},
  zoomIn: (): void => {},
  /** Zoom al 100 % sobre el centro de lo que se ve. */
  zoomReset: (): void => {},
  zoomOut: (): void => {},
  /** Abre el componente fantasma en el centro visible del lienzo. */
  ghostAtCenter: (_kind?: ElementKind): void => {},
};

