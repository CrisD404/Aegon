import { Fragment, useMemo } from 'react';
import { DropdownMenu } from 'radix-ui';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GitBranch,
  HardDrive,
  Import,
  Link,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  Search,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
} from 'lucide-react';
import { parentViewOf, type Model, type View } from '@aegon/core';
import { Glyph, TechIcon } from '@aegon/icons';
import { useSync } from '../store/sync.ts';
import { isDesktop } from '../lib/tauri.ts';
import { useUi, type ThemePref } from '../store/ui.ts';
import {
  createBrowserWorkspace,
  createDemoWorkspace,
  importC4ProFolder,
  linkToFolder,
  openFolder,
  openRecord,
  removeWorkspace,
  useWorkspace,
} from '../store/workspace.ts';
import { Button, IconButton, Kbd, cn } from '../ui/primitives.tsx';
import { useChangeCount, useUnsaved } from './ChangesPanel.tsx';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-label="Aegon" role="img">
      <rect width="1024" height="1024" rx="220" fill="var(--fg)" />
      <circle cx="512" cy="430" r="190" stroke="var(--canvas)" strokeWidth="10" strokeDasharray="2 30" opacity="0.9" fill="none" />
      <path d="M360 650L512 340L664 650" stroke="var(--canvas)" strokeWidth="58" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M512 585L534 628L577 650L534 672L512 715L490 672L447 650L490 628L512 585Z" fill="var(--canvas)" />
    </svg>
  );
}

function WorkspaceSwitcher() {
  const record = useWorkspace((s) => s.record);
  const recents = useWorkspace((s) => s.recents);
  const name = useWorkspace((s) => s.model.workspace.name);
  return (
    <DropdownMenu.Root onOpenChange={(o) => o && void useWorkspace.getState().refreshRecents()}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="flex h-8 max-w-[240px] items-center gap-2 rounded-sm px-2 text-left hover:bg-hover data-[state=open]:bg-hover" data-testid="workspace-switcher">
          <Logo />
          <span className="truncate text-[13px] font-semibold text-fg">{name}</span>
          <ChevronDown size={13} className="shrink-0 text-fg-subtle" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu w-[300px]" align="start" sideOffset={6}>
          <div className="menu-label">Workspaces recientes</div>
          {recents.map((r) => (
            <DropdownMenu.Item key={r.key} className="menu-item group" onSelect={() => r.key !== record?.key && void openRecord(r, { requestPermission: true })}>
              {r.source === 'github' ? <TechIcon icon="github" size={14} /> : r.source === 'folder' || r.source === 'desktop' ? <FolderOpen size={14} /> : <HardDrive size={14} />}
              <span className="truncate">{r.name}</span>
              {r.key === record?.key ? (
                <Check size={14} className="ml-auto text-accent" />
              ) : (
                <button
                  type="button"
                  aria-label="Quitar de recientes"
                  className="ml-auto rounded-xs p-0.5 opacity-0 group-data-[highlighted]:opacity-100 hover:text-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (window.confirm(`¿Quitar "${r.name}" de recientes?${r.source === 'browser' ? ' Se borra del navegador.' : ' La carpeta no se toca.'}`)) void removeWorkspace(r);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item
            className="menu-item"
            onSelect={() => {
              const n = window.prompt('Nombre del workspace', 'Nueva arquitectura');
              if (n?.trim()) void createBrowserWorkspace(n.trim());
            }}
          >
            <Plus size={14} /> Nuevo workspace
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => void openFolder()}>
            <FolderOpen size={14} /> Abrir carpeta…
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => void importC4ProFolder()}>
            <Import size={14} /> Importar repo de C4Pro…
          </DropdownMenu.Item>
          {!isDesktop() ? (
            <DropdownMenu.Item className="menu-item" onSelect={() => useUi.getState().setGitHubDialog('open')} data-testid="menu-github-open">
              <TechIcon icon="github" size={14} /> Abrir desde GitHub…
            </DropdownMenu.Item>
          ) : null}
          {!isDesktop() && record?.source === 'browser' ? (
            <DropdownMenu.Item className="menu-item" onSelect={() => useUi.getState().setGitHubDialog('link')}>
              <TechIcon icon="github" size={14} /> Publicar en GitHub…
            </DropdownMenu.Item>
          ) : null}
          {record?.source === 'browser' ? (
            <DropdownMenu.Item className="menu-item" onSelect={() => void linkToFolder()}>
              <Link size={14} /> Vincular a una carpeta…
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item className="menu-item" onSelect={() => void createDemoWorkspace()}>
            <Sparkles size={14} /> Workspace de ejemplo
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function trail(model: Model, view: View | undefined): View[] {
  const out: View[] = [];
  let current = view;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    out.unshift(current);
    seen.add(current.id);
    current = parentViewOf(model, current);
  }
  return out;
}

function Breadcrumbs() {
  const model = useWorkspace((s) => s.model);
  const viewId = useUi((s) => s.activeViewId);
  const view = viewId ? model.views[viewId] : undefined;
  const crumbs = useMemo(() => trail(model, view), [model, view]);
  return (
    <nav className="flex min-w-0 items-center gap-0.5" aria-label="Niveles" data-testid="breadcrumbs">
      {crumbs.map((v, i) => {
        const last = i === crumbs.length - 1;
        const scope = v.scope ? model.elements[v.scope] : undefined;
        return (
          <Fragment key={v.id}>
            {i > 0 ? <ChevronRight size={13} className="shrink-0 text-fg-subtle" /> : null}
            <button
              type="button"
              onClick={() => !last && useUi.getState().openView(v.id, { transition: 'out', focus: crumbs[i + 1]?.scope ?? null })}
              className={cn('flex h-7 min-w-0 items-center gap-1.5 rounded-sm px-2 text-[12.5px] transition-colors', last ? 'text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}
            >
              {scope ? <Glyph name={scope.kind} size={13} className="shrink-0" style={{ color: `var(--kind-${scope.kind})` }} /> : null}
              <span className="truncate font-medium">{scope?.name ?? v.name}</span>
              <span className={cn('rounded-[4px] px-1 font-mono text-[10px] font-bold', last ? 'bg-accent-soft text-accent' : 'bg-raised text-fg-subtle')}>L{v.level}</span>
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}

const THEMES: { id: ThemePref; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Claro', icon: Sun },
  { id: 'dark', label: 'Oscuro', icon: Moon },
  { id: 'system', label: 'Sistema', icon: Monitor },
];

function ThemeMenu() {
  const theme = useUi((s) => s.theme);
  const resolved = useUi((s) => s.resolvedTheme);
  const setPref = useUi((s) => s.setPref);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label="Tema" tipSide="bottom">
          {resolved === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu min-w-[160px]" align="end" sideOffset={6}>
          {THEMES.map((t) => (
            <DropdownMenu.Item key={t.id} className="menu-item" onSelect={() => setPref('theme', t.id)}>
              <t.icon size={14} /> {t.label}
              {theme === t.id ? <Check size={14} className="ml-auto text-accent" /> : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function TopBar() {
  const canUndo = useWorkspace((s) => s.past.length > 0);
  const canRedo = useWorkspace((s) => s.future.length > 0);
  const undo = useWorkspace((s) => s.undo);
  const redo = useWorkspace((s) => s.redo);
  const save = useWorkspace((s) => s.save);
  const saving = useWorkspace((s) => s.saving);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const setPref = useUi((s) => s.setPref);
  const changes = useChangeCount();
  const unsaved = useUnsaved();
  const git = useWorkspace((s) => s.git);

  return (
    <header className="flex h-[var(--topbar-h)] shrink-0 items-center gap-2 border-b border-line bg-panel px-2" data-testid="topbar">
      <WorkspaceSwitcher />
      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton label={sidebarOpen ? 'Ocultar explorador' : 'Mostrar explorador'} shortcut="Ctrl B" tipSide="bottom" active={sidebarOpen} onClick={() => setPref('sidebarOpen', !sidebarOpen)}>
        <PanelLeft size={16} />
      </IconButton>
      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => useUi.getState().setPalette(true)}
          className="mr-1 hidden h-8 w-[220px] items-center gap-2 rounded-sm border border-line bg-raised px-2.5 text-[12.5px] text-fg-subtle transition-colors hover:border-line-strong hover:text-fg-muted md:flex"
          data-testid="open-palette"
        >
          <Search size={13} />
          Buscar o ejecutar…
          <span className="ml-auto flex gap-0.5">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <IconButton label="Deshacer" shortcut="Ctrl Z" tipSide="bottom" disabled={!canUndo} onClick={undo}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label="Rehacer" shortcut="Ctrl ⇧ Z" tipSide="bottom" disabled={!canRedo} onClick={redo}>
          <Redo2 size={16} />
        </IconButton>
        <ThemeMenu />
        <IconButton label={rightOpen ? 'Ocultar inspector' : 'Mostrar inspector'} shortcut="Ctrl I" tipSide="bottom" active={rightOpen} onClick={() => setPref('rightOpen', !rightOpen)}>
          <PanelRight size={16} />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-line" />
        <SyncIndicator />
        <button
          type="button"
          onClick={() => useUi.getState().setRightTab('changes')}
          className={cn('flex h-8 items-center gap-1.5 rounded-sm px-2 text-[12.5px] font-medium transition-colors hover:bg-hover', changes ? 'text-fg' : 'text-fg-subtle')}
          data-testid="changes-badge"
        >
          Cambios
          <span className={cn('min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums leading-[18px]', changes ? 'bg-warn/15 text-warn' : 'bg-raised text-fg-subtle')}>{changes}</span>
        </button>
        {git ? (
          <Button variant="primary" size="sm" disabled={!changes} onClick={() => useUi.getState().setRightTab('changes')} data-testid="topbar-publish">
            Publicar
          </Button>
        ) : (
          <Button variant="primary" size="sm" disabled={!unsaved || saving} onClick={() => void save()}>
            Guardar
          </Button>
        )}
      </div>
    </header>
  );
}

/** Rama sincronizada y commits remotos pendientes (solo en workspaces con git). */
function SyncIndicator() {
  const status = useSync((s) => s.status);
  const busy = useSync((s) => s.busy);
  if (!status) return null;
  return (
    <button
      type="button"
      onClick={() => useUi.getState().setRightTab('changes')}
      className="flex h-8 max-w-[200px] items-center gap-1.5 rounded-sm px-2 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
      title={`Sincronizado con ${status.label}`}
      data-testid="sync-indicator"
    >
      <GitBranch size={13} className={busy === 'push' || busy === 'pull' ? 'animate-pulse text-accent' : ''} />
      <span className="truncate">{status.branch ?? status.label}</span>
      {status.behind ? <span className="rounded-full bg-warn/15 px-1.5 text-[10.5px] font-semibold text-warn tabular-nums">↓{status.behind}</span> : null}
      {status.ahead ? <span className="rounded-full bg-raised px-1.5 text-[10.5px] font-semibold tabular-nums">↑{status.ahead}</span> : null}
    </button>
  );
}
