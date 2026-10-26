'use strict';

import { useForm, FormLayout } from '@loopar/form';
import { loopar } from 'loopar';
import { Button } from '@cn/components/ui/button';
import { Copy, MonitorSmartphone } from 'lucide-react';

function LinkDialog({ url }) {
  const copy = () => navigator.clipboard?.writeText(url).then(() => loopar.notify('Link copied.'));
  return (
    <div className="space-y-3 text-left">
      <p className="text-sm">Open this link on the station's tablet or phone and add it to the home screen. Any device linked before stops working.</p>
      <div className="flex gap-2">
        <input readOnly value={url} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs" onFocus={(e) => e.target.select()} />
        <Button type="button" variant="secondary" size="sm" onClick={copy}><Copy className="size-4" /></Button>
      </div>
    </div>
  );
}

/** Station form + "Link device": the kiosk link for the station's tablet. */
export default function StaffingStationForm() {
  const { getValue } = useForm();
  const name = getValue('name');

  const link = (e) => {
    e.preventDefault();
    loopar.confirm('Link a device to this station? The device linked before will stop working.', () =>
      loopar.call('Staffing Station', 'linkDevice', {
        query: { name },
        success: (r) => {
          loopar.dialog({ type: 'alert', title: 'Station link', content: <LinkDialog url={r.url} /> });
          loopar.refresh();
        },
      }));
  };

  const actions = name ? { link: <Button variant="secondary" onClick={link}><MonitorSmartphone className="mr-2 size-4" /> Link device</Button> } : {};
  return <FormLayout actions={actions} />;
}
