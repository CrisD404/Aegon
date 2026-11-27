/**
 * Tamaño mínimo al que se puede achicar cada tipo de nodo del lienzo. Lo usan los tiradores de cada
 * nodo y las guías al redimensionar (que nunca acomodan un borde por debajo de esto).
 */
export const MIN_NODE_SIZE = {
  element: { w: 160, h: 60 },
  group: { w: 200, h: 120 },
  deployment: { w: 240, h: 140 },
} as const;

export function minNodeSize(type: string | undefined): { w: number; h: number } {
  return type && type in MIN_NODE_SIZE ? MIN_NODE_SIZE[type as keyof typeof MIN_NODE_SIZE] : { w: 1, h: 1 };
}
