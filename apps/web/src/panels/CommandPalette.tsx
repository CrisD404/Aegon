import { useMemo, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Dialog } from 'radix-ui';
import {
  ArrowUp,
  FolderOpen,
  Gauge,
  GitCommitHorizontal,
  Grid3x3,
  Import,
  Maximize,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  Ruler,
  Save,
  Sparkles,
  Sun,
  Undo2,
  Wand2,
} from 'lucide-react';
import { KINDS_FOR_LEVEL, KIND_LABEL, sortedValues } from '@aegon/core';
import { Glyph, TechIcon } from '@aegon/icons';
import { useUi } from '../store/ui.ts';
import { createDemoWorkspace, createLargeWorkspace, importC4ProFolder, openDesktopPath, openFolder, useWorkspace } from '../store/workspace.ts';
import { isDesktop } from '../lib/tauri.ts';
import { arrange, createView, goUp, revealElement } from '../lib/actions.ts';
import { canvasApi } from '../canvas/api.ts';
import { elementIcon } from '../canvas/nodes/ElementNode.tsx';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Todas las palabras de la búsqueda tienen que aparecer en el texto (en cualquier orden). */
function matches(query: string, haystack: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = norm(haystack);
  return words.every((w) => h.includes(w));
}

const MAX_ELEMENTS = 40;

function Item({ value, icon, children, shortcut, onSelect, query }: { value: string; icon: ReactNode; children: ReactNode; shortcut?: string; onSelect: () => void; query: string }) {
  const full = typeof children === 'string' ? `${children} ${value}` : value;
  if (!matches(query, full)) return null;
  return (
    <Command.Item value={full} onSelect={onSelect} className="ghost-item">
      <span className="flex w-4 justify-center text-fg-subtle">{icon}</span>
      <span className="truncate">{children}</span>
      {shortcut ? <span className="ml-auto pl-3 font-mono text-[10.5px] text-fg-subtle">{shortcut}</span> : null}
    </Command.Item>
  );
}

/** Paleta de comandos (Ctrl+K): acciones, lienzos y búsqueda de cualquier elemento del modelo. */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setPalette = useUi((s) => s.setPalette);
  const model = useWorkspace((s) => s.model);
  const viewId = useUi((s) => s.activeViewId);
  const level = viewId ? model.views[viewId]?.level : undefined;
  const run = (fn: () => void) => () => {
    setPalette(false);
    // Deja cerrar el diálogo antes de abrir otro overlay (fantasma, selector de carpetas).
    requestAnimationFrame(fn);
  };
  const ui = useUi.getState;
  const [query, setQuery] = useState('');
  // Con miles de elementos no se renderizan todos: solo los que coinciden (con tope).
  const elements = useMemo(() => {
    if (!query.trim()) return [];
    const out = [];
    for (const e of sortedValues(model.elements)) {
      const parent = e.parent ? model.elements[e.parent]?.name : undefined;
      if (matches(query, `${e.name} ${e.id} ${parent ?? ''}`)) out.push({ e, parent });
      if (out.length >= MAX_ELEMENTS) break;
    }
    return out;
  }, [model.elements, query]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setPalette(o);
        if (!o) setQuery('');
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade fixed inset-0 z-50 bg-[var(--overlay)]" />
        <Dialog.Content className="animate-pop fixed top-[14vh] left-1/2 z-50 w-[min(620px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-panel shadow-pop" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Paleta de comandos</Dialog.Title>
          <Command loop label="Paleta de comandos" shouldFilter={false}>
            <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Buscá un elemento, un lienzo o una acción…" className="h-12 w-full border-b border-line bg-transparent px-4 text-[14px] text-fg outline-none placeholder:text-fg-subtle" data-testid="palette-input" />
            <Command.List className="max-h-[min(420px,60vh)] overflow-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-[12.5px] text-fg-subtle">Sin resultados</Command.Empty>
              {level ? (
                <Command.Group heading="Crear">
                  {KINDS_FOR_LEVEL[level].map((kind) => (
                    <Item query={query} key={kind} value={`crear ${KIND_LABEL[kind]} nuevo`} icon={<Glyph name={kind} size={14} />} onSelect={run(() => canvasApi.ghostAtCenter(kind))}>
                      Agregar {KIND_LABEL[kind].toLowerCase()}
                    </Item>
                  ))}
                  <Item query={query} value="crear nuevo lienzo" icon={<Plus size={14} />} onSelect={run(() => createView())}>
                    Nuevo lienzo de contexto
                  </Item>
                </Command.Group>
              ) : null}
              <Command.Group heading="Acciones">
                <Item query={query} value="guardar save" icon={<Save size={14} />} shortcut="Ctrl S" onSelect={run(() => void useWorkspace.getState().save())}>Guardar cambios</Item>
                <Item query={query} value="ver cambios pendientes commit" icon={<GitCommitHorizontal size={14} />} onSelect={run(() => ui().setRightTab('changes'))}>Ver cambios pendientes</Item>
                <Item query={query} value="deshacer undo" icon={<Undo2 size={14} />} shortcut="Ctrl Z" onSelect={run(() => useWorkspace.getState().undo())}>Deshacer</Item>
                <Item query={query} value="rehacer redo" icon={<Redo2 size={14} />} shortcut="Ctrl ⇧ Z" onSelect={run(() => useWorkspace.getState().redo())}>Rehacer</Item>
                <Item query={query} value="ordenar automaticamente layout" icon={<Wand2 size={14} />} shortcut="⇧ L" onSelect={run(arrange)}>Ordenar automáticamente</Item>
                <Item query={query} value="encuadrar fit" icon={<Maximize size={14} />} shortcut="F" onSelect={run(() => canvasApi.fit())}>Encuadrar todo</Item>
                <Item query={query} value="subir de nivel" icon={<ArrowUp size={14} />} shortcut="Alt ↑" onSelect={run(() => goUp())}>Subir un nivel</Item>
                <Item query={query} value="grilla grid" icon={<Grid3x3 size={14} />} shortcut="G" onSelect={run(() => ui().setPref('grid', ui().grid === 'none' ? 'dots' : ui().grid === 'dots' ? 'lines' : 'none'))}>Cambiar grilla</Item>
                <Item query={query} value="reglas rulers" icon={<Ruler size={14} />} shortcut="R" onSelect={run(() => ui().setPref('rulers', !ui().rulers))}>Mostrar u ocultar reglas</Item>
                <Item query={query} value="explorador sidebar" icon={<PanelLeft size={14} />} shortcut="Ctrl B" onSelect={run(() => ui().setPref('sidebarOpen', !ui().sidebarOpen))}>Mostrar u ocultar explorador</Item>
                <Item query={query} value="inspector panel derecho" icon={<PanelRight size={14} />} shortcut="Ctrl I" onSelect={run(() => ui().setPref('rightOpen', !ui().rightOpen))}>Mostrar u ocultar inspector</Item>
                <Item query={query} value="tema claro light" icon={<Sun size={14} />} onSelect={run(() => ui().setPref('theme', 'light'))}>Tema claro</Item>
                <Item query={query} value="tema oscuro dark" icon={<Moon size={14} />} onSelect={run(() => ui().setPref('theme', 'dark'))}>Tema oscuro</Item>
                <Item query={query} value="tema sistema system" icon={<Monitor size={14} />} onSelect={run(() => ui().setPref('theme', 'system'))}>Tema del sistema</Item>
                <Item query={query} value="abrir carpeta workspace" icon={<FolderOpen size={14} />} onSelect={run(() => void openFolder())}>Abrir carpeta…</Item>
                {isDesktop() ? (
                  <Item
                    query={query}
                    value="abrir carpeta por ruta path"
                    icon={<FolderOpen size={14} />}
                    onSelect={run(() => {
                      const path = window.prompt('Ruta de la carpeta del workspace');
                      if (path?.trim()) void openDesktopPath(path.trim()).catch((e: Error) => ui().toast(e.message, 'error'));
                    })}
                  >
                    Abrir carpeta por ruta…
                  </Item>
                ) : null}
                <Item query={query} value="importar c4pro" icon={<Import size={14} />} onSelect={run(() => void importC4ProFolder())}>Importar repo de C4Pro…</Item>
                <Item query={query} value="workspace demo ejemplo" icon={<Sparkles size={14} />} onSelect={run(() => void createDemoWorkspace())}>Abrir workspace de ejemplo</Item>
                <Item query={query} value="workspace escala rendimiento performance grande" icon={<Gauge size={14} />} onSelect={run(() => void createLargeWorkspace())}>Generar workspace de escala (5k elementos)</Item>
              </Command.Group>
              <Command.Group heading="Lienzos">
                {sortedValues(model.views).map((v) => (
                  <Item query={query} key={v.id} value={`lienzo ${v.name} ${v.id}`} icon={<span className="font-mono text-[10px] font-bold">L{v.level}</span>} onSelect={run(() => ui().openView(v.id, { transition: 'fade' }))}>
                    {v.name}
                  </Item>
                ))}
              </Command.Group>
              {elements.length ? (
                <Command.Group heading="Elementos">
                  {elements.map(({ e, parent }) => {
                    const { icon, label } = elementIcon(e);
                    return (
                      <Item query="" key={e.id} value={`elemento ${e.name} ${e.id} ${parent ?? ''}`} icon={<TechIcon icon={icon} label={label} size={14} />} onSelect={run(() => revealElement(e.id))}>
                        {e.name}
                        {parent ? <span className="ml-2 text-[11.5px] text-fg-subtle">{parent}</span> : null}
                      </Item>
                    );
                  })}
                </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
