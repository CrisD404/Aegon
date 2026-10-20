import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Clipboard, Download, FileDown, FileText, ImageDown, LoaderCircle } from 'lucide-react';
import type { Model } from '@aegon/core';
import { Modal } from '../ui/Modal.tsx';
import { Button, Field, Segmented, Switch } from '../ui/primitives.tsx';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { openDocumentSettings } from '../lib/flows.tsx';
import { ExportSheet, type SheetData, type SheetTone } from './ExportSheet.tsx';
import { ExportCanvas, type CanvasCapture } from './ExportCanvas.tsx';
import { legendFor } from './legend.ts';
import { canvasToPdf, type PageSize } from './pdf.ts';
import { fileSlug, saveBlob } from './save.ts';
import { withInlinedSvgStyles } from './svg-styles.ts';

const SHEET_BG: Record<SheetTone, string> = { light: '#ffffff', dark: '#07090f' };

export function ExportDialog({ close }: { close: () => void }) {
  const model = useWorkspace((s) => s.model);
  const viewId = useUi((s) => s.activeViewId);
  const view = viewId ? model.views[viewId] : undefined;
  const [tone, setTone] = useState<SheetTone>('light');
  const [quality, setQuality] = useState<'1' | '2' | '3'>('2');
  const [page, setPage] = useState<PageSize>('fit');
  const [titleBlock, setTitleBlock] = useState(true);
  const [legend, setLegend] = useState(true);
  const [comments, setComments] = useState(false);
  const [capture, setCapture] = useState<CanvasCapture | null>(null);
  const [status, setStatus] = useState<'capturing' | 'ready' | 'error'>('capturing');
  // Cada combinación de tema, resolución y comentarios es una captura nueva del lienzo oculto.
  const captureKey = `${tone}:${quality}:${comments}:${viewId}`;
  const [captured, setCaptured] = useState<string | null>(null);
  if (captured !== captureKey && status !== 'capturing') setStatus('capturing');
  const onCapture = useCallback(
    (result: CanvasCapture | null) => {
      setCaptured(captureKey);
      if (result) setCapture(result);
      setStatus(result ? 'ready' : 'error');
    },
    [captureKey],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  const data: SheetData | null = useMemo(
    () => (view && capture ? { model, view, ...capture, legend: legendFor(model, view), exportedAt: new Date() } : null),
    [model, view, capture],
  );

  // Escala de la vista previa: la hoja entera entra en el ancho del diálogo.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const box = previewRef.current;
    if (!sheet || !box) return;
    setScale(Math.min(1, (box.clientWidth - 2) / sheet.offsetWidth));
  }, [data, titleBlock, legend]);

  const title = view ? [model.workspace.code, view.name].filter(Boolean).join(' - ') : 'diagrama';
  const renderSheet = useCallback(async () => {
    const node = sheetRef.current;
    if (!node) throw new Error('Sin vista previa');
    const { toCanvas } = await import('html-to-image');
    const ratio = Math.max(0.5, Math.min(Number(quality), 16000 / Math.max(node.offsetWidth, node.offsetHeight)));
    const canvas = await withInlinedSvgStyles(node, () => toCanvas(node, { pixelRatio: ratio, width: node.offsetWidth, height: node.offsetHeight, backgroundColor: SHEET_BG[tone] }));
    return { canvas, width: node.offsetWidth, height: node.offsetHeight };
  }, [quality, tone]);

  const run = (label: string, task: () => Promise<boolean | void>) => async () => {
    setBusy(label);
    try {
      const ok = await task();
      if (ok !== false) useUi.getState().toast(label === 'copy' ? 'Imagen copiada al portapapeles' : 'Exportación guardada', 'success');
    } catch (e) {
      useUi.getState().toast(`No se pudo exportar: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('El navegador no generó la imagen'))), 'image/png'));

  const downloadPng = run('png', async () => {
    const { canvas } = await renderSheet();
    return saveBlob(await toBlob(canvas), `${fileSlug(title)}.png`);
  });
  const downloadPdf = run('pdf', async () => {
    const { canvas, width, height } = await renderSheet();
    const ws = model.workspace;
    const blob = await canvasToPdf(canvas, {
      cssWidth: width,
      cssHeight: height,
      page,
      meta: { title, author: ws.architect, subject: [ws.name, ws.version].filter(Boolean).join(' '), keywords: 'C4, arquitectura, Aegon' },
    });
    return saveBlob(blob, `${fileSlug(title)}.pdf`);
  });
  const copy = run('copy', async () => {
    const { canvas } = await renderSheet();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toBlob(canvas) })]);
  });

  if (!view) return null;
  const missing = ['version', 'date', 'architect', 'organization'].filter((k) => !model.workspace[k as keyof Model['workspace']]);

  return (
    <Modal
      open
      onClose={close}
      title="Exportar diagrama"
      description={`${view.name} · imagen PNG o PDF con cartel y leyenda`}
      icon={<ImageDown size={17} />}
      size="xl"
      testId="export-dialog"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => void openDocumentSettings()}>
            <FileText size={13} /> Datos del documento…
          </Button>
          <span className="flex-1" />
          <Button size="sm" onClick={() => void copy()} disabled={status !== 'ready' || !!busy}>
            <Clipboard size={13} /> Copiar
          </Button>
          <Button size="sm" onClick={() => void downloadPng()} disabled={status !== 'ready' || !!busy} data-testid="export-png">
            {busy === 'png' ? <LoaderCircle size={13} className="animate-spin" /> : <Download size={13} />} PNG
          </Button>
          <Button size="sm" variant="primary" onClick={() => void downloadPdf()} disabled={status !== 'ready' || !!busy} data-testid="export-pdf">
            {busy === 'pdf' ? <LoaderCircle size={13} className="animate-spin" /> : <FileDown size={13} />} PDF
          </Button>
        </>
      }
    >
      {status === 'capturing' && view ? (
        <ExportCanvas key={captureKey} model={model} view={view} tone={tone} pixelRatio={Number(quality)} comments={comments} background={SHEET_BG[tone]} onCapture={onCapture} />
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-5">
        <div ref={previewRef} className="relative min-h-[260px] overflow-hidden rounded-lg border border-line bg-raised" data-testid="export-preview" data-status={status}>
          {status === 'capturing' ? (
            <div className="absolute inset-0 z-10 grid place-items-center bg-raised/70 text-[12.5px] text-fg-muted">
              <span className="flex items-center gap-2">
                <LoaderCircle size={15} className="animate-spin" /> Generando la vista previa…
              </span>
            </div>
          ) : null}
          {status === 'error' ? <div className="grid h-[260px] place-items-center text-[12.5px] text-fg-muted">No se pudo capturar el lienzo (¿está vacío?).</div> : null}
          {data ? (
            <div style={{ width: (sheetRef.current?.offsetWidth ?? 0) * scale, height: (sheetRef.current?.offsetHeight ?? 0) * scale }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: 'max-content' }}>
                <ExportSheet ref={sheetRef} data={data} options={{ tone, titleBlock, legend }} />
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Tema">
            <Segmented value={tone} onChange={(v) => v && setTone(v)} options={[{ value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }]} />
          </Field>
          <Field label="Resolución">
            <Segmented value={quality} onChange={(v) => v && setQuality(v)} options={[{ value: '1', label: '1×' }, { value: '2', label: '2×' }, { value: '3', label: '3×' }]} />
          </Field>
          <Field label="Página del PDF">
            <Segmented value={page} onChange={(v) => v && setPage(v)} options={[{ value: 'fit', label: 'Ajustada' }, { value: 'a4', label: 'A4' }, { value: 'a3', label: 'A3' }]} />
          </Field>
          <Switch checked={titleBlock} onChange={setTitleBlock} label="Cartel" description="Diagrama, nivel, entorno, versión, fecha, autor, unidad" />
          <Switch checked={legend} onChange={setLegend} label="Leyenda" description="Solo lo que usa este lienzo" />
          <Switch checked={comments} onChange={setComments} label="Comentarios" description="Los pines de comentarios del lienzo" />
          {missing.length ? (
            <div className="rounded-md border border-line bg-raised/60 px-3 py-2 text-[11.5px] leading-relaxed text-fg-muted">
              El cartel no tiene {missing.map((k) => ({ version: 'versión', date: 'fecha', architect: 'autor', organization: 'unidad' })[k]).join(', ')}. Completalos en <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => void openDocumentSettings()}>datos del documento</button>.
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

