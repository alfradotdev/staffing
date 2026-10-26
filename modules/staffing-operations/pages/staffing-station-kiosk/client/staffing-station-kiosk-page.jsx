'use strict';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loopar } from 'loopar';
import { Button } from '@cn/components/ui/button';
import { cn } from '@cn/lib/utils';
import { Camera, CheckCircle2, IdCard, Loader2, ScanLine, UserRoundX, XCircle } from 'lucide-react';

/** Web page: always opens at the top, never restores the scroll position. */
export const config = { restoreScroll: false };

/** A worker stays signed in at the station while scanning; idle this long, the next scan asks for a badge again. */
const IDLE_MS = 2 * 60 * 1000;

const call = (action, body) => new Promise((resolve, reject) => {
  loopar.call('Staffing Station', action, { body, freeze: false, success: resolve, error: reject });
});

const time = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');

/**
 * Camera scanning through the browser's BarcodeDetector (Chrome/Edge on
 * Android and desktop). Where it isn't available the button is hidden and
 * the input still takes USB/Bluetooth scanners (they type + Enter) or typing.
 */
function CameraScanner({ onCode, onClose }) {
  const video = useRef(null);
  useEffect(() => {
    let stream; let stop = false;
    const detector = new window.BarcodeDetector({ formats: ['code_39', 'code_128', 'qr_code', 'data_matrix', 'ean_13', 'pdf417'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const [hit] = await detector.detect(video.current).catch(() => []);
          if (hit?.rawValue) { onCode(hit.rawValue); break; }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        onClose();
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode, onClose]);

  return (
    <div className="space-y-2">
      <video ref={video} playsInline muted className="aspect-video w-full rounded-xl bg-black object-cover" />
      <Button variant="ghost" className="w-full" onClick={onClose}>Close camera</Button>
    </div>
  );
}

function ScanInput({ placeholder, onSubmit, busy }) {
  const input = useRef(null);
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  const canCamera = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices;

  useEffect(() => { if (!busy) input.current?.focus(); }, [busy, placeholder]);

  const submit = (v) => {
    const code = String(v ?? value).trim();
    if (!code) return;
    setValue('');
    onSubmit(code);
  };
  const onCode = useCallback((code) => { setCamera(false); submit(code); }, [onSubmit]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = useCallback(() => setCamera(false), []);

  return (
    <div className="space-y-3">
      {camera && <CameraScanner onCode={onCode} onClose={close} />}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="characters"
          disabled={busy}
          className="h-16 w-full rounded-xl border-2 border-input bg-background px-4 text-xl font-mono tracking-wider focus:border-primary focus:outline-none"
        />
        {canCamera && (
          <Button type="button" variant="secondary" className="h-16 w-16 shrink-0" onClick={() => setCamera((c) => !c)} aria-label="Scan with camera">
            <Camera className="size-6" />
          </Button>
        )}
      </form>
    </div>
  );
}

/** Station kiosk behind its device link (`?token=`): badge → unit → stage. */
export default function StaffingStationKioskPage() {
  const [token, setToken] = useState('');
  const [kiosk, setKiosk] = useState(null);
  const [error, setError] = useState('');
  const [who, setWho] = useState(null);       // { worker, full_name, badge }
  const [unit, setUnit] = useState(null);     // unitInfo
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || '';
    setToken(t);
    if (!t) { setError('This station link is incomplete.'); return; }
    call('kiosk', { token: t }).then(setKiosk).catch((e) => setError(e?.message || 'This station link is not valid.'));
  }, []);

  // Idle: sign the worker out of the station.
  useEffect(() => {
    if (!who) return undefined;
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_MS) { setWho(null); setUnit(null); }
    }, 5000);
    return () => clearInterval(timer);
  }, [who]);

  const run = (promise, onOk) => {
    setBusy(true); setNotice(null); lastActivity.current = Date.now();
    return promise.then(onOk).catch((e) => setNotice({ ok: false, text: e?.message || 'Try again.' })).finally(() => setBusy(false));
  };

  const scanBadge = (badge) => run(call('identify', { token, badge }), (r) => setWho({ ...r.who, badge }));
  const scanUnit = (code) => run(call('unit', { token, code }), (r) => setUnit(r.unit));
  const record = (stage) => run(call('record', { token, badge: who.badge, code: unit.code, stage }), (r) => {
    setKiosk((k) => ({ ...k, today: r.today }));
    setNotice({ ok: true, text: `${r.unit.code} → ${stage} · ${r.worker}` });
    setUnit(null);
  });

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <XCircle className="mx-auto size-10 text-muted-foreground" />
        <p className="mt-4 text-lg font-semibold">{error}</p>
      </div>
    );
  }
  if (!kiosk) return <div className="flex justify-center py-24"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;

  const { station, today } = kiosk;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-5">
        <div>
          <p className="text-sm text-muted-foreground">{station.site} · {station.process}</p>
          <h1 className="text-3xl font-bold">{station.station_name}</h1>
        </div>

        {notice && (
          <p className={cn('flex items-center gap-2 rounded-xl p-4 text-lg font-medium',
            notice.ok ? 'bg-green-50 text-green-900 dark:bg-green-900/30 dark:text-green-200' : 'bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-200')}>
            {notice.ok ? <CheckCircle2 className="size-6 shrink-0" /> : <XCircle className="size-6 shrink-0" />} {notice.text}
          </p>
        )}

        {!who && (
          <div className="space-y-3 rounded-2xl border bg-card p-5">
            <p className="flex items-center gap-2 text-lg font-semibold"><IdCard className="size-6 text-primary" /> Scan your badge</p>
            <ScanInput placeholder="Badge code" onSubmit={scanBadge} busy={busy} />
          </div>
        )}

        {who && !unit && (
          <div className="space-y-3 rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-lg font-semibold"><ScanLine className="size-6 text-primary" /> {who.full_name}: scan a vehicle</p>
              <Button variant="ghost" size="sm" onClick={() => { setWho(null); setNotice(null); }}><UserRoundX className="mr-2 size-4" /> Not me</Button>
            </div>
            <ScanInput placeholder="Unit number, plate or VIN" onSubmit={scanUnit} busy={busy} />
          </div>
        )}

        {who && unit && (
          <div className="space-y-4 rounded-2xl border bg-card p-5">
            <div>
              <p className="font-mono text-2xl font-bold tracking-wider">{unit.code}</p>
              <p className="text-sm text-muted-foreground">
                {unit.description || (unit.vin ? 'VIN' : unit.known ? '' : 'New unit')}
                {unit.current_stage ? ` · now: ${unit.current_stage} (${time(unit.last_event_at)})` : ''}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {station.stages.map((s) => (
                <Button
                  key={s.stage}
                  size="lg"
                  variant={s.stage === unit.suggested_stage ? 'default' : 'secondary'}
                  className="h-16 text-lg"
                  disabled={busy}
                  onClick={() => record(s.stage)}
                >
                  {s.stage}
                </Button>
              ))}
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setUnit(null)}>Cancel</Button>
          </div>
        )}
      </div>

      <aside className="space-y-4 self-start rounded-2xl border p-5">
        <p className="font-semibold">Today at this station</p>
        <p className="text-4xl font-bold">{today.events}<span className="ml-2 text-base font-normal text-muted-foreground">scans</span></p>
        <div className="space-y-1 text-sm">
          {station.stages.map((s) => (
            <div key={s.stage} className="flex justify-between"><span>{s.stage}</span><span className="font-semibold">{today.by_stage[s.stage] || 0}</span></div>
          ))}
        </div>
        {today.by_worker.length > 0 && (
          <div className="space-y-1 border-t pt-3 text-sm">
            {today.by_worker.map((w) => (
              <div key={w.worker} className="flex justify-between"><span>{w.worker}</span><span className="font-semibold">{w.count}</span></div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
