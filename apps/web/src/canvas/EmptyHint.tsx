import { MousePointerClick } from 'lucide-react';
import type { Level } from '@aegon/core';
import { Kbd } from '../ui/primitives.tsx';

const WHAT: Record<Level, string> = {
  1: 'un sistema, un actor o un grupo cloud',
  2: 'un contenedor o una base de datos',
  3: 'un componente',
};

export function EmptyHint({ level }: { level: Level }) {
  return (
    <div className="animate-fade pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="flex max-w-[340px] flex-col items-center gap-3 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
          <MousePointerClick size={20} />
        </span>
        <p className="m-0 text-[14px] font-semibold text-fg">Doble click para agregar {WHAT[level]}</p>
        <p className="m-0 text-[12.5px] leading-relaxed text-fg-subtle">
          También podés arrastrar elementos existentes desde el explorador, o abrir la paleta con <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>.
        </p>
      </div>
    </div>
  );
}
