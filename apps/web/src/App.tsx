import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FolderOpen, Loader2, X } from 'lucide-react';
import { Canvas } from './canvas/Canvas.tsx';
import { Sidebar } from './panels/Sidebar.tsx';
import { Inspector } from './panels/Inspector.tsx';
import { ChangesPanel, useChangeCount } from './panels/ChangesPanel.tsx';
import { CommandPalette } from './panels/CommandPalette.tsx';
import { ConflictDialog, GitHubDialog } from './panels/SyncDialogs.tsx';
import './store/sync.ts';
import { TopBar, Logo } from './panels/TopBar.tsx';
import { useUi, type RightTab } from './store/ui.ts';
import { createDemoWorkspace, defaultViewOf, openFolder, openRecord, useWorkspace } from './store/workspace.ts';
import { lastWorkspaceKey, persist } from './lib/persist.ts';
import { useShortcuts } from './lib/shortcuts.ts';
import { Button, cn } from './ui/primitives.tsx';

const panelSpring = { type: 'spring', stiffness: 420, damping: 38, mass: 0.8 } as const;

async function boot() {
  const records = await persist.listWorkspaces();
  useWorkspace.setState({ recents: records });
  const last = lastWorkspaceKey();
  const ordered = [...records].sort((a, b) => (a.key === last ? -1 : b.key === last ? 1 : 0));
  // Si el último no abre (carpeta movida o borrada, token vencido) se prueba con el siguiente.
  let firstError: string | null = null;
  for (const record of ordered) {
    await openRecord(record);
    const { status, error } = useWorkspace.getState();
    if (status === 'ready' || status === 'needs-permission') {
      if (firstError) useUi.getState().toast(`No se pudo abrir "${ordered[0]!.name}": ${firstError}`, 'error');
      return;
    }
    firstError ??= error ?? 'no está disponible';
  }
  if (!ordered.length) await createDemoWorkspace();
}

export function App() {
  const status = useWorkspace((s) => s.status);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  useShortcuts();

  useEffect(() => {
    void boot();
  }, []);

  // Si el lienzo activo desaparece (deshacer, eliminar), volver al lienzo por defecto.
  useEffect(
    () =>
      useWorkspace.subscribe((s) => {
        const ui = useUi.getState();
        if (s.status === 'ready' && (!ui.activeViewId || !s.model.views[ui.activeViewId])) {
          ui.openView(defaultViewOf(s.model), { transition: 'fade' });
        }
      }),
    [],
  );

  if (status !== 'ready') return <BootScreen />;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {sidebarOpen ? (
            <motion.aside
              key="sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={panelSpring}
              className="min-h-0 shrink-0 overflow-hidden border-r border-line bg-panel"
            >
              <div className="h-full w-[280px]">
                <Sidebar />
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>
        <main className="relative min-w-0 flex-1">
          <Canvas />
        </main>
        <AnimatePresence initial={false}>
          {rightOpen ? (
            <motion.aside
              key="right"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 340, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={panelSpring}
              className="min-h-0 shrink-0 overflow-hidden border-l border-line bg-panel"
            >
              <div className="h-full w-[340px]">
                <RightPanel />
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>
      <CommandPalette />
      <ConflictDialog />
      <GitHubDialog />
      <Toasts />
    </div>
  );
}

function RightPanel() {
  const tab = useUi((s) => s.rightTab);
  const setRightTab = useUi((s) => s.setRightTab);
  const changes = useChangeCount();
  const tabs: [RightTab, string][] = [
    ['inspector', 'Inspector'],
    ['changes', 'Cambios'],
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-0.5 border-b border-line px-2 pt-2" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setRightTab(id)}
            className={cn('relative flex h-8 items-center gap-1.5 rounded-t-sm px-2.5 text-[12.5px] font-medium transition-colors', tab === id ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted')}
            data-testid={`tab-${id}`}
          >
            {label}
            {id === 'changes' && changes ? <span className="rounded-full bg-warn/15 px-1.5 tabular-nums font-semibold text-[10.5px] leading-4 text-warn">{changes}</span> : null}
            {tab === id ? <motion.span layoutId="right-tab" className="absolute right-2 bottom-[-1px] left-2 h-[2px] rounded-full bg-accent" /> : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{tab === 'inspector' ? <Inspector /> : <ChangesPanel />}</div>
    </div>
  );
}

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[70] flex flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            className={cn(
              'pointer-events-auto flex max-w-[420px] items-center gap-3 rounded-md border bg-panel py-2 pr-2 pl-3 text-[12.5px] shadow-pop',
              t.tone === 'error' ? 'border-danger/40 text-fg' : 'border-line text-fg',
            )}
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', t.tone === 'error' ? 'bg-danger' : t.tone === 'success' ? 'bg-ok' : 'bg-accent')} />
            <span className="flex-1">{t.text}</span>
            {t.action ? (
              <button
                type="button"
                className="shrink-0 rounded-xs px-1.5 py-0.5 font-medium text-accent hover:bg-accent-soft"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button type="button" aria-label="Cerrar" className="shrink-0 rounded-xs p-1 text-fg-subtle hover:bg-hover hover:text-fg" onClick={() => dismiss(t.id)}>
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function BootScreen() {
  const status = useWorkspace((s) => s.status);
  const error = useWorkspace((s) => s.error);
  const record = useWorkspace((s) => s.record);
  return (
    <div className="grid h-full place-items-center bg-canvas p-4">
      <div className="animate-pop flex w-[min(380px,100%)] flex-col items-center gap-4 text-center">
        <Logo size={44} />
        {status === 'needs-permission' && record ? (
          <>
            <p className="m-0 text-[14px] font-semibold text-fg">Reconectar "{record.folderName ?? record.name}"</p>
            <p className="m-0 text-[12.5px] leading-relaxed text-fg-subtle">El navegador necesita que vuelvas a dar permiso de lectura y escritura sobre la carpeta del workspace.</p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void openRecord(record, { requestPermission: true })}>
                <FolderOpen size={14} /> Dar permiso
              </Button>
              <Button onClick={() => void createDemoWorkspace()}>Abrir el ejemplo</Button>
            </div>
          </>
        ) : status === 'error' ? (
          <>
            <p className="m-0 text-[14px] font-semibold text-fg">No se pudo abrir el workspace</p>
            <p className="m-0 font-mono text-[12px] text-danger">{error}</p>
            <div className="flex gap-2">
              <Button onClick={() => void openFolder()}>
                <FolderOpen size={14} /> Abrir carpeta
              </Button>
              <Button variant="primary" onClick={() => void createDemoWorkspace()}>
                Abrir el ejemplo
              </Button>
            </div>
          </>
        ) : (
          <Loader2 size={18} className="animate-spin text-fg-subtle" />
        )}
      </div>
    </div>
  );
}
