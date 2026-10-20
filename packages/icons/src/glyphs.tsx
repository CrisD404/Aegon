import type { ReactNode, SVGProps } from 'react';

/**
 * Glifos propios de Aegon: grilla de 24 px, trazo 1.5, extremos redondeados, `currentColor`.
 * Mismo lenguaje visual que lucide para que convivan con la iconografía de la UI.
 */
const GLYPHS = {
  actor: (
    <>
      <circle cx="12" cy="7.75" r="3.75" />
      <path d="M4.75 20.25c0-4 3.25-7 7.25-7s7.25 3 7.25 7" />
    </>
  ),
  system: (
    <>
      <rect x="3.75" y="4.25" width="16.5" height="15.5" rx="3.5" />
      <path d="M3.75 9.25h16.5" />
      <path d="M7 6.75h.01M9.5 6.75h.01" />
    </>
  ),
  container: (
    <>
      <path d="M12 3.5l7.75 4.25v8.5L12 20.5l-7.75-4.25v-8.5z" />
      <path d="M4.25 7.75L12 12l7.75-4.25M12 12v8.5" />
    </>
  ),
  component: (
    <>
      <rect x="7" y="4" width="13.25" height="16" rx="2.5" />
      <rect x="3.75" y="7.5" width="6" height="3.25" rx="1.2" />
      <rect x="3.75" y="13.25" width="6" height="3.25" rx="1.2" />
    </>
  ),
  store: (
    <>
      <ellipse cx="12" cy="6" rx="7.25" ry="2.75" />
      <path d="M4.75 6v12c0 1.5 3.25 2.75 7.25 2.75s7.25-1.25 7.25-2.75V6" />
      <path d="M4.75 12c0 1.5 3.25 2.75 7.25 2.75s7.25-1.25 7.25-2.75" />
    </>
  ),
  bus: (
    <>
      <rect x="2.75" y="7.25" width="18.5" height="9.5" rx="4.75" />
      <path d="M7.5 10l2 2-2 2M12.5 10l2 2-2 2" />
    </>
  ),
  group: <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="3.5" strokeDasharray="3.2 2.6" />,
  queue: (
    <>
      <rect x="2.75" y="7.75" width="18.5" height="8.5" rx="4.25" />
      <path d="M8.75 7.75v8.5M14.75 7.75v8.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="3.75" ry="8.5" />
      <path d="M3.5 12h17" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3.5v4M15 3.5v4" />
      <path d="M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0z" />
      <path d="M12 16v4.5" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.25" ry="2.75" />
      <path d="M4.75 6v12c0 1.5 3.25 2.75 7.25 2.75s7.25-1.25 7.25-2.75V6" />
    </>
  ),
  file: (
    <>
      <path d="M7 3.5h7l4.25 4.25V20.5H7z" />
      <path d="M14 3.5v4.25h4.25" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.75" width="17" height="12.5" rx="2.5" />
      <path d="M4.25 7.25L12 13l7.75-5.75" />
    </>
  ),
  server: (
    <>
      <rect x="4" y="4" width="16" height="7" rx="2" />
      <rect x="4" y="13" width="16" height="7" rx="2" />
      <path d="M7.5 7.5h.01M7.5 16.5h.01" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="5.5" r="2.25" />
      <circle cx="5.25" cy="18.5" r="2.25" />
      <circle cx="18.75" cy="18.5" r="2.25" />
      <path d="M11 7.5l-4.75 9M13 7.5l4.75 9M7.5 18.5h9" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.75l8.5 4.5-8.5 4.5-8.5-4.5z" />
      <path d="M3.5 12.25l8.5 4.5 8.5-4.5" />
      <path d="M3.5 16.25l8.5 4.5 8.5-4.5" />
    </>
  ),
  cloud: <path d="M7.25 18.75h10a4.25 4.25 0 0 0 .5-8.47A5.75 5.75 0 0 0 6.6 9.9a4.43 4.43 0 0 0 .65 8.85z" />,
  // Despliegue: nodo (caja que aloja otra), infraestructura (escudo de red) e instancia
  // (contenedor con un punto: "una copia corriendo").
  node: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M3.5 8h17" />
      <rect x="7" y="11" width="10" height="6.25" rx="1.5" />
    </>
  ),
  infra: (
    <>
      <path d="M12 3.25l7.25 2.75v5.5c0 4.5-3 7.75-7.25 9.25-4.25-1.5-7.25-4.75-7.25-9.25V6z" />
      <path d="M8.5 12h7M12 8.5v7" />
    </>
  ),
  instance: (
    <>
      <path d="M12 3.5l7.75 4.25v8.5L12 20.5l-7.75-4.25v-8.5z" />
      <circle cx="12" cy="12" r="2.25" />
    </>
  ),
} as const satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof GLYPHS;
export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];

export function isGlyph(name: string): name is GlyphName {
  return name in GLYPHS;
}

export interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: GlyphName;
  size?: number;
  strokeWidth?: number | string;
  title?: string;
}

export function Glyph({ name, size = 16, strokeWidth = 1.5, title, ...rest }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {GLYPHS[name]}
    </svg>
  );
}
