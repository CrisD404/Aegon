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
  ChevronRight,
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
  Spline,
  Trash2,
  Wand2,
  Server,
} from 'lucide-react';
import type { EdgeShape, Id } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import {
  alignSelection,
  arrange,
  copySelection,
  deleteSelectionFromModel,
  distributeSelection,
  drillInto,
  duplicateSelection,
  paste,
  removeSelectionFromView,
} from '../lib/actions.ts';
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
    if (view && rel) dispatch({ type: 'view.edge', view: view.id, relation: rel.id, style: shape === 'curved' ? null : { ...view.edges?.[rel.id], shape } }, { label: 'Forma de la relación' });
  };

  let content: ReactNode;
  if ((target.type === 'node' && multi) || target.type === 'selection') {
    content = (
      <>
        <div className="menu-label">{selection.nodes.length} seleccionados</div>
        <AlignSubmenu />
        <Item icon={<Wand2 size={14} />} shortcut="⇧L" onSelect={arrange}>Ordenar selección</Item>
        <ContextMenu.Separator className="menu-sep" />
        <Item icon={<CopyPlus size={14} />} shortcut="Ctrl D" onSelect={duplicateSelection}>Duplicar</Item>
        <Item icon={<Copy size={14} />} shortcut="Ctrl C" onSelect={copySelection}>Copiar</Item>
        <Item icon={<BookmarkPlus size={14} />} onSelect={() => void saveSelectionAsTemplate()}>Guardar como template…</Item>
        <ContextMenu.Separator className="menu-sep" />
        <Item icon={<EyeOff size={14} />} shortcut="Supr" onSelect={removeSelectionFromView}>Quitar del lienzo</Item>
        <Item icon={<Trash2 size={14} />} shortcut="⇧ Supr" onSelect={deleteSelectionFromModel} danger>Eliminar del modelo</Item>
      </>
    );
  } else if (target.type === 'node' && el) {
    const canDrill = el.kind === 'system' || el.kind === 'container';
    content = (
      <>
        <div className="menu-label">{el.name}</div>
        {canDrill ? (
          <Item
            icon={<Layers size={14} />}
            shortcut="↵"
            onSelect={async () => {
              await canvasApi.zoomToNode(el.id);
              drillInto(el.id);
            }}
          >
            {el.kind === 'system' ? 'Abrir contenedores (L2)' : 'Abrir componentes (L3)'}
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
        <Item icon={<EyeOff size={14} />} shortcut="Supr" onSelect={removeSelectionFromView}>Quitar del lienzo</Item>
        <Item icon={<Trash2 size={14} />} shortcut="⇧ Supr" onSelect={deleteSelectionFromModel} danger>Eliminar del modelo</Item>
      </>
    );
  } else if (target.type === 'edge') {
    content = rel ? (
      <>
        <div className="menu-label">Relación</div>
        <Item icon={<Pencil size={14} />} onSelect={() => useUi.getState().setRightTab('inspector')}>Editar</Item>
        {editingFlow ? (
          <Item icon={<Workflow size={14} />} onSelect={() => addStep(editingFlow.id, { type: 'message', from: rel.from, to: rel.to, relation: rel.id })}>
            Agregar al flujo «{editingFlow.name}»
          </Item>
        ) : null}
        <Item icon={<ArrowRightLeft size={14} />} onSelect={() => dispatch({ type: 'relation.update', id: rel.id, patch: { from: rel.to, to: rel.from } }, { label: 'Invertir relación' })}>Invertir dirección</Item>
        <Item
          icon={<ArrowRightLeft size={14} />}
          onSelect={() => dispatch({ type: 'relation.update', id: rel.id, patch: { direction: rel.direction === 'bidirectional' ? null : 'bidirectional' } })}
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
