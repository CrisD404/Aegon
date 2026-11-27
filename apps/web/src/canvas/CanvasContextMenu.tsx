import type { ReactNode } from 'react';
import { ContextMenu } from 'radix-ui';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowRightLeft,
  BookmarkPlus,
  Check,
  ChevronRight,
  CircleDot,
  ClipboardPaste,
  Copy,
  CopyPlus,
  EyeOff,
  Layers,
  LayoutTemplate,
  MessageSquarePlus,
  Workflow,
  Maximize,
  Pencil,
  Plus,
  Redo2,
  Spline,
  Trash2,
  Wand2,
  Server,
  SquareArrowOutUpRight,
} from 'lucide-react';
import { STATUS_HINT, STATUS_LABEL, canExpandInView, edgeStyleWith, hasManualRoute, invertRelationPatch, isExpandedInView, relationStatusOf, statusOf, type EdgeShape, type Id, type Status } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import {
  alignSelection,
  arrange,
  copySelection,
  deleteSelection,
  distributeSelection,
  drillInto,
  duplicateSelection,
  paste,
  removeSelectionFromView,
  resetRoute,
  setSelectionStatus,
  toggleExpand,
} from '../lib/actions.ts';
import { STATUS_MENU, StatusDot } from '../ui/StatusPicker.tsx';
import { openNewDeploymentView, openTemplates, saveSelectionAsTemplate } from '../lib/flows.tsx';
import { IMPLIED_PREFIX } from './derive.ts';
import { addStep } from '../lib/flow-actions.ts';
import { startCommentAt } from './Comments.tsx';
import { canvasApi } from './api.ts';

export type ContextTarget = {
  type: 'pane' | 'node' | 'edge' | 'selection';
  id?: Id;
  flow: { x: number; y: number };
  client: { x: number; y: number };
};

function Item({ icon, children, shortcut, onSelect, danger, disabled }: { icon?: ReactNode; children: ReactNode; shortcut?: string; onSelect: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <ContextMenu.Item className="menu-item" onSelect={onSelect} data-danger={danger || undefined} disabled={disabled}>
      {icon ?? <span className="w-[14px]" />}
      {children}
      {shortcut ? <span className="shortcut">{shortcut}</span> : null}
    </ContextMenu.Item>
  );
}

function AlignSubmenu() {
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className="menu-item">
        <AlignStartVertical size={14} />
        Alinear y distribuir
        <ChevronRight size={13} className="ml-auto" />
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent className="menu" sideOffset={4}>
          <Item icon={<AlignStartVertical size={14} />} onSelect={() => alignSelection('left')}>Izquierda</Item>
          <Item icon={<AlignCenterVertical size={14} />} onSelect={() => alignSelection('hcenter')}>Centro horizontal</Item>
          <Item icon={<AlignEndVertical size={14} />} onSelect={() => alignSelection('right')}>Derecha</Item>
          <ContextMenu.Separator className="menu-sep" />
          <Item icon={<AlignStartHorizontal size={14} />} onSelect={() => alignSelection('top')}>Arriba</Item>
          <Item icon={<AlignCenterHorizontal size={14} />} onSelect={() => alignSelection('vcenter')}>Centro vertical</Item>
          <Item icon={<AlignEndHorizontal size={14} />} onSelect={() => alignSelection('bottom')}>Abajo</Item>
          <ContextMenu.Separator className="menu-sep" />
          <Item icon={<AlignHorizontalDistributeCenter size={14} />} onSelect={() => distributeSelection('h')}>Distribuir en horizontal</Item>
          <Item icon={<AlignVerticalDistributeCenter size={14} />} onSelect={() => distributeSelection('v')}>Distribuir en vertical</Item>
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}

/** Estado de lo seleccionado: qué es nuevo, qué se modifica y qué se da de baja. */
function StatusSubmenu({ current }: { current?: Status }) {
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className="menu-item" data-testid="ctx-status">
        <CircleDot size={14} />
        Estado
        <ChevronRight size={13} className="ml-auto" />
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent className="menu min-w-[250px]" sideOffset={4}>
          {STATUS_MENU.map((status) => (
            <ContextMenu.Item key={status} className="menu-item" onSelect={() => setSelectionStatus(status)} data-testid={`ctx-status-${status}`}>
              <StatusDot status={status} />
              {STATUS_LABEL[status]}
              <span className="menu-hint">{STATUS_HINT[status]}</span>
              {current === status ? <Check size={13} className="text-accent" /> : null}
            </ContextMenu.Item>
          ))}
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}

export function CanvasContextMenu({ target, children, onOpenGhost }: { target: ContextTarget; children: ReactNode; onOpenGhost: (clientX: number, clientY: number) => void }) {
  const model = useWorkspace((s) => s.model);
  const dispatch = useWorkspace((s) => s.dispatch);
  const viewId = useUi((s) => s.activeViewId);
  const selection = useUi((s) => s.selection);
  const view = viewId ? model.views[viewId] : undefined;
  const el = target.id ? model.elements[target.id] : undefined;
  const rel = target.id && !target.id.startsWith(IMPLIED_PREFIX) ? model.relations[target.id] : undefined;
  const multi = selection.nodes.length > 1;
  const editingFlow = useWorkspace((s) => {
    const id = useUi.getState().flowEdit?.id;
    return id ? s.model.flows?.[id] : undefined;
  });

  const setShape = (shape: EdgeShape) => {
    if (view && rel) dispatch({ type: 'view.edge', view: view.id, relation: rel.id, style: edgeStyleWith(view, rel.id, { shape }) }, { label: 'Forma de la relación' });
  };

  let content: ReactNode;
  if ((target.type === 'node' && multi) || target.type === 'selection') {
    content = (
      <>
        <div className="menu-label">{selection.nodes.length} seleccionados</div>
        <AlignSubmenu />
        <Item icon={<Wand2 size={14} />} shortcut="⇧L" onSelect={arrange}>Ordenar selección</Item>
        <StatusSubmenu />
        <ContextMenu.Separator className="menu-sep" />
        <Item icon={<CopyPlus size={14} />} shortcut="Ctrl D" onSelect={duplicateSelection}>Duplicar</Item>
        <Item icon={<Copy size={14} />} shortcut="Ctrl C" onSelect={copySelection}>Copiar</Item>
        <Item icon={<BookmarkPlus size={14} />} onSelect={() => void saveSelectionAsTemplate()}>Guardar como template…</Item>
        <ContextMenu.Separator className="menu-sep" />
        <Item icon={<EyeOff size={14} />} onSelect={removeSelectionFromView}>Quitar de este lienzo</Item>
        <Item icon={<Trash2 size={14} />} shortcut="Supr" onSelect={deleteSelection} danger>Eliminar</Item>
      </>
    );
  } else if (target.type === 'node' && el) {
    const canDrill = el.kind === 'system' || el.kind === 'container';
    content = (
      <>
        <div className="menu-label">{el.name}</div>
        {canDrill && view && canExpandInView(model, view, el.id) ? (
          <Item icon={<Layers size={14} />} shortcut="↵" onSelect={() => toggleExpand(el.id)}>
            {isExpandedInView(view, el.id) ? 'Cerrar' : el.kind === 'system' ? 'Abrir acá sus contenedores' : 'Abrir acá sus componentes'}
          </Item>
        ) : null}
        {canDrill ? (
          <Item
            icon={<SquareArrowOutUpRight size={14} />}
            shortcut="Alt ↵"
            onSelect={async () => {
              await canvasApi.zoomToNode(el.id);
              drillInto(el.id);
            }}
          >
            Abrir en un lienzo aparte
          </Item>
        ) : null}
        {el.kind === 'system' && el.scope !== 'external' ? (
          <>
            {Object.values(model.views)
              .filter((v) => v.level === 'deployment' && v.scope === el.id)
              .map((v) => (
                <Item key={v.id} icon={<Server size={14} />} onSelect={() => useUi.getState().openView(v.id, { transition: 'fade' })}>
                  Abrir {v.name}
                </Item>
              ))}
            <Item icon={<Server size={14} />} onSelect={() => void openNewDeploymentView(el.id)}>
              Nuevo despliegue…
            </Item>
          </>
        ) : null}
        <Item icon={<Pencil size={14} />} shortcut="F2" onSelect={() => useUi.getState().requestRename()}>Renombrar</Item>
        <StatusSubmenu current={statusOf(model, el.id).status} />
        <Item icon={<CopyPlus size={14} />} shortcut="Ctrl D" onSelect={duplicateSelection} disabled={el.kind === 'group'}>Duplicar</Item>
        <Item icon={<Copy size={14} />} shortcut="Ctrl C" onSelect={copySelection}>Copiar</Item>
        <Item icon={<span className="w-[14px] font-mono text-[10px] text-fg-subtle">ID</span>} onSelect={() => void navigator.clipboard?.writeText(el.id)}>
          Copiar ID <span className="font-mono text-[11px] text-fg-subtle">{el.id}</span>
        </Item>
        <Item
          icon={<BookmarkPlus size={14} />}
          onSelect={() => {
            useUi.getState().select([el.id]);
            void saveSelectionAsTemplate();
          }}
        >
          Guardar como template…
        </Item>
        {editingFlow ? (
          <Item icon={<Workflow size={14} />} onSelect={() => addStep(editingFlow.id, { type: 'process', element: el.id })}>
            Agregar al flujo «{editingFlow.name}»
          </Item>
        ) : null}
        <Item icon={<MessageSquarePlus size={14} />} shortcut="C" onSelect={() => view && startCommentAt(view, target.flow, el.id)}>
          Comentar
        </Item>
        <ContextMenu.Separator className="menu-sep" />
        <Item icon={<EyeOff size={14} />} onSelect={removeSelectionFromView}>Quitar de este lienzo</Item>
        <Item icon={<Trash2 size={14} />} shortcut="Supr" onSelect={deleteSelection} danger>Eliminar</Item>
      </>
    );
  } else if (target.type === 'edge') {
    content = rel ? (
      <>
        <div className="menu-label">Relación</div>
        <Item icon={<Pencil size={14} />} onSelect={() => useUi.getState().setRightTab('inspector')}>Editar</Item>
        <StatusSubmenu current={relationStatusOf(model, rel).status} />
        {editingFlow ? (
          <Item icon={<Workflow size={14} />} onSelect={() => addStep(editingFlow.id, { type: 'message', from: rel.from, to: rel.to, relation: rel.id })}>
            Agregar al flujo «{editingFlow.name}»
          </Item>
        ) : null}
        <Item icon={<ArrowRightLeft size={14} />} onSelect={() => dispatch({ type: 'relation.update', id: rel.id, patch: invertRelationPatch(rel) }, { label: 'Invertir relación' })}>Invertir dirección</Item>
        <Item
          icon={<ArrowRightLeft size={14} />}
          onSelect={() => dispatch({ type: 'relation.update', id: rel.id, patch: rel.direction === 'bidirectional' ? { direction: null, ...(rel.back ? { back: null } : {}) } : { direction: 'bidirectional' } })}
        >
          {rel.direction === 'bidirectional' ? 'Hacer unidireccional' : 'Hacer bidireccional'}
        </Item>
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger className="menu-item">
            <Spline size={14} />
            Forma
            <ChevronRight size={13} className="ml-auto" />
          </ContextMenu.SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent className="menu" sideOffset={4}>
              <Item onSelect={() => setShape('curved')}>Curva</Item>
              <Item onSelect={() => setShape('straight')}>Recta</Item>
              <Item onSelect={() => setShape('step')}>Escalonada</Item>
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
        {hasManualRoute(view?.edges?.[rel.id]) ? (
          <Item icon={<Redo2 size={14} />} onSelect={() => resetRoute(rel.id)}>Volver al trazo automático</Item>
        ) : null}
        <ContextMenu.Separator className="menu-sep" />
        <Item icon={<Trash2 size={14} />} shortcut="Supr" onSelect={() => dispatch({ type: 'relation.remove', id: rel.id }, { label: 'Eliminar relación' })} danger>
          Eliminar relación
        </Item>
      </>
    ) : (
      <>
        <div className="menu-label">Relación implícita</div>
        <Item icon={<Pencil size={14} />} onSelect={() => useUi.getState().setRightTab('inspector')}>Ver relaciones de origen</Item>
      </>
    );
  } else {
    content = (
      <>
        <Item icon={<Plus size={14} />} shortcut="Doble click" onSelect={() => onOpenGhost(target.client.x, target.client.y)}>Agregar elemento aquí</Item>
        <Item icon={<ClipboardPaste size={14} />} shortcut="Ctrl V" onSelect={paste}>Pegar</Item>
        <Item icon={<MessageSquarePlus size={14} />} shortcut="C" onSelect={() => view && startCommentAt(view, target.flow, null)} data-testid="ctx-comment-here">
          Comentar aquí
        </Item>
        <Item icon={<LayoutTemplate size={14} />} onSelect={() => void openTemplates('block')}>Insertar template…</Item>
        <ContextMenu.Separator className="menu-sep" />
        <Item icon={<Wand2 size={14} />} shortcut="⇧L" onSelect={arrange}>Ordenar lienzo</Item>
        <Item icon={<Maximize size={14} />} shortcut="F" onSelect={() => canvasApi.fit()}>Encuadrar todo</Item>
      </>
    );
  }

  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>
        <div className="h-full w-full">{children}</div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu" collisionPadding={8}>
          {content}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
