import { useStore } from '@xyflow/react';
import { Grid3x3, LayoutGrid, Magnet, Maximize, Minus, Plus, Ruler, Square, Wand2 } from 'lucide-react';
import { KINDS_FOR_LEVEL, KIND_LABEL } from '@aegon/core';
import { Glyph } from '@aegon/icons';
import { useUi, type GridMode } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { arrange } from '../lib/actions.ts';
import { IconButton } from '../ui/primitives.tsx';
import { canvasApi } from './api.ts';

const NEXT_GRID: Record<GridMode, GridMode> = { dots: 'lines', lines: 'none', none: 'dots' };
const GRID_LABEL: Record<GridMode, string> = { dots: 'Grilla: puntos', lines: 'Grilla: líneas', none: 'Sin grilla' };

/** Barra flotante inferior: agregar por tipo, grilla, snap, reglas, orden y zoom. */
export function CanvasDock() {
  const viewId = useUi((s) => s.activeViewId);
  const level = useWorkspace((s) => (viewId ? s.model.views[viewId]?.level : undefined));
  const grid = useUi((s) => s.grid);
  const snap = useUi((s) => s.snap);
  const rulers = useUi((s) => s.rulers);
  const setPref = useUi((s) => s.setPref);
  const zoom = useStore((s) => s.transform[2]);
  if (!level) return null;

  return (
    <div className="animate-pop absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-line bg-panel p-1 shadow-pop" data-testid="dock">
      {KINDS_FOR_LEVEL[level].map((kind) => (
        <IconButton key={kind} label={`Agregar ${KIND_LABEL[kind].toLowerCase()}`} onClick={() => canvasApi.ghostAtCenter(kind)} style={{ color: `var(--kind-${kind})` }}>
          <Glyph name={kind} size={17} />
        </IconButton>
      ))}
      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton label={GRID_LABEL[grid]} shortcut="G" onClick={() => setPref('grid', NEXT_GRID[grid])} active={grid !== 'none'}>
        {grid === 'lines' ? <Grid3x3 size={16} /> : grid === 'dots' ? <LayoutGrid size={16} /> : <Square size={16} />}
      </IconButton>
      <IconButton label={snap ? 'Ajuste a grilla activo (Shift: guías)' : 'Ajuste a grilla'} onClick={() => setPref('snap', !snap)} active={snap}>
        <Magnet size={16} />
      </IconButton>
      <IconButton label="Reglas" shortcut="R" onClick={() => setPref('rulers', !rulers)} active={rulers}>
        <Ruler size={16} />
      </IconButton>
      <IconButton label="Ordenar automáticamente" shortcut="⇧L" onClick={arrange}>
        <Wand2 size={16} />
      </IconButton>
      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton label="Alejar" onClick={() => canvasApi.zoomOut()}>
        <Minus size={16} />
      </IconButton>
      <button type="button" className="h-8 w-12 rounded-sm text-[12px] font-medium tabular-nums text-fg-muted hover:bg-hover" onClick={() => canvasApi.fit()} title="Encuadrar (F)">
        {Math.round(zoom * 100)}%
      </button>
      <IconButton label="Acercar" onClick={() => canvasApi.zoomIn()}>
        <Plus size={16} />
      </IconButton>
      <IconButton label="Encuadrar todo" shortcut="F" onClick={() => canvasApi.fit()}>
        <Maximize size={15} />
      </IconButton>
    </div>
  );
}
