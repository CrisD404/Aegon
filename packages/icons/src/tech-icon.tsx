import type { SVGProps } from 'react';
import { BRANDS } from './brands.generated.ts';
import { Glyph, isGlyph } from './glyphs.tsx';

/**
 * Marcas sin ícono en simple-icons (AWS, Microsoft, Oracle…): monograma con el mismo peso visual.
 * No se reproducen logos de terceros.
 */
const MONOGRAMS: Readonly<Record<string, string>> = {
  amazonwebservices: 'aws',
  microsoftazure: 'Az',
  microsoftsqlserver: 'SQL',
  oracle: 'ORA',
  amazonrds: 'RDS',
  azurecosmosdb: 'CDB',
  amazondynamodb: 'DDB',
  memcached: 'MC',
  amazons3: 'S3',
  amazonsqs: 'SQS',
  amazonredshift: 'RS',
  awslambda: 'λ',
  azurefunctions: 'ƒ',
  salesforce: 'SF',
  ibm: 'IBM',
  amazonsns: 'SNS',
  amazoneventbridge: 'EB',
  amazonkinesis: 'KDS',
  azureservicebus: 'SB',
  azureeventhubs: 'EH',
  apacheactivemq: 'AMQ',
};

export type ResolvedIcon =
  | { type: 'glyph'; name: Parameters<typeof Glyph>[0]['name'] }
  | { type: 'brand'; path: string; title: string; hex: string }
  | { type: 'monogram'; text: string };

/** Resuelve una clave de ícono del catálogo (`postgresql`, `glyph:globe`) o un texto libre. */
export function resolveIcon(key: string, fallbackLabel?: string): ResolvedIcon {
  if (key.startsWith('glyph:')) {
    const name = key.slice(6);
    if (isGlyph(name)) return { type: 'glyph', name };
  }
  if (isGlyph(key)) return { type: 'glyph', name: key };
  const brand = BRANDS[key];
  if (brand) return { type: 'brand', ...brand };
  const mono = MONOGRAMS[key];
  if (mono) return { type: 'monogram', text: mono };
  return { type: 'monogram', text: monogramFor(fallbackLabel ?? key) };
}

/** `"Core bancario"` → `"CB"`, `"kafka"` → `"Ka"`. */
export function monogramFor(label: string): string {
  const words = label.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const word = words[0] ?? '?';
  return word.length <= 3 && word === word.toUpperCase() ? word : word[0]!.toUpperCase() + (word[1] ?? '');
}

export interface TechIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  /** Clave del catálogo (`icon` de un CatalogItem) o `glyph:<nombre>`. */
  icon: string;
  /** Texto para el monograma si no hay ícono. */
  label?: string;
  size?: number;
  title?: string;
}

/** Ícono monocromo (hereda `currentColor`) para una tecnología, motor o proveedor. */
export function TechIcon({ icon, label, size = 16, title, ...rest }: TechIconProps) {
  const resolved = resolveIcon(icon, label);
  if (resolved.type === 'glyph') return <Glyph name={resolved.name} size={size} title={title} {...rest} />;
  const a11y = title ? { role: 'img' as const } : { 'aria-hidden': true as const };
  if (resolved.type === 'brand') {
    return (
      <svg width={size} height={size} viewBox="-2 -2 28 28" fill="currentColor" {...a11y} {...rest}>
        {title ? <title>{title}</title> : null}
        <path d={resolved.path} />
      </svg>
    );
  }
  const text = resolved.text;
  const fontSize = text.length >= 3 ? 8.5 : text.length === 2 ? 10.5 : 13;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...a11y} {...rest}>
      {title ? <title>{title}</title> : null}
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text
        x="12"
        y="12.5"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontSize={fontSize}
        fontWeight={650}
        fontFamily="Inter, system-ui, sans-serif"
        letterSpacing="-0.02em"
      >
        {text}
      </text>
    </svg>
  );
}
