import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { STATUS_HINT, STATUS_LABEL, type Status, type StatusInfo } from '@aegon/core';

/** Orden en que se ofrecen los estados: primero lo normal (existe y no cambia). */
export const STATUS_MENU: readonly Status[] = ['live', 'planned', 'changing', 'deprecated', 'retired'];

/** Punto del color del estado; hueco cuando el elemento existe y no cambia. */
export function StatusDot({ status }: { status: Status }) {
  return <span className="status-dot" data-status={status} aria-hidden />;
}

/**
 * Estado de un elemento o una relación, a la vista y a un click: una pastilla que dice qué pasa con
 * él (existe, es nuevo, se modifica, se da de baja) y un menú para cambiarlo. Cuando lo toma de su
 * contexto (está dentro de un servidor nuevo, por ejemplo) lo dice.
 */
export function StatusPicker({ info, sourceName, onChange }: { info: StatusInfo; sourceName?: string; onChange: (status: Status) => void }) {
  const inherited = info.from !== 'own' && info.from !== 'default';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="status-chip self-start" data-status={info.status} title="Estado: qué pasa con esto en el diagrama" data-testid="status-picker">
          <StatusDot status={info.status} />
          {STATUS_LABEL[info.status]}
          {inherited && sourceName ? <span className="max-w-[130px] truncate font-normal opacity-75">· por {sourceName}</span> : null}
          <ChevronDown size={11} className="-mr-0.5 opacity-70" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu min-w-[250px]" align="start" sideOffset={6}>
          <div className="menu-label">Estado</div>
          {STATUS_MENU.map((status) => (
            <DropdownMenu.Item key={status} className="menu-item" onSelect={() => onChange(status)} data-testid={`status-option-${status}`}>
              <StatusDot status={status} />
              {STATUS_LABEL[status]}
              <span className="menu-hint">{STATUS_HINT[status]}</span>
              {info.status === status && !inherited ? <Check size={13} className="text-accent" /> : null}
            </DropdownMenu.Item>
          ))}
          {inherited && sourceName ? (
            <div className="menu-note">
              Lo toma de «{sourceName}». Elegí un estado para marcarlo aparte.
            </div>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
