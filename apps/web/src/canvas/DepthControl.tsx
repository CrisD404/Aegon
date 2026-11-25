import { depthOf, depthsOf, type Depth, type View } from '@aegon/core';
import { useWorkspace } from '../store/workspace.ts';
import { setDepth } from '../lib/actions.ts';
import { Tip } from '../ui/primitives.tsx';

const LABEL: Record<Depth, string> = { 1: 'Contexto', 2: 'Contenedores', 3: 'Componentes' };
const HINT: Record<Depth, string> = {
  1: 'Cerrar todo: solo sistemas y actores',
  2: 'Abrir los sistemas: se ven sus contenedores',
  3: 'Abrir también los contenedores: se ven sus componentes',
};

/**
 * Profundidad del lienzo: cuánto del modelo se ve abierto, de una vez. El nivel C4 deja de ser un
 * tipo de lienzo y pasa a ser cuánto detalle se muestra; cada elemento además se abre o se cierra
 * por separado (doble click).
 */
export function DepthControl({ view }: { view: View }) {
  const model = useWorkspace((s) => s.model);
  const depths = depthsOf(view);
  if (depths.length < 2) return null;
  const current = depthOf(model, view);
  return (
    <div className="canvas-depth animate-pop" role="group" aria-label="Profundidad del lienzo" data-testid="depth">
      {depths.map((d) => (
        <Tip key={d} label={HINT[d]} side="bottom">
          <button type="button" aria-pressed={current === d} onClick={() => setDepth(d)} data-testid={`depth-${d}`}>
            {LABEL[d]}
          </button>
        </Tip>
      ))}
    </div>
  );
}
