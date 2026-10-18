import { useMemo } from 'react';
import { NodeToolbar, Position, useStore } from '@xyflow/react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  BookmarkPlus,
  EyeOff,
  Wand2,
} from 'lucide-react';
import {
  alignSelection,
  arrange,
  distributeSelection,
  removeSelectionFromView,
} from '../lib/actions.ts';
import { saveSelectionAsTemplate } from '../lib/flows.tsx';
import { IconButton } from '../ui/primitives.tsx';

/** Toolbar flotante sobre una selección múltiple: alinear, distribuir y ordenar. */
export function SelectionToolbar() {
  // Se lee de ReactFlow (no del store de la UI): así solo apunta a nodos que existen en el
  // lienzo actual, también durante un cambio de lienzo. Clave en string = comparación estable.
  // `s.nodes` solo cambia cuando cambian los nodos (no al mover el viewport).
  const nodes = useStore((s) => s.nodes);
  const key = useMemo(() => {
    const out: string[] = [];
    for (const n of nodes) {
      if (n.dragging) return '';
      if (n.selected && n.type !== 'boundary') out.push(n.id);
    }
    return out.join(' ');
  }, [nodes]);
  const ids = useMemo(() => (key ? key.split(' ') : []), [key]);
  if (ids.length < 2) return null;
  return (
    <NodeToolbar nodeId={ids} isVisible position={Position.Top} offset={14}>
      <div className="animate-pop flex items-center gap-0.5 rounded-md border border-line bg-panel p-0.5 shadow-pop">
        <IconButton size="sm" label="Alinear a la izquierda" onClick={() => alignSelection('left')}>
          <AlignStartVertical size={14} />
        </IconButton>
        <IconButton size="sm" label="Centrar horizontal" onClick={() => alignSelection('hcenter')}>
          <AlignCenterVertical size={14} />
        </IconButton>
        <IconButton size="sm" label="Alinear a la derecha" onClick={() => alignSelection('right')}>
          <AlignEndVertical size={14} />
        </IconButton>
        <IconButton size="sm" label="Alinear arriba" onClick={() => alignSelection('top')}>
          <AlignStartHorizontal size={14} />
        </IconButton>
        <IconButton size="sm" label="Centrar vertical" onClick={() => alignSelection('vcenter')}>
          <AlignCenterHorizontal size={14} />
        </IconButton>
        <IconButton size="sm" label="Alinear abajo" onClick={() => alignSelection('bottom')}>
          <AlignEndHorizontal size={14} />
        </IconButton>
        <div className="mx-0.5 h-4 w-px bg-line" />
        <IconButton
          size="sm"
          label="Distribuir en horizontal"
          onClick={() => distributeSelection('h')}
          disabled={ids.length < 3}
        >
          <AlignHorizontalDistributeCenter size={14} />
        </IconButton>
        <IconButton
          size="sm"
          label="Distribuir en vertical"
          onClick={() => distributeSelection('v')}
          disabled={ids.length < 3}
        >
          <AlignVerticalDistributeCenter size={14} />
        </IconButton>
        <IconButton size="sm" label="Ordenar selección" shortcut="⇧L" onClick={arrange}>
          <Wand2 size={14} />
        </IconButton>
        <IconButton
          size="sm"
          label="Guardar como template"
          onClick={() => void saveSelectionAsTemplate()}
          data-testid="toolbar-save-template"
        >
          <BookmarkPlus size={14} />
        </IconButton>
        <div className="mx-0.5 h-4 w-px bg-line" />
        <IconButton
          size="sm"
          label="Quitar del lienzo"
          shortcut="Supr"
          onClick={removeSelectionFromView}
        >
          <EyeOff size={14} />
        </IconButton>
      </div>
    </NodeToolbar>
  );
}
