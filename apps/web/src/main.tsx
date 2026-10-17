import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { Tooltip } from 'radix-ui';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/app.css';
import { App } from './App.tsx';
import { useUi } from './store/ui.ts';
import { useWorkspace } from './store/workspace.ts';

// Acceso a los stores desde la consola y los tests (solo en desarrollo).
if (import.meta.env.DEV) Object.assign(window, { __aegon: { useUi, useWorkspace } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>
    </Tooltip.Provider>
  </StrictMode>,
);
