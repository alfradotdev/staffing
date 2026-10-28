'use strict';

import { useEffect, useState } from 'react';
import { useForm, FormLayout } from '@loopar/form';
import { useFormValues } from '@form-provider';
import { useDocument, useViewOptions } from '@loopar/document';
import { loopar } from 'loopar';
import { Button } from '@cn/components/ui/button';
import { Check, ExternalLink } from 'lucide-react';
import { cn } from '@cn/lib/utils';

const opportunityUrl = (name) => `/desk/Staffing Opportunity/update?name=${encodeURIComponent(name)}`;
const splitNames = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * `services` slot: one toggle per service published by the website serving the
 * request (the server resolves the web app, so any site app works), stored as
 * comma-separated Service names. On the website, `?service=<slug>` (the CTA of
 * each service page) preselects that service. Options load after mount, so SSR
 * and hydration match.
 */
function ServicesPicker({ data = {} }) {
  const { getValue, setValue } = useForm();
  const { Document } = useDocument();
  const { readOnly } = useViewOptions();
  // Read-only view, or a submitted website record (the server flags the field).
  const readMode = (readOnly ?? Document?.readOnly) === true || [1, '1', true].includes(data.readonly);
  // Reactive: the record's value arrives after mount and must show as selected.
  const formValues = useFormValues() ?? Document?.data ?? {};
  const selected = splitNames(formValues.services);
  const [services, setServices] = useState(null);

  const select = (names) => setValue('services', names.join(','));

  useEffect(() => {
    let alive = true;
    loopar.call('Service', 'publicList', { query: { page_size: 48 }, freeze: false })
      .then((r) => {
        if (!alive) return;
        const items = r?.items || [];
        setServices(items);
        const slug = !readMode && new URLSearchParams(window.location.search).get('service');
        const match = slug && items.find((s) => s.slug === slug);
        if (match && !splitNames(getValue('services')).length) select([match.name]);
      })
      .catch(() => alive && setServices([]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (name) => {
    select(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  };

  const titleOf = (name) => services?.find((s) => s.name === name)?.title || name;
  const label = <p className="text-sm font-medium leading-none">{data.label || 'Service of interest'}</p>;

  // View: only what was selected, as static badges.
  if (readMode) {
    return (
      <div className="space-y-2">
        {label}
        {selected.length ? (
          <div className="flex flex-wrap gap-2">
            {selected.map((n) => (
              <span key={n} className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary">
                {titleOf(n)}
              </span>
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
      {services === null ? (
        <p className="text-sm text-muted-foreground">Loading services…</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {services.map((s) => {
            const on = selected.includes(s.name);
            return (
              <button
                key={s.name}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(s.name)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
                )}
              >
                {on && <Check className="size-3.5" />}
                {s.title}
              </button>
            );
          })}
        </div>
      )}
      <p className="text-sm text-muted-foreground">Pick the services you are interested in. Not sure? Tell us in the description.</p>
    </div>
  );
}

const SLOTS = { services: ServicesPicker };

/**
 * Pipeline actions (Review, Create opportunity, Discard) come from the
 * workflow. This view adds the services picker and a shortcut to the
 * opportunity. `children` must be passed through: the website's contact_form
 * element renders this same component and injects the honeypot, captcha and
 * Send button as children.
 */
export default function StaffingInquiryForm({ children }) {
  const { getValue } = useForm();
  const opportunity = getValue('opportunity');

  const go = (e) => { e.preventDefault(); loopar.navigate(opportunityUrl(opportunity)); };
  const actions = opportunity
    ? { openOpportunity: <Button variant="link" onClick={go}><ExternalLink className="mr-2" /> Open opportunity</Button> }
    : {};

  return <FormLayout slots={SLOTS} actions={actions}>{children}</FormLayout>;
}
