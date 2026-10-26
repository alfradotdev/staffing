'use strict';

import { useForm, FormLayout } from '@loopar/form';
import { loopar } from 'loopar';
import { Button } from '@cn/components/ui/button';
import { Copy, IdCard, Smartphone } from 'lucide-react';
import { Barcode } from '../../../../staffing/shared/client/barcode.jsx';

function LinkDialog({ url, emailed, email }) {
  const copy = () => navigator.clipboard?.writeText(url).then(() => loopar.notify('Link copied.'));
  return (
    <div className="space-y-3 text-left">
      <p className="text-sm">
        {emailed ? `Emailed to ${email}. ` : 'Send this link to the worker (text or WhatsApp). '}
        Any previous clock link stopped working.
      </p>
      <div className="flex gap-2">
        <input readOnly value={url} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs" onFocus={(e) => e.target.select()} />
        <Button type="button" variant="secondary" size="sm" onClick={copy}><Copy className="size-4" /></Button>
      </div>
    </div>
  );
}

/** Printable badge: name, ID and the badge code as a Code 39 barcode (stations scan it). */
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function printBadge({ name, fullName, badge }) {
  const svg = document.getElementById('worker-badge-barcode')?.outerHTML || '';
  const win = window.open('', '_blank', 'width=420,height=320');
  if (!win) return;
  win.document.write(`<!doctype html><title>${esc(badge)}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;display:flex;justify-content:center}
.card{width:3.375in;height:2.125in;box-sizing:border-box;padding:.15in;border:1px dashed #999;display:flex;flex-direction:column;justify-content:space-between}
h1{font-size:15px;margin:0}p{margin:0;font-size:11px;color:#444}svg{width:100%;height:.8in}
@media print{.card{border:none}}</style>
<div class="card"><div><h1>${esc(fullName)}</h1><p>${esc(name)}</p></div>${svg}</div>
<script>window.onload=()=>{window.print()}</script>`);
  win.document.close();
}

/** Worker form + mobile clock link and printable badge. */
export default function StaffingWorkerForm() {
  const { getValue } = useForm();
  const name = getValue('name');
  const badge = getValue('badge_code');

  const sendLink = (e) => {
    e.preventDefault();
    loopar.confirm('Send a new clock-in link to this worker? The previous link will stop working.', () =>
      loopar.call('Staffing Worker', 'sendClockLink', {
        query: { name },
        success: (r) => {
          loopar.dialog({ type: 'alert', title: 'Clock-in link', content: <LinkDialog url={r.url} emailed={r.emailed} email={getValue('email')} /> });
          loopar.refresh();
        },
      }));
  };

  const badgeDialog = (e) => {
    e.preventDefault();
    loopar.dialog({
      type: 'alert',
      title: 'Badge',
      content: (
        <div className="space-y-3 text-left">
          <div className="rounded-md border bg-white p-3">
            <Barcode id="worker-badge-barcode" value={badge} className="h-24 w-full" />
          </div>
          <Button type="button" variant="secondary" onClick={() => printBadge({ name, fullName: getValue('full_name'), badge })}>
            Print badge
          </Button>
        </div>
      ),
    });
  };

  const actions = {};
  if (name) actions.clockLink = <Button variant="secondary" onClick={sendLink}><Smartphone className="mr-2 size-4" /> Clock link</Button>;
  if (name && badge) actions.badge = <Button variant="secondary" onClick={badgeDialog}><IdCard className="mr-2 size-4" /> Badge</Button>;

  return <FormLayout actions={actions} />;
}
