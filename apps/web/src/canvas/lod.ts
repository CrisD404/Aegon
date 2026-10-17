import { useStore } from '@xyflow/react';

/** Nivel de detalle según el zoom: en "far" los nodos y relaciones renderizan un DOM mínimo. */
export type Lod = 'near' | 'mid' | 'far';

export function lodFor(zoom: number): Lod {
  if (zoom < 0.4) return 'far';
  if (zoom < 0.62) return 'mid';
  return 'near';
}

/** Solo re-renderiza el componente cuando cambia el nivel (no en cada frame de zoom). */
export function useLod(): Lod {
  return useStore((s) => lodFor(s.transform[2]));
}
