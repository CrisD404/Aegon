import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Switch as RSwitch, Tooltip } from 'radix-ui';
import { X } from 'lucide-react';

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-line bg-raised px-1 font-mono text-[10.5px] text-fg-muted">
      {children}
    </kbd>
  );
}

export function Tip({ label, shortcut, side = 'top', children }: { label: ReactNode; shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} className="tooltip">
          {label}
          {shortcut ? <kbd>{shortcut}</kbd> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: 'sm' | 'md';
  tipSide?: 'top' | 'bottom' | 'left' | 'right';
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, size = 'md', tipSide = 'top', className, children, ...rest },
  ref,
) {
  return (
    <Tip label={label} shortcut={shortcut} side={tipSide}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg active:bg-press disabled:pointer-events-none disabled:opacity-40',
          size === 'sm' ? 'h-6 w-6' : 'h-8 w-8',
          active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tip>
  );
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-accent text-accent-fg hover:bg-accent-hover disabled:bg-raised disabled:text-fg-subtle disabled:opacity-100',
        variant === 'secondary' && 'border border-line bg-panel text-fg hover:bg-hover',
        variant === 'ghost' && 'text-fg-muted hover:bg-hover hover:text-fg',
        variant === 'danger' && 'text-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]',
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="flex items-center justify-between text-[11.5px] font-medium text-fg-subtle">
        {label}
        {hint ? <span className="font-normal">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-sm border border-line bg-raised px-2.5 text-[13px] text-fg placeholder:text-fg-subtle outline-none transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(inputClass, 'h-8', className)} spellCheck={false} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(inputClass, 'min-h-[64px] resize-y py-2 leading-snug', className)} {...rest} />;
});

export function Select<T extends string>({ value, onChange, options, placeholder }: { value: T | undefined; onChange: (v: T | undefined) => void; options: readonly { value: T; label: string }[]; placeholder?: string }) {
  return (
    <select
      className={cn(inputClass, 'h-8 appearance-none bg-[length:12px] bg-[right_8px_center] bg-no-repeat pr-7')}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b92a3' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-default items-center justify-between gap-3 py-0.5">
      <span className="flex flex-col">
        <span className="text-[13px] text-fg">{label}</span>
        {description ? <span className="text-[11.5px] text-fg-subtle">{description}</span> : null}
      </span>
      <RSwitch.Root
        checked={checked}
        onCheckedChange={onChange}
        className="relative h-[18px] w-8 shrink-0 rounded-full bg-press transition-colors duration-200 data-[state=checked]:bg-accent"
      >
        <RSwitch.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--ease-spring)] data-[state=checked]:translate-x-[16px]" />
      </RSwitch.Root>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, allowEmpty }: { value: T | undefined; onChange: (v: T | undefined) => void; options: readonly { value: T; label: ReactNode; title?: string; tone?: string }[]; allowEmpty?: boolean }) {
  return (
    <div className="flex rounded-sm border border-line bg-raised p-0.5" role="radiogroup">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(active && allowEmpty ? undefined : o.value)}
            className={cn(
              'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[5px] text-[12px] font-medium transition-all duration-150',
              active ? 'bg-panel text-fg shadow-[0_1px_2px_rgb(0_0_0/0.12)]' : 'text-fg-subtle hover:text-fg',
            )}
            style={active && o.tone ? { color: o.tone } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface Suggestion {
  value: string;
  label: string;
  icon?: ReactNode;
  /** Texto a la derecha (categoría); por defecto el valor. */
  hint?: string;
}

/** Lista de chips con autocompletado (tecnologías, tags). Enter o coma agregan; Backspace borra. */
export function TagInput({ values, onChange, suggest, placeholder, renderChip }: { values: readonly string[]; onChange: (v: string[]) => void; suggest?: (query: string) => Suggestion[]; placeholder?: string; renderChip?: (v: string) => ReactNode }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = open && suggest ? suggest(query).filter((s) => !values.includes(s.value)).slice(0, 8) : [];
  useEffect(() => setActive(0), [query]);

  const add = (value: string) => {
    const v = value.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setQuery('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (!query && e.key === 'Tab') return;
      e.preventDefault();
      const s = suggestions[active];
      add(s && (query === '' || s.label.toLowerCase().startsWith(query.toLowerCase()) || s.value.startsWith(query.toLowerCase())) ? s.value : query);
    } else if (e.key === 'Backspace' && !query && values.length) {
      onChange(values.slice(0, -1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div
        className={cn(inputClass, 'flex min-h-8 flex-wrap items-center gap-1 px-1.5 py-1')}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v) => (
          <span key={v} className="animate-pop inline-flex h-6 items-center gap-1 rounded-xs bg-panel pr-1 pl-1.5 text-[12px] text-fg shadow-[0_0_0_1px_var(--line)]">
            {renderChip ? renderChip(v) : v}
            <button type="button" aria-label={`Quitar ${v}`} className="rounded-xs p-0.5 text-fg-subtle hover:bg-hover hover:text-fg" onClick={() => onChange(values.filter((x) => x !== v))}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          placeholder={values.length ? '' : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="h-6 min-w-[60px] flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-fg-subtle"
          spellCheck={false}
        />
      </div>
      {suggestions.length ? (
        <div className="animate-pop absolute top-full right-0 left-0 z-30 mt-1 max-h-60 overflow-auto rounded-md border border-line bg-panel p-1 shadow-pop">
          {suggestions.map((s, i) => (
            <button
              key={s.value}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                add(s.value);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex h-7 w-full items-center gap-2 rounded-xs px-2 text-left text-[12.5px]', i === active ? 'bg-hover text-fg' : 'text-fg-muted')}
            >
              <span className="flex w-4 justify-center text-fg-subtle">{s.icon}</span>
              {s.label}
              <span className={cn('ml-auto text-[10.5px] text-fg-subtle', !s.hint && 'font-mono')}>{s.hint ?? s.value}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between">
      <h3 className="text-[11px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">{children}</h3>
      {action}
    </div>
  );
}
