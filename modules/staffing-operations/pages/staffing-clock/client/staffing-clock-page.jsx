'use strict';

import { useCallback, useEffect, useState } from 'react';
import { loopar } from 'loopar';
import { Button } from '@cn/components/ui/button';
import { cn } from '@cn/lib/utils';
import { CheckCircle2, Clock, Loader2, LogIn, LogOut, MapPin, RefreshCw, XCircle } from 'lucide-react';

/** Web page: always opens at the top, never restores the scroll position. */
export const config = { restoreScroll: false };

const call = (action, body) => new Promise((resolve, reject) => {
  loopar.call('Staffing Worker', action, { body, freeze: false, success: resolve, error: reject });
});

const time = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

/** Current position from the phone, or {} when it can't be read (the server decides whether that's allowed). */
const locate = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve({});
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
    () => resolve({}),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
  );
});

const STATUS = {
  Assigned: 'bg-muted text-muted-foreground',
  Confirmed: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  'Checked In': 'bg-green-500/10 text-green-700 dark:text-green-300',
  Completed: 'bg-green-600 text-white',
};

function ShiftCard({ shift, busy, onClock }) {
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{day(shift.start)}</p>
          <p className="text-2xl font-bold">{time(shift.start)} – {time(shift.end)}</p>
          <p className="font-medium">{shift.position}</p>
        </div>
        <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', STATUS[shift.status])}>{shift.status}</span>
      </div>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 size-4 shrink-0" />
        <span>{shift.site}{shift.address ? ` · ${shift.address}` : ''}</span>
      </p>
      {(shift.check_in || shift.check_out) && (
        <p className="text-sm">
          {shift.check_in && <>In {time(shift.check_in)}</>}
          {shift.check_out && <> · Out {time(shift.check_out)}</>}
          {shift.hours ? <> · {shift.hours} h</> : null}
        </p>
      )}
      {shift.can_clock_in && (
        <Button size="lg" className="h-14 w-full text-lg" disabled={busy} onClick={() => onClock(shift, 'in')}>
          {busy ? <Loader2 className="mr-2 size-5 animate-spin" /> : <LogIn className="mr-2 size-5" />} Clock in
        </Button>
      )}
      {shift.can_clock_out && (
        <Button size="lg" variant="destructive" className="h-14 w-full text-lg" disabled={busy} onClick={() => onClock(shift, 'out')}>
          {busy ? <Loader2 className="mr-2 size-5 animate-spin" /> : <LogOut className="mr-2 size-5" />} Clock out
        </Button>
      )}
      {!shift.can_clock_in && !shift.can_clock_out && ['Assigned', 'Confirmed'].includes(shift.status) && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4" /> Clock-in opens at {time(shift.clock_in_opens)}.
        </p>
      )}
    </div>
  );
}

/** The worker's mobile clock, behind their personal link (`?token=`). */
export default function StaffingClockPage() {
  const [token, setToken] = useState('');
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback((t) => {
    call('clockStatus', { token: t })
      .then(setState)
      .catch((e) => setError(e?.message || 'This clock link is not valid.'));
  }, []);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || '';
    setToken(t);
    if (!t) { setError('This clock link is incomplete.'); return; }
    load(t);
  }, [load]);

  const onClock = async (shift, kind) => {
    setBusy(true); setNotice(null);
    const coords = await locate();
    call(kind === 'in' ? 'clockIn' : 'clockOut', { token, shift: shift.shift, lat: coords.lat, lng: coords.lng })
      .then((r) => {
        setState(r);
        const where = r.result?.distance != null ? ` (${r.result.distance} m from the site)` : '';
        setNotice({ ok: true, text: `Clocked ${kind} at ${time(new Date().toISOString())}${where}.` });
      })
      .catch((e) => setNotice({ ok: false, text: e?.message || 'Could not clock. Try again.' }))
      .finally(() => setBusy(false));
  };

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <XCircle className="mx-auto size-10 text-muted-foreground" />
        <p className="mt-4 text-lg font-semibold">{error}</p>
      </div>
    );
  }
  if (!state) return <div className="flex justify-center py-24"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">My shifts</p>
          <h1 className="text-2xl font-bold">Hi, {state.worker.full_name}</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={() => load(token)} aria-label="Refresh"><RefreshCw className="size-5" /></Button>
      </div>

      {notice && (
        <p className={cn('flex items-start gap-2 rounded-lg p-3 text-sm',
          notice.ok ? 'bg-green-50 text-green-900 dark:bg-green-900/30 dark:text-green-200' : 'bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-200')}>
          {notice.ok ? <CheckCircle2 className="size-5 shrink-0" /> : <XCircle className="size-5 shrink-0" />} {notice.text}
        </p>
      )}

      {state.shifts.length
        ? state.shifts.map((s) => <ShiftCard key={s.shift} shift={s} busy={busy} onClock={onClock} />)
        : (
          <div className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
            No shifts around now. Your supervisor will let you know when you're scheduled.
          </div>
        )}

      <p className="text-center text-xs text-muted-foreground">
        Your location is checked only when you clock in or out, to confirm you are at the site.
      </p>
    </div>
  );
}
