import { useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import type { View } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { IconButton } from '../ui/primitives.tsx';
import { canvasApi } from './api.ts';
import { searchMatches } from './search.ts';

/** Búsqueda en el lienzo (Ctrl+F): resalta coincidencias y recorre una por una (Enter / Shift+Enter). */
export function CanvasSearch({ view }: { view: View }) {
  const model = useWorkspace((s) => s.model);
  const search = useUi((s) => s.search);
  const setSearch = useUi((s) => s.setSearch);
  const matches = useMemo(
    () => (search.open ? searchMatches(model, view, search.query) : []),
    [model, view, search.open, search.query],
  );
  const index = matches.length ? Math.min(search.index, matches.length - 1) : 0;
  const current = matches[index];

  useEffect(() => {
    if (!current) return;
    useUi.getState().select([current]);
    canvasApi.centerOn(current);
  }, [current]);

  if (!search.open) return null;
  const step = (delta: number) =>
    matches.length && setSearch({ index: (index + delta + matches.length) % matches.length });

  return (
    <div
      className="animate-pop absolute top-10 left-1/2 z-30 flex h-10 w-[380px] -translate-x-1/2 items-center gap-1.5 rounded-lg border border-line bg-panel pr-1 pl-3 shadow-pop"
      data-testid="canvas-search"
    >
      <Search size={14} className="shrink-0 text-fg-subtle" />
      <input
        autoFocus
        value={search.query}
        onChange={(e) => setSearch({ query: e.target.value, index: 0 })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setSearch({ open: false });
          }
        }}
        placeholder="Buscar en este lienzo: nombre, tecnología, tag…"
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle"
        data-testid="canvas-search-input"
      />
      <span
        className="shrink-0 text-[11.5px] text-fg-subtle tabular-nums"
        data-testid="canvas-search-count"
      >
        {search.query.trim()
          ? matches.length
            ? `${index + 1} de ${matches.length}`
            : 'Sin resultados'
          : ''}
      </span>
      <IconButton
        size="sm"
        label="Anterior"
        shortcut="⇧ ↵"
        disabled={matches.length < 2}
        onClick={() => step(-1)}
      >
        <ChevronUp size={14} />
      </IconButton>
      <IconButton
        size="sm"
        label="Siguiente"
        shortcut="↵"
        disabled={matches.length < 2}
        onClick={() => step(1)}
      >
        <ChevronDown size={14} />
      </IconButton>
      <IconButton
        size="sm"
        label="Cerrar"
        shortcut="Esc"
        onClick={() => setSearch({ open: false })}
      >
        <X size={14} />
      </IconButton>
    </div>
  );
}
