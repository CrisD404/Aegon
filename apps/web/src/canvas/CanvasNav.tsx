import { useEffect, useState, type ReactNode } from 'react';
import { MiniMap, useStore, type Node } from '@xyflow/react';
import { Popover } from 'radix-ui';
import { Map as MapIcon, Maximize, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { useUi, type GridMode } from '../store/ui.ts';
import { IconButton, Kbd, Segmented, Switch, cn } from '../ui/primitives.tsx';
import { canvasApi } from './api.ts';

/** Lo que dura el cierre del minimapa (el mismo tiempo que la transición del CSS). */
const CLOSE_MS = 220;

/**
 * Navegación del lienzo, abajo a la derecha y separada del deck de herramientas: una sola tarjeta
 * con el minimapa arriba y los controles de vista y zoom abajo. Al ocultar el minimapa, la
 * tarjeta se pliega hasta quedar solo la barra.
 */
export function CanvasNav({ nodeColor }: { nodeColor: (node: Node) => string }) {
  const minimap = useUi((s) => s.minimap);
  const setPref = useUi((s) => s.setPref);
  const zoom = useStore((s) => s.transform[2]);
  // El minimapa se desmonta recién cuando terminó de plegarse (y se monta antes de desplegarse).
  const [mounted, setMounted] = useState(minimap);
  useEffect(() => {
    if (minimap) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [minimap]);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // El panel "Vista" se ancla a la tarjeta entera: queda arriba, alineado con sus bordes.
  return (
    <Popover.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
      <Popover.Anchor asChild>
        <div
          className="canvas-nav animate-pop"
          data-open={minimap || undefined}
          data-testid="canvas-nav"
        >
          <div className="canvas-nav__map" aria-hidden={!minimap}>
            <div className="canvas-nav__map-inner">
              {mounted ? (
                <MiniMap
                  pannable
                  zoomable
                  style={{ width: 226, height: 132 }}
                  className="c4-minimap"
                  nodeColor={nodeColor}
                  nodeStrokeWidth={0}
                  nodeBorderRadius={6}
                  maskColor="var(--minimap-mask)"
                  maskStrokeColor="var(--minimap-viewport)"
                  maskStrokeWidth={1.5}
                  ariaLabel="Minimapa"
                />
              ) : null}
            </div>
          </div>
          <div className="canvas-nav__bar">
            <IconButton
              label={minimap ? 'Ocultar minimapa' : 'Mostrar minimapa'}
              shortcut="M"
              onClick={() => setPref('minimap', !minimap)}
              active={minimap}
              data-testid="dock-minimap"
            >
              <MapIcon size={16} />
            </IconButton>
            <Popover.Trigger asChild>
              <IconButton
                label="Vista: grilla, reglas y capas"
                active={settingsOpen}
                data-testid="view-settings"
              >
                <SlidersHorizontal size={16} />
              </IconButton>
            </Popover.Trigger>
            <div className="mx-0.5 h-5 w-px bg-line" />
            <IconButton label="Alejar" onClick={() => canvasApi.zoomOut()}>
              <Minus size={16} />
            </IconButton>
            <button
              type="button"
              className="h-8 w-12 rounded-sm text-[12px] font-medium tabular-nums text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              onClick={() => canvasApi.zoomReset()}
              title="Zoom al 100%"
              data-testid="zoom-level"
            >
              {Math.round(zoom * 100)}%
            </button>
            <IconButton label="Acercar" onClick={() => canvasApi.zoomIn()}>
              <Plus size={16} />
            </IconButton>
            <IconButton label="Encuadrar todo" shortcut="F" onClick={() => canvasApi.fit()}>
              <Maximize size={15} />
            </IconButton>
          </div>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          className="animate-pop z-50 w-[300px] rounded-lg border border-line bg-panel p-3 shadow-pop outline-none"
          data-testid="view-settings-panel"
        >
          <ViewSettings />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const GRID_OPTIONS: { value: GridMode; label: string }[] = [
  { value: 'dots', label: 'Puntos' },
  { value: 'lines', label: 'Líneas' },
  { value: 'none', label: 'Sin grilla' },
];

/** Panel "Vista": cómo se ve el lienzo (grilla, reglas, capas). No cambia el modelo. */
function ViewSettings() {
  const grid = useUi((s) => s.grid);
  const snap = useUi((s) => s.snap);
  const rulers = useUi((s) => s.rulers);
  const focusMode = useUi((s) => s.focusMode);
  const costOverlay = useUi((s) => s.costOverlay);
  const showComments = useUi((s) => s.showComments);
  const setPref = useUi((s) => s.setPref);
  return (
    <>
      <div className="mb-2 text-[11px] font-semibold tracking-[0.05em] text-fg-subtle uppercase">
        Grilla
      </div>
      <Segmented value={grid} onChange={(v) => v && setPref('grid', v)} options={GRID_OPTIONS} />
      <div className="mt-3 flex flex-col gap-2.5">
        <SettingRow keys="">
          <Switch
            checked={snap}
            onChange={(v) => setPref('snap', v)}
            label="Ajustar a la grilla"
            description="Con Shift al arrastrar, guías de alineación"
          />
        </SettingRow>
        <SettingRow keys="R">
          <Switch checked={rulers} onChange={(v) => setPref('rulers', v)} label="Reglas" />
        </SettingRow>
      </div>
      <div className="my-3 h-px bg-line" />
      <div className="mb-2 text-[11px] font-semibold tracking-[0.05em] text-fg-subtle uppercase">
        Capas
      </div>
      <div className="flex flex-col gap-2.5">
        <SettingRow keys="⇧F">
          <Switch
            checked={focusMode}
            onChange={(v) => setPref('focusMode', v)}
            label="Foco en la selección"
            description="Atenúa lo que no se relaciona con lo seleccionado"
          />
        </SettingRow>
        <SettingRow keys="$">
          <Switch
            checked={costOverlay}
            onChange={(v) => setPref('costOverlay', v)}
            label="Costos"
            description="Costo mensual sobre cada elemento"
          />
        </SettingRow>
        <SettingRow keys="">
          <Switch
            checked={showComments}
            onChange={(v) => setPref('showComments', v)}
            label="Comentarios"
            description="Los pines de comentarios del lienzo"
          />
        </SettingRow>
      </div>
    </>
  );
}

function SettingRow({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-2')}>
      <div className="min-w-0 flex-1">{children}</div>
      {keys ? <Kbd>{keys}</Kbd> : null}
    </div>
  );
}
