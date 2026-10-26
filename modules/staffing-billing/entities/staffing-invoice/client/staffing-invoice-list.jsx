'use strict';

import { ListLayout } from '@loopar/list';
import { loopar } from 'loopar';
import { Button } from '@cn/components/ui/button';
import { Receipt } from 'lucide-react';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lastWeek = () => {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
};
const INPUT = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm';

/** Invoice list + "Generate invoices": one Draft per client from the unbilled approved hours of a period. */
export default function StaffingInvoiceList() {
  const generate = (e) => {
    e.preventDefault();
    const values = lastWeek();
    loopar.dialog({
      type: 'confirm',
      title: 'Generate invoices',
      content: (
        <div className="grid grid-cols-2 gap-3 text-left">
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Service from</span>
            <input type="date" defaultValue={values.from} className={INPUT} onChange={(ev) => { values.from = ev.target.value; }} />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Service to</span>
            <input type="date" defaultValue={values.to} className={INPUT} onChange={(ev) => { values.to = ev.target.value; }} />
          </label>
          <p className="col-span-2 text-xs text-muted-foreground">
            Bills approved timesheet hours of the period that no invoice billed yet, one Draft invoice per client.
          </p>
        </div>
      ),
      ok: () => loopar.call('Staffing Invoice', 'generate', {
        body: values,
        success: (r) => {
          loopar.notify(r.created?.length ? `Created ${r.created.join(', ')} (${r.lines} timesheet lines).` : 'Nothing to bill in that period.');
          loopar.refresh();
        },
      }),
    });
  };

  return (
    <ListLayout
      actions={{
        generateInvoices: (
          <Button key="generateInvoices" variant="secondary" onClick={generate}>
            <Receipt className="mr-2 size-4" /> Generate invoices
          </Button>
        ),
      }}
    />
  );
}
