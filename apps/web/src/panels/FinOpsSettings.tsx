import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2, Wallet } from 'lucide-react';
import {
  CURRENCIES,
  SUGGESTED_ENVIRONMENTS,
  SUGGESTED_TAG_KEYS,
  currencyOf,
  elementsUsingEnvironment,
  environmentsOf,
  slugify,
  type Environment,
  type FinOpsSettingsDraft,
  type Model,
} from '@aegon/core';
import { Modal } from '../ui/Modal.tsx';
import { Button, Field, IconButton, Select, TagInput, TextInput, cn } from '../ui/primitives.tsx';
import { AmountInput, currencySymbol } from './FinOpsFields.tsx';

const CURRENCY_NAME: Record<string, string> = {
  USD: 'Dólar estadounidense',
  EUR: 'Euro',
  ARS: 'Peso argentino',
  BRL: 'Real brasileño',
  CLP: 'Peso chileno',
  COP: 'Peso colombiano',
  MXN: 'Peso mexicano',
  PEN: 'Sol peruano',
  UYU: 'Peso uruguayo',
  GBP: 'Libra esterlina',
};

/** Ambientes, moneda, presupuestos y etiquetas FinOps del workspace. */
export function FinOpsSettingsDialog({
  model,
  close,
}: {
  model: Model;
  close: (draft: FinOpsSettingsDraft | null) => void;
}) {
  const [environments, setEnvironments] = useState<Environment[]>(() => [...environmentsOf(model)]);
  const [currency, setCurrency] = useState(currencyOf(model));
  const [tagKeys, setTagKeys] = useState<string[]>(() => [
    ...(model.workspace.finops?.tagKeys ?? []),
  ]);
  const [budgets, setBudgets] = useState<Record<string, number>>(() => ({
    ...(model.workspace.finops?.budgets ?? {}),
  }));
  const [newName, setNewName] = useState('');

  const add = (e?: FormEvent) => {
    e?.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const taken = new Set(environments.map((x) => x.id));
    let id = slugify(name, 'ambiente');
    for (let i = 2; taken.has(id); i++) id = `${slugify(name, 'ambiente')}-${i}`;
    setEnvironments([...environments, { id, name }]);
    setNewName('');
  };
  const move = (i: number, delta: number) => {
    const next = [...environments];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item!);
    setEnvironments(next);
  };
  const usage = (id: string) => elementsUsingEnvironment(model, id).length;

  return (
    <Modal
      open
      onClose={() => close(null)}
      size="lg"
      icon={<Wallet size={17} />}
      title="Ambientes y costos"
      description="Los ambientes ordenan los costos y el despliegue de cada elemento. Los presupuestos son mensuales."
      testId="finops-settings"
      footer={
        <>
          <span className="flex-1" />
          <Button size="sm" onClick={() => close(null)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => close({ environments, currency, tagKeys, budgets })}
            data-testid="finops-settings-save"
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[11px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">
            Ambientes
          </h3>
          {environments.length ? (
            <div className="flex flex-col gap-1">
              <div className="grid grid-cols-[52px_minmax(0,1fr)_110px_150px_28px] items-center gap-2 px-1 text-[11px] text-fg-subtle">
                <span />
                <span>Nombre</span>
                <span>ID</span>
                <span className="text-right">Presupuesto mensual</span>
                <span />
              </div>
              {environments.map((env, i) => {
                const used = usage(env.id);
                const isNew = !environmentsOf(model).some((e) => e.id === env.id);
                return (
                  <div
                    key={env.id}
                    className="grid grid-cols-[52px_minmax(0,1fr)_110px_150px_28px] items-center gap-2 rounded-md px-1 py-0.5 hover:bg-hover/50"
                    data-testid={`env-row-${env.id}`}
                  >
                    <span className="flex">
                      <IconButton
                        size="sm"
                        label="Subir"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp size={12} />
                      </IconButton>
                      <IconButton
                        size="sm"
                        label="Bajar"
                        disabled={i === environments.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown size={12} />
                      </IconButton>
                    </span>
                    <TextInput
                      value={env.name}
                      onChange={(e) =>
                        setEnvironments(
                          environments.map((x) =>
                            x.id === env.id ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                      onBlur={(e) =>
                        !e.target.value.trim() &&
                        setEnvironments(
                          environments.map((x) => (x.id === env.id ? { ...x, name: env.id } : x)),
                        )
                      }
                      className="h-8"
                    />
                    <span className="flex min-w-0 items-center gap-1.5">
                      <code className="truncate text-[11.5px] text-fg-muted">{env.id}</code>
                      {isNew ? (
                        <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">
                          nuevo
                        </span>
                      ) : null}
                    </span>
                    <AmountInput
                      value={budgets[env.id]}
                      prefix={currencySymbol(currency)}
                      placeholder="Sin presupuesto"
                      onChange={(v) => {
                        const next = { ...budgets };
                        if (v === null) delete next[env.id];
                        else next[env.id] = v;
                        setBudgets(next);
                      }}
                      testId={`budget-${env.id}`}
                    />
                    <IconButton
                      size="sm"
                      label={
                        used
                          ? `Quitar (lo usan ${used} elementos: se borran sus costos en este ambiente)`
                          : 'Quitar ambiente'
                      }
                      onClick={() => setEnvironments(environments.filter((x) => x.id !== env.id))}
                      className="hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-md border border-dashed border-line px-3 py-3">
              <p className="m-0 flex-1 text-[12.5px] leading-relaxed text-fg-subtle">
                Todavía no hay ambientes. Podés empezar con los habituales:{' '}
                {SUGGESTED_ENVIRONMENTS.map((e) => e.name).join(', ')}.
              </p>
              <Button
                size="sm"
                onClick={() => setEnvironments([...SUGGESTED_ENVIRONMENTS])}
                data-testid="use-suggested-envs"
              >
                <Sparkles size={13} /> Usar sugeridos
              </Button>
            </div>
          )}
          <form onSubmit={add} className="flex gap-2">
            <TextInput
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre del ambiente nuevo (ej. Staging, DR)"
              className="h-8 flex-1"
              data-testid="new-env-name"
            />
            <Button size="sm" type="submit" disabled={!newName.trim()}>
              <Plus size={13} /> Agregar
            </Button>
          </form>
        </section>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Moneda" hint="Todos los costos del workspace">
            <Select
              value={currency}
              onChange={(v) => setCurrency(v ?? 'USD')}
              options={CURRENCIES.map((c) => ({
                value: c,
                label: `${c} · ${CURRENCY_NAME[c] ?? c}`,
              }))}
            />
          </Field>
          <Field label="Etiquetas FinOps" hint="Se sugieren al cargar costos">
            <TagInput
              values={tagKeys}
              onChange={setTagKeys}
              suggest={(q) =>
                SUGGESTED_TAG_KEYS.filter(
                  (k) => k.includes(q.toLowerCase()) && !tagKeys.includes(k),
                ).map((k) => ({ value: k, label: k }))
              }
              placeholder="cost-center, project…"
            />
          </Field>
        </div>
        <p className={cn('m-0 text-[11.5px] leading-relaxed text-fg-subtle')}>
          Si quitás un ambiente, sus costos y despliegues se borran de los elementos que lo usaban
          (podés deshacerlo con Ctrl+Z).
        </p>
      </div>
    </Modal>
  );
}
