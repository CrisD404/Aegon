import { createContext, useContext } from 'react';

/** Nivel de detalle según el zoom: en "far" los nodos y relaciones renderizan un DOM mínimo. */
export type Lod = 'near' | 'mid' | 'far';

export function lodFor(zoom: number): Lod {
  if (zoom < 0.4) return 'far';
  if (zoom < 0.62) return 'mid';
  return 'near';
}

/**
 * El lienzo publica el nivel por contexto: los nodos y relaciones solo se re-renderizan cuando
 * cambia el nivel, sin una suscripción al viewport por cada uno (con miles, cada frame de zoom
 * evaluaba miles de selectores).
 */
export const LodContext = createContext<Lod>('near');

export function useLod(): Lod {
  return useContext(LodContext);
}
