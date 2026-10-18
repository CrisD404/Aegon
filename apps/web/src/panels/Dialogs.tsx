import { Fragment, useState, type FormEvent } from 'react';
import { CircleHelp, TriangleAlert } from 'lucide-react';
import { registerDialogRenderers, useDialogs, type ConfirmSpec, type PromptSpec } from '../store/dialogs.ts';
import { Modal } from '../ui/Modal.tsx';
import { Button, Field, TextInput, cn } from '../ui/primitives.tsx';

function ConfirmDialog({ spec, close }: { spec: ConfirmSpec; close: (value: boolean) => void }) {
  const tone = spec.tone ?? 'default';
  return (
    <Modal
      open
      onClose={() => close(false)}
      title={spec.title}
      description={spec.description}
      tone={tone}
      icon={spec.icon ?? (tone === 'default' ? <CircleHelp size={17} /> : <TriangleAlert size={17} />)}
      size="sm"
      testId="confirm-dialog"
      footer={
        <>
          <span className="flex-1" />
          <Button size="sm" onClick={() => close(false)}>
            {spec.cancelLabel ?? 'Cancelar'}
          </Button>
          <Button
            size="sm"
            autoFocus
            variant="primary"
            className={cn(tone === 'danger' && 'bg-danger text-white hover:bg-[color-mix(in_srgb,var(--danger)_85%,black)]')}
            onClick={() => close(true)}
            data-testid="confirm-accept"
          >
            {spec.confirmLabel}
          </Button>
        </>
      }
    >
      {spec.details ? <div className="rounded-md border border-line bg-raised/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-fg-muted">{spec.details}</div> : null}
    </Modal>
  );
}

function PromptDialog({ spec, close }: { spec: PromptSpec; close: (value: string | null) => void }) {
  const [value, setValue] = useState(spec.defaultValue ?? '');
  const [touched, setTouched] = useState(false);
  const error = spec.validate?.(value) ?? (value.trim() ? null : 'No puede quedar vacío');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!error) close(value.trim());
  };
  return (
    <Modal
      open
      onClose={() => close(null)}
      title={spec.title}
      description={spec.description}
      icon={spec.icon}
      size="sm"
      testId="prompt-dialog"
      footer={
        <>
          <span className="flex-1" />
          <Button size="sm" onClick={() => close(null)}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" type="submit" form="prompt-form" data-testid="prompt-accept">
            {spec.confirmLabel}
          </Button>
        </>
      }
    >
      <form id="prompt-form" onSubmit={submit} className="flex flex-col gap-2">
        <Field label={spec.label}>
          <TextInput
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder={spec.placeholder}
            className={cn(spec.mono && 'font-mono text-[12px]')}
            data-testid="prompt-input"
          />
        </Field>
        {touched && error ? <p className="m-0 text-[12px] text-danger">{error}</p> : spec.hint ? <p className="m-0 text-[11.5px] leading-relaxed text-fg-subtle">{spec.hint}</p> : null}
      </form>
    </Modal>
  );
}

registerDialogRenderers({
  confirm: (spec, close) => <ConfirmDialog spec={spec} close={close as (v: boolean) => void} />,
  prompt: (spec, close) => <PromptDialog spec={spec} close={close as (v: string | null) => void} />,
});

/** Renderiza los diálogos abiertos (el último queda arriba). */
export function DialogHost() {
  const stack = useDialogs((s) => s.stack);
  return (
    <>
      {stack.map((d) => (
        <Fragment key={d.id}>{d.render(d.close)}</Fragment>
      ))}
    </>
  );
}
