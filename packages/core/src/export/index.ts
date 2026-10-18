import { sortedValues, type Model } from '../model/index.ts';
import type { Id } from '../schema/index.ts';
import { OpError } from '../ops/index.ts';
import { toMermaid } from './mermaid.ts';
import { toPlantUml } from './plantuml.ts';
import { toStructurizr } from './structurizr.ts';
import { viewsToExport } from './shared.ts';

export { toMermaid, viewToMermaid } from './mermaid.ts';
export { toPlantUml, viewToPlantUml } from './plantuml.ts';
export { toStructurizr } from './structurizr.ts';
export { viewsToExport } from './shared.ts';

export const EXPORT_FORMATS = ['mermaid', 'plantuml-c4', 'structurizr', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Extensión de archivo sugerida para cada formato. */
export const EXPORT_EXTENSION: Readonly<Record<ExportFormat, string>> = {
  mermaid: '.mmd',
  'plantuml-c4': '.puml',
  structurizr: '.dsl',
  json: '.json',
};

/**
 * JSON con el modelo completo (listas ordenadas por ID), pensado para scripts y agentes.
 * Con `viewId` solo incluye ese lienzo.
 */
export function toJson(model: Model, viewId?: Id): string {
  const views = viewId ? viewsToExport(model, viewId) : sortedValues(model.views);
  return `${JSON.stringify(
    {
      workspace: model.workspace,
      elements: sortedValues(model.elements),
      relations: sortedValues(model.relations),
      views,
    },
    null,
    2,
  )}\n`;
}

export function exportModel(model: Model, format: ExportFormat, options: { view?: Id } = {}): string {
  switch (format) {
    case 'mermaid':
      return toMermaid(model, options.view);
    case 'plantuml-c4':
      return toPlantUml(model, options.view);
    case 'structurizr':
      return toStructurizr(model, options.view);
    case 'json':
      return toJson(model, options.view);
    default:
      throw new OpError('invalid-format', `Formato desconocido "${String(format)}": usá ${EXPORT_FORMATS.join(', ')}`);
  }
}
