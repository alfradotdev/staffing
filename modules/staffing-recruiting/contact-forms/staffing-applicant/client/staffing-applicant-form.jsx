'use strict';

import { useForm, FormLayout } from '@loopar/form';
import { useFormValues } from '@form-provider';
import { useDocument, useViewOptions } from '@loopar/document';
import { loopar } from 'loopar';
import { Button } from '@cn/components/ui/button';
import { Check, ExternalLink } from 'lucide-react';
import { cn } from '@cn/lib/utils';

const workerUrl = (name) => `/desk/Staffing Worker/update?name=${encodeURIComponent(name)}`;
const splitValues = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const lines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);

/**
 * `areas_of_interest` slot: one toggle per option of the slot (its `options`,
 * one per line), stored comma-separated. Read-only views show the picked ones.
 */
function AreasPicker({ data = {} }) {
  const { setValue } = useForm();
  const { Document } = useDocument();
  const { readOnly } = useViewOptions();
  const readMode = (readOnly ?? Document?.readOnly) === true || [1, '1', true].includes(data.readonly);
  const formValues = useFormValues() ?? Document?.data ?? {};
  const selected = splitValues(formValues[data.name]);
  const options = lines(data.options);

  const toggle = (option) => {
    const next = selected.includes(option) ? selected.filter((o) => o !== option) : [...selected, option];
    setValue(data.name, next.join(','));
  };

  const label = <p className="text-sm font-medium leading-none">{data.label}</p>;

  if (readMode) {
    return (
      <div className="space-y-2">
        {label}
        {selected.length ? (
          <div className="flex flex-wrap gap-2">
            {selected.map((o) => (
              <span key={o} className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary">{o}</span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">None selected</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {label}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(o)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
              )}
            >
              {on && <Check className="size-3.5" />}
              {o}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">Pick every area you are interested in.</p>
    </div>
  );
}

const SLOTS = { areas_of_interest: AreasPicker };

/**
 * Pipeline actions (Screening, Interview, Hire…) come from the workflow.
 * This view adds the areas picker and a shortcut to the hired worker.
 * `children` must be passed through: the website's contact_form element
 * renders this same component and injects the honeypot, captcha and Send
 * button as children.
 */
export default function StaffingApplicantForm({ children }) {
  const { getValue } = useForm();
  const worker = getValue('worker');

  const actions = worker ? {
    openWorker: (
      <Button variant="link" onClick={(e) => { e.preventDefault(); loopar.navigate(workerUrl(worker)); }}>
        <ExternalLink className="mr-2" /> Open worker
      </Button>
    ),
  } : {};

  return <FormLayout slots={SLOTS} actions={actions}>{children}</FormLayout>;
}
