import { forwardRef } from 'react';
import type { Model, View } from '@aegon/core';
import type { LegendItem, LegendLine } from './legend.ts';
import './export.css';

export type SheetTone = 'light' | 'dark';

export interface SheetOptions {
  tone: SheetTone;
  titleBlock: boolean;
  legend: boolean;
}

export interface SheetData {
  model: Model;
  view: View;
  /** Imagen del diagrama (data URL) y su tamaño lógico. */
  image: string;
  width: number;
  height: number;
  legend: { items: LegendItem[]; lines: LegendLine[] };
  exportedAt: Date;
}

const LEVEL_NAME = { 1: 'Contexto (C4 · nivel 1)', 2: 'Contenedores (C4 · nivel 2)', 3: 'Componentes (C4 · nivel 3)', deployment: 'Despliegue (C4)' } as const;

function formatDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * Hoja que se exporta: encabezado, diagrama, leyenda y cartel con los datos del documento
 * (diagrama, nivel, entorno, versión, fecha, autor, unidad). Es independiente del tema de la app:
 * usa su propia paleta (`data-tone`), así un PDF sale igual lo exporte quien lo exporte.
 */
export const ExportSheet = forwardRef<HTMLDivElement, { data: SheetData; options: SheetOptions }>(function ExportSheet({ data, options }, ref) {
  const { model, view } = data;
  const ws = model.workspace;
  const environment = view.environment ? (ws.environments?.find((e) => e.id === view.environment)?.name ?? view.environment) : undefined;
  const scope = view.scope ? model.elements[view.scope] : undefined;
  const diagram = [ws.code, ws.name].filter(Boolean).join(' · ');
  const width = Math.max(data.width, 1040);
  const fields: [string, string | undefined][] = [
    ['Diagrama', diagram],
    ['Lienzo', view.name],
    ['Nivel', LEVEL_NAME[view.level]],
    ['Entorno', environment],
    ['Sistema', scope?.name],
    ['Versión', ws.version],
    ['Fecha', formatDate(ws.date)],
    ['Autor', ws.architect],
    ['Unidad', ws.organization],
  ];
  const shown = fields.filter(([, v]) => !!v);
  const stamp = data.exportedAt.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div ref={ref} className="export-sheet" data-tone={options.tone} style={{ width: width + 64 }} data-testid="export-sheet">
      <header className="export-sheet__head">
        <div className="export-sheet__eyebrow">{[diagram, environment ? `Entorno ${environment}` : null].filter(Boolean).join(' · ')}</div>
        <h1 className="export-sheet__title">{view.name}</h1>
        {view.description ? <p className="export-sheet__desc">{view.description}</p> : null}
      </header>
      <div className="export-sheet__diagram">
        <img src={data.image} width={data.width} height={data.height} alt={view.name} />
      </div>
      {options.legend || options.titleBlock ? (
        <footer className="export-sheet__foot">
          {options.legend && (data.legend.items.length || data.legend.lines.length) ? (
            <section className="export-legend" aria-label="Leyenda">
              <div className="export-sheet__label">Leyenda</div>
              <div className="export-legend__grid">
                {data.legend.items.map((item) => (
                  <div key={item.key} className="export-legend__item">
                    <Swatch item={item} />
                    <span>
                      {item.label}
                      {item.hint ? <small> · {item.hint}</small> : null}
                    </span>
                  </div>
                ))}
                {data.legend.lines.map((line) => (
                  <div key={line.key} className="export-legend__item">
                    <LineSwatch line={line} />
                    <span>{line.label}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <span />
          )}
          {options.titleBlock && shown.length ? (
            <section className="export-cartel" aria-label="Datos del documento" data-testid="export-cartel">
              {shown.map(([label, value]) => (
                <div key={label} className="export-cartel__row">
                  <span className="export-cartel__key">{label}</span>
                  <span className="export-cartel__value">{value}</span>
                </div>
              ))}
            </section>
          ) : null}
        </footer>
      ) : null}
      <div className="export-sheet__stamp">Exportado el {stamp} con Aegon</div>
    </div>
  );
});

function Swatch({ item }: { item: LegendItem }) {
  const style = { ['--sw' as string]: `var(${item.color})` };
  return <span className="export-swatch" data-shape={item.shape} data-external={item.external || undefined} style={style} aria-hidden />;
}

function LineSwatch({ line }: { line: LegendLine }) {
  return (
    <svg className="export-line" data-style={line.style} width="40" height="12" viewBox="0 0 40 12" aria-hidden>
      <defs>
        <marker id={`sheet-arrow-${line.key}`} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M2 2 L10 6 L2 10 z" />
        </marker>
      </defs>
      <line x1={line.both ? 6 : 2} y1="6" x2="34" y2="6" markerEnd={`url(#sheet-arrow-${line.key})`} markerStart={line.both ? `url(#sheet-arrow-${line.key})` : undefined} />
    </svg>
  );
}
