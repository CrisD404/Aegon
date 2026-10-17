import type { Id } from '../schema/index.ts';

const MAX_SLUG = 48;

/** `"Pasarela de Pagos (v2)"` → `"pasarela-de-pagos-v2"`. */
export function slugify(text: string, fallback = 'item'): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** Devuelve `base`, o `base-2`, `base-3`… hasta encontrar uno libre. */
export function uniqueId(base: string, isTaken: (id: Id) => boolean): Id {
  if (!isTaken(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!isTaken(candidate)) return candidate;
  }
}

export function idFromName(
  name: string,
  isTaken: (id: Id) => boolean,
  fallback = 'item',
): Id {
  return uniqueId(slugify(name, fallback), isTaken);
}

export function relationIdFor(from: Id, to: Id, isTaken: (id: Id) => boolean): Id {
  return uniqueId(`${from}--${to}`, isTaken);
}
