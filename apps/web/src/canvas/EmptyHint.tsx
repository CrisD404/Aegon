import { MousePointerClick } from 'lucide-react';
import type { Level } from '@aegon/core';
import { Kbd } from '../ui/primitives.tsx';

const WHAT: Record<Level, string> = {
  1: 'un sistema, un actor o un grupo cloud',
  2: 'un contenedor o una base de datos',
  3: 'un componente',
  deployment: 'un nodo: un datacenter, una red, un servidor',
};

/** En despliegue el orden importa: primero dónde corre, después qué corre, después por dónde se hablan. */
const DEPLOY_STEPS = [
  ['Nodos', 'datacenter › red › servidor o VM. El servidor lleva la IP.'],
  ['Adentro, lo que corre', 'doble click dentro del servidor: un servicio, una base. Llevan sus puertos.'],
  ['Flechas', 'con protocolo y puerto: son lo que hay que abrir en el firewall.'],
] as const;

export function EmptyHint({ level }: { level: Level }) {
  // En despliegue, arriba está la bandeja de lo que falta desplegar: la ayuda va más abajo.
  return (
    <div className={`animate-fade pointer-events-none absolute inset-0 z-10 flex justify-center ${level === 'deployment' ? 'items-end pb-36' : 'items-center'}`}>
      <div className="flex max-w-[360px] flex-col items-center gap-3 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
          <MousePointerClick size={20} />
        </span>
        <p className="m-0 text-[14px] font-semibold text-fg">Doble click para agregar {WHAT[level]}</p>
        {level === 'deployment' ? (
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-left text-[12.5px] leading-relaxed text-fg-subtle" data-testid="deploy-steps">
            {DEPLOY_STEPS.map(([title, text], i) => (
              <li key={title} className="flex gap-2">
                <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-raised font-mono text-[10px] text-fg-muted">{i + 1}</span>
                <span>
                  <span className="text-fg-muted">{title}:</span> {text}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-[12.5px] leading-relaxed text-fg-subtle">
            También podés arrastrar elementos existentes desde el explorador, o abrir la paleta con <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>.
          </p>
        )}
      </div>
    </div>
  );
}
