import { FolderOpen, FolderSearch, TriangleAlert } from 'lucide-react';
import {
  costsCsv,
  diffModels,
  elementsUsingEnvironment,
  environmentsOf,
  finopsSettingsOps,
  instantiateBlockOp,
  OpError,
  templateFromSelection,
  templateFromWorkspace,
  type FinOpsSettingsDraft,
  type Template,
  createViewOp,
  type Id,
  type Op,
} from '@aegon/core';
import { FinOpsSettingsDialog } from '../panels/FinOpsSettings.tsx';
import { saveBlob } from '../export/save.ts';
import { DocumentDialog, NewDeploymentDialog, type DocumentDraft, type NewDeploymentDraft } from '../panels/DocumentDialogs.tsx';
import { confirmDialog, promptDialog, showDialog } from '../store/dialogs.ts';
import { newTemplateId, useTemplates } from '../store/templates.ts';
import { useUi } from '../store/ui.ts';
import {
  createWorkspaceFromTemplate,
  folderPrompts,
  openDesktopPath,
  useWorkspace,
} from '../store/workspace.ts';
import { canvasApi } from '../canvas/api.ts';
import {
  InitFolderDialog,
  NewWorkspaceDialog,
  SaveTemplateDialog,
  TemplatesDialog,
  type NewWorkspaceResult,
  type TemplatesResult,
} from '../panels/Templates.tsx';

/**
 * Flujos que combinan diálogos y acciones. Se llaman desde menús, la paleta y atajos; cada uno
 * muestra el modal que corresponde al caso y ejecuta la acción si el usuario confirma.
 */

const ui = () => useUi.getState();

/** Galería de templates: crear un workspace o insertar un bloque en el lienzo actual. */
export async function openTemplates(filter: 'all' | 'workspace' | 'block' = 'all') {
  const result = await showDialog<TemplatesResult | null>(
    (close) => <TemplatesDialog close={close} initialFilter={filter} />,
    null,
  );
  if (!result) return;
  if (result.action === 'insert') insertTemplate(result.template);
  else await newWorkspaceFlow(result.template);
}

export async function newWorkspaceFlow(initial: Template | null = null) {
  const result = await showDialog<NewWorkspaceResult | null>(
    (close) => <NewWorkspaceDialog close={close} initialTemplate={initial} />,
    null,
  );
  if (result) await createWorkspaceFromTemplate(result.name, result.template);
}

/** Inserta un bloque centrado en `at` (por defecto, el centro visible del lienzo). */
export function insertTemplate(template: Template, at?: { x: number; y: number }): string[] | null {
  const ws = useWorkspace.getState();
  const viewId = ui().activeViewId;
  if (!viewId) return null;
  try {
    const { op, ids } = instantiateBlockOp(
      ws.model,
      template,
      viewId,
      at ?? canvasApi.viewportCenter(),
    );
    if (!ws.dispatch(op, { label: `Insertar ${template.name}` })) return null;
    ui().markFresh(ids);
    const placed = ids.filter((id) => useWorkspace.getState().model.views[viewId]?.nodes[id]);
    ui().select(placed);
    canvasApi.reveal(placed);
    ui().toast(`Insertado: ${template.name}`, 'success');
    return ids;
  } catch (error) {
    ui().toast(error instanceof OpError ? error.message : String(error), 'error');
    return null;
  }
}

/** Guarda la selección del lienzo actual (con sus descendientes) como bloque reutilizable. */
export async function saveSelectionAsTemplate() {
  const ws = useWorkspace.getState();
  const viewId = ui().activeViewId;
  const ids = ui().selection.nodes;
  if (!viewId || !ids.length) {
    ui().toast('Seleccioná uno o más elementos del lienzo para guardarlos como template');
    return;
  }
  let draft: Template;
  try {
    const first = ws.model.elements[ids[0]!];
    const suggested = ids.length === 1 && first ? first.name : `${ids.length} elementos`;
    draft = templateFromSelection(ws.model, viewId, ids, { id: newTemplateId(), name: suggested });
  } catch (error) {
    ui().toast((error as Error).message, 'error');
    return;
  }
  await saveTemplateFlow(draft);
}

export async function saveWorkspaceAsTemplate() {
  const ws = useWorkspace.getState();
  await saveTemplateFlow(
    templateFromWorkspace(ws.model, { id: newTemplateId(), name: ws.model.workspace.name }),
  );
}

async function saveTemplateFlow(draft: Template) {
  const meta = await showDialog<{ name: string; description?: string } | null>(
    (close) => <SaveTemplateDialog template={draft} close={close} />,
    null,
  );
  if (!meta) return;
  await useTemplates
    .getState()
    .add({
      ...draft,
      ...meta,
      model: { ...draft.model, workspace: { ...draft.model.workspace, name: meta.name } },
    });
  ui().toast(`Template guardado: ${meta.name}`, 'success', {
    label: 'Ver templates',
    run: () => void openTemplates(draft.kind),
  });
}

// -----------------------------------------------------------------------------------------------
// Confirmaciones de workspace

/** Carpeta sin workspace: crear uno nuevo (con template opcional) o cancelar. */
export function askInitFolder(folder: string): Promise<{ template: Template | null } | null> {
  return showDialog<{ template: Template | null } | null>(
    (close) => <InitFolderDialog folder={folder} close={close} />,
    null,
  );
}

export function confirmReplaceFolder(folder: string, workspaceName: string): Promise<boolean> {
  return confirmDialog({
    title: `"${folder}" ya tiene un workspace`,
    description: `Se van a reemplazar sus archivos del modelo con "${workspaceName}". README, código y demás archivos de la carpeta no se tocan.`,
    details: 'Si la carpeta es un repo git, vas a poder ver y revertir el cambio con git.',
    confirmLabel: 'Reemplazar workspace',
    tone: 'warning',
    icon: <TriangleAlert size={17} />,
  });
}

folderPrompts.initFolder = askInitFolder;
folderPrompts.confirmReplace = confirmReplaceFolder;

export async function discardChangesFlow() {
  const ws = useWorkspace.getState();
  const changes = diffModels(ws.syncBase ?? ws.base, ws.model);
  if (!changes.length) return;
  const count = (entity: string) => changes.filter((c) => c.entity === entity).length;
  const parts = (
    [
      [count('element'), 'elemento', 'elementos'],
      [count('relation'), 'relación', 'relaciones'],
      [count('view'), 'lienzo', 'lienzos'],
    ] as const
  )
    .filter(([n]) => n)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  const ok = await confirmDialog({
    title: `¿Descartar ${changes.length} ${changes.length === 1 ? 'cambio' : 'cambios'}?`,
    description:
      'El borrador vuelve al último estado guardado o sincronizado. Podés recuperarlo con Ctrl+Z mientras no cierres la app.',
    details: parts.length ? `Afecta a ${parts.join(', ')}.` : undefined,
    confirmLabel: 'Descartar cambios',
    tone: 'danger',
  });
  if (ok) ws.discardAll();
}

export async function openPathFlow() {
  const path = await promptDialog({
    title: 'Abrir carpeta por ruta',
    description: 'La carpeta puede tener un workspace de Aegon o estar vacía (se crea uno).',
    label: 'Ruta',
    placeholder: 'C:\\Proyectos\\arquitectura',
    confirmLabel: 'Abrir',
    icon: <FolderSearch size={17} />,
    mono: true,
  });
  if (!path) return;
  try {
    await openDesktopPath(path);
  } catch (error) {
    ui().toast((error as Error).message, 'error');
  }
}

export async function confirmRemoveRecent(name: string, source: string): Promise<boolean> {
  const browser = source === 'browser';
  return confirmDialog({
    title: `¿Quitar "${name}" de recientes?`,
    description: browser
      ? 'Este workspace vive solo en este navegador: se borran sus archivos y su borrador.'
      : source === 'github'
        ? 'Se borra la copia local y el token guardado. El repo de GitHub no se toca.'
        : 'Solo se quita de la lista. La carpeta y sus archivos no se tocan.',
    confirmLabel: browser ? 'Eliminar workspace' : 'Quitar de recientes',
    tone: browser ? 'danger' : 'default',
    icon: browser ? <TriangleAlert size={17} /> : <FolderOpen size={17} />,
  });
}

// -----------------------------------------------------------------------------------------------
// FinOps

/** Ambientes, moneda, presupuestos y etiquetas. Si se quitan ambientes en uso, confirma antes. */
export async function openFinOpsSettings() {
  const model = useWorkspace.getState().model;
  const draft = await showDialog<FinOpsSettingsDraft | null>(
    (close) => <FinOpsSettingsDialog model={model} close={close} />,
    null,
  );
  if (!draft) return;
  const current = useWorkspace.getState().model;
  const removed = environmentsOf(current).filter(
    (e) => !draft.environments.some((d) => d.id === e.id),
  );
  const affected = new Set(
    removed.flatMap((e) => elementsUsingEnvironment(current, e.id).map((el) => el.id)),
  );
  if (affected.size) {
    const ok = await confirmDialog({
      title: `¿Quitar ${removed.map((e) => `"${e.name}"`).join(', ')}?`,
      description: `${affected.size} ${affected.size === 1 ? 'elemento tiene' : 'elementos tienen'} costos o despliegue en ${removed.length === 1 ? 'ese ambiente' : 'esos ambientes'}: se van a borrar.`,
      details: 'Podés deshacerlo con Ctrl+Z.',
      confirmLabel: 'Quitar y guardar',
      tone: 'danger',
      icon: <TriangleAlert size={17} />,
    });
    if (!ok) return;
  }
  const ops = finopsSettingsOps(current, draft);
  if (!ops.length) return;
  if (useWorkspace.getState().dispatch({ type: 'batch', ops, label: 'Ambientes y costos' })) {
    ui().toast('Ambientes y costos actualizados', 'success');
    const env = ui().costEnv;
    if (env && !draft.environments.some((e) => e.id === env)) ui().setPref('costEnv', null);
  }
}

/** Descarga los costos como CSV (una fila por elemento y ambiente). */
export function exportCostsCsv() {
  const model = useWorkspace.getState().model;
  // BOM: Excel lo abre con acentos correctos.
  const blob = new Blob(['\uFEFF', costsCsv(model)], { type: 'text/csv;charset=utf-8' });
  void saveBlob(blob, `${model.workspace.id}-costos.csv`).then((ok) => ok && ui().toast('CSV de costos guardado', 'success'));
}

// -----------------------------------------------------------------------------------------------
// Documento y despliegue

/** Datos del documento (nombre, código, versión, fecha, autor, unidad). */
export async function openDocumentSettings() {
  const model = useWorkspace.getState().model;
  const draft = await showDialog<DocumentDraft | null>((close) => <DocumentDialog model={model} close={close} />, null);
  if (!draft) return;
  const ws = useWorkspace.getState().model.workspace;
  const patch: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(draft) as [keyof DocumentDraft, string | undefined][]) {
    const next = value?.trim() ? value.trim() : null;
    if ((ws[key] ?? null) !== next) patch[key] = next;
  }
  if (patch.name === null) delete patch.name;
  if (!Object.keys(patch).length) return;
  if (useWorkspace.getState().dispatch({ type: 'workspace.update', patch }, { label: 'Datos del documento' })) {
    useUi.getState().toast('Datos del documento actualizados', 'success');
  }
}

/** Crea un lienzo de despliegue (y el ambiente, si se agregó en el diálogo) y lo abre. */
export async function openNewDeploymentView(scope?: Id) {
  const model = useWorkspace.getState().model;
  // Sin sistema explícito: el seleccionado, o el del lienzo actual (L2 abre un sistema; L3, un contenedor de uno).
  if (!scope) {
    const ui = useUi.getState();
    const selected = ui.selection.nodes.length === 1 ? model.elements[ui.selection.nodes[0]!] : undefined;
    const view = ui.activeViewId ? model.views[ui.activeViewId] : undefined;
    const viewScope = view?.scope ? model.elements[view.scope] : undefined;
    const candidate = selected?.kind === 'system' ? selected : viewScope?.kind === 'system' ? viewScope : viewScope?.parent ? model.elements[viewScope.parent] : undefined;
    if (candidate?.kind === 'system' && candidate.scope !== 'external') scope = candidate.id;
  }
  const draft = await showDialog<NewDeploymentDraft | null>((close) => <NewDeploymentDialog model={model} scope={scope} close={close} />, null);
  if (!draft) return;
  const current = useWorkspace.getState().model;
  const ops: Op[] = [];
  if (draft.newEnvironment) ops.push({ type: 'workspace.update', patch: { environments: [...environmentsOf(current), draft.newEnvironment] } });
  const { op, id } = createViewOp(current, draft.name, 'deployment', draft.scope, draft.environment);
  ops.push(op);
  if (useWorkspace.getState().dispatch({ type: 'batch', ops, label: `Crear ${draft.name}` })) useUi.getState().openView(id, { transition: 'fade' });
}

/** Exportar el lienzo activo a PNG o PDF (con cartel y leyenda). */
export async function openExportDialog() {
  if (!useUi.getState().activeViewId) return;
  const { ExportDialog } = await import('../export/ExportDialog.tsx');
  await showDialog<void>((close) => <ExportDialog close={() => close(undefined)} />, undefined);
}
