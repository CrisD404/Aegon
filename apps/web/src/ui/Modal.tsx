import type { ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from './primitives.tsx';

export type Tone = 'default' | 'warning' | 'danger';

const TONE_COLOR: Record<Tone, string> = {
  default: 'var(--accent)',
  warning: 'var(--warn)',
  danger: 'var(--danger)',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Ícono del encabezado (se pinta con el color del tono). */
  icon?: ReactNode;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children?: ReactNode;
  footer?: ReactNode;
  testId?: string;
}

const WIDTH: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'w-[min(420px,calc(100vw-32px))]',
  md: 'w-[min(480px,calc(100vw-32px))]',
  lg: 'w-[min(760px,calc(100vw-32px))]',
  xl: 'w-[min(980px,calc(100vw-32px))]',
};

/** Modal base de la app: encabezado con ícono por tono, contenido con scroll y pie de acciones. */
export function Modal({ open, onClose, title, description, icon, tone = 'default', size = 'md', children, footer, testId }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade fixed inset-0 z-[60] bg-[var(--overlay)] backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'animate-pop fixed top-1/2 left-1/2 z-[60] flex max-h-[min(760px,90vh)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-pop outline-none',
            WIDTH[size],
          )}
          data-testid={testId}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="flex items-start gap-3 px-5 pt-5 pb-3">
            {icon ? (
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                style={{ color: TONE_COLOR[tone], background: `color-mix(in srgb, ${TONE_COLOR[tone]} 13%, transparent)` }}
              >
                {icon}
              </span>
            ) : null}
            <div className="min-w-0 flex-1 pt-0.5">
              <Dialog.Title className="m-0 text-[15px] font-semibold text-fg">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="m-0 mt-1 text-[12.5px] leading-relaxed text-fg-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{typeof title === 'string' ? title : ''}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="-mt-1 -mr-1 rounded-sm p-1 text-fg-subtle hover:bg-hover hover:text-fg" aria-label="Cerrar">
              <X size={15} />
            </Dialog.Close>
          </div>
          {children ? <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">{children}</div> : null}
          {footer ? <div className="flex items-center gap-2 border-t border-line bg-raised/40 px-5 py-3">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
