/**
 * `html-to-image` clona cada `<svg>` entero de una vez y solo le copia los estilos calculados a la
 * raíz: los elementos internos (trazos de las relaciones, flechas, muestras de la leyenda) pierden
 * lo que les da el CSS por clase y salen rellenos de negro o sin trazo. Antes de capturar, esos
 * estilos se pasan a atributos de presentación; después se restauran.
 */

const PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
] as const;

export async function withInlinedSvgStyles<T>(root: Element, task: () => Promise<T>): Promise<T> {
  const restore: (() => void)[] = [];
  for (const el of root.querySelectorAll('svg *')) {
    if (el.closest('defs') && !el.closest('marker')) continue;
    const computed = getComputedStyle(el);
    for (const prop of PROPERTIES) {
      const value = computed.getPropertyValue(prop);
      if (!value) continue;
      const previous = el.getAttribute(prop);
      el.setAttribute(prop, value);
      restore.push(() => (previous === null ? el.removeAttribute(prop) : el.setAttribute(prop, previous)));
    }
  }
  try {
    return await task();
  } finally {
    for (const undo of restore.reverse()) undo();
  }
}
