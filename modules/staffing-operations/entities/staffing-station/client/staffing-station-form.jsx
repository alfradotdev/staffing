'use strict';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useForm, FormLayout } from '@loopar/form';
import { useFormValues } from '@form-context';
import { loopar } from 'loopar';
import { Button } from '@cn/components/ui/button';
import { Copy, MonitorSmartphone, TabletSmartphone } from 'lucide-react';

/** Pairing link as a QR to scan with the station's tablet, plus the link itself. */
function PairingDialog({ url, minutes }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }).then(setSvg).catch(() => setSvg(''));
  }, [url]);
  const copy = () => navigator.clipboard?.writeText(url).then(() => loopar.notify('Link copied.'));

  return (
    <div className="space-y-4 text-left">
      <p className="text-sm">
        Scan this code with the station's tablet or phone (or open the link on it). That device becomes this station
        and stays linked; the device linked before stops working.
      </p>
      {svg && <div className="mx-auto w-56 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />}
      <p className="text-center text-xs text-muted-foreground">Single use · expires in {minutes} minutes</p>
      <div className="flex gap-2">
        <input readOnly value={url} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs" onFocus={(e) => e.target.select()} />
        <Button type="button" variant="secondary" size="sm" onClick={copy}><Copy className="size-4" /></Button>
      </div>
    </div>
  );
}

/** A kiosk reports every 5 minutes (HEARTBEAT_MINUTES on the server); three missed reports = offline. */
const OFFLINE_MINUTES = 15;

const isOn = (v) => [1, '1', true, 'true'].includes(v);

function ago(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/**
 * `device_status` slot (Device card): linked or not, and whether the device is
 * reporting. `last_seen_ts` is set when a device is linked and on every report;
 * date fields can't tell (an empty date_time is stored as the save time).
 */
function DeviceStatus() {
  const { getValue } = useForm();
  const values = useFormValues() ?? {};
  const linkedAt = values.device_linked_at ?? getValue('device_linked_at');
  const seen = Number(values.last_seen_ts ?? getValue('last_seen_ts')) || 0;
  const active = isOn(values.active ?? getValue('active'));
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  if (!seen) {
    return <p className="text-sm text-muted-foreground">No device linked yet. Use <b>Link device</b> (from another device) or open this station on its tablet and use <b>Use this device as kiosk</b>.</p>;
  }

  const online = now - seen < OFFLINE_MINUTES * 60000;
  const badge = !active
    ? ['bg-muted text-muted-foreground', 'Station inactive']
    : online
      ? ['bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', 'Online']
      : ['bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', 'Offline'];

  return (
    <div className="space-y-1 text-sm">
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge[0]}`}>{badge[1]}</span>
      {linkedAt && <p>Linked {new Date(String(linkedAt).replace(' ', 'T')).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>}
      <p className="text-muted-foreground">Last activity: {ago(now - seen)}</p>
      {active && !online && (
        <p className="text-muted-foreground">
          Not reporting for {OFFLINE_MINUTES} minutes or more: the tablet may be off or offline, or it lost its link
          (browser data cleared). If it shows "not linked", link it again.
        </p>
      )}
    </div>
  );
}

const SLOTS = { device_status: DeviceStatus };

/**
 * Station form. Two ways to link the station's tablet: "Use this device as
 * kiosk" on the tablet itself (signed in as a supervisor, who is signed out
 * after) or "Link device" from any other device (single-use QR / link).
 */
export default function StaffingStationForm() {
  const { getValue } = useForm();
  const name = getValue('name');
  const active = isOn(getValue('active'));

  const link = (e) => {
    e.preventDefault();
    loopar.call('Staffing Station', 'linkDevice', {
      query: { name },
      success: (r) => loopar.dialog({
        type: 'info',
        icon: <MonitorSmartphone className="size-9 text-primary" />,
        title: 'Link a device',
        content: <PairingDialog url={r.url} minutes={r.minutes} />,
      }),
    });
  };

  const useThisDevice = (e) => {
    e.preventDefault();
    loopar.confirm(
      `This device becomes the station "${getValue('station_name') || name}" and you will be signed out. The device linked before stops working. Continue?`,
      () => loopar.call('Staffing Station', 'useThisDevice', {
        query: { name },
        success: (r) => { window.location.href = r.url; },
      })
    );
  };

  const actions = name ? {
    ...(active ? { thisDevice: <Button variant="secondary" onClick={useThisDevice}><TabletSmartphone className="mr-2 size-4" /> Use this device as kiosk</Button> } : {}),
    link: <Button variant="secondary" onClick={link}><MonitorSmartphone className="mr-2 size-4" /> Link device</Button>,
  } : {};
  return <FormLayout slots={SLOTS} actions={actions} />;
}
