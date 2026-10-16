'use strict';

import { PageLayout } from '@loopar/page';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@cn/lib/utils';
import {
  Activity, AlertTriangle, CalendarClock, CheckCircle2, Clock, Coffee, DollarSign,
  MapPin, Radio, RefreshCw, ShieldCheck, Smartphone, UserCheck, Users,
} from 'lucide-react';

/*
 * Client Portal — DEMO.
 * What a staffing customer would see live for its site: who is on shift,
 * coverage per role, attendance events and the hours that will be billed.
 * All data is simulated in the browser; nothing is read from or written to
 * the database. The initial state is fixed (SSR == first client render);
 * the simulation only starts after mount, so hydration stays clean.
 */

const SITE = { name: 'Rental Car Center', area: 'Atlanta Airport (ATL)', shift: 'Morning shift · 6:00 AM – 2:30 PM' };

const ROLES = [
  { key: 'driver', label: 'Shuttle Drivers', rate: 24.5 },
  { key: 'porter', label: 'Lot Porters', rate: 19.75 },
  { key: 'detail', label: 'Car Wash & Detail', rate: 18.5 },
  { key: 'clean', label: 'Cleaning Crew', rate: 17.75 },
];

// Fixed roster for the demo (fictional names).
const ROSTER = [
  ['Marcus Hill', 'driver', 'Shuttle Loop A'], ['Ana Torres', 'driver', 'Shuttle Loop A'],
  ['DeShawn Price', 'driver', 'Shuttle Loop B'], ['Luis Mejía', 'driver', 'Shuttle Loop B'],
  ['Kayla Brooks', 'driver', 'Terminal Run'], ['Omar Haddad', 'driver', 'Terminal Run'],
  ['Jasmine Reed', 'porter', 'Ready Line'], ['Carlos Ruiz', 'porter', 'Ready Line'],
  ['Tyler Grant', 'porter', 'Returns'], ['Brianna Cole', 'porter', 'Returns'],
  ['Hector Vargas', 'porter', 'Overflow Lot'], ['Nia Johnson', 'porter', 'Overflow Lot'],
  ['Andre Wallace', 'porter', 'Fuel Station'], ['María González', 'detail', 'Wash Bay 1'],
  ['Kevin Tran', 'detail', 'Wash Bay 1'], ['Rosa Díaz', 'detail', 'Wash Bay 2'],
  ['Jamal Carter', 'detail', 'Wash Bay 2'], ['Sofía Herrera', 'detail', 'Interior Prep'],
  ['Ethan Moore', 'detail', 'Interior Prep'], ['Grace Kim', 'clean', 'Counters'],
  ['Victor Santos', 'clean', 'Restrooms'], ['Lena Fischer', 'clean', 'Office & Break Room'],
];

// Initial status per worker: on (on site), break, late, scheduled (not yet in), replacement
const INITIAL_STATUS = ['on', 'on', 'on', 'on', 'late', 'on', 'on', 'on', 'on', 'break', 'on', 'scheduled',
  'on', 'on', 'on', 'on', 'scheduled', 'on', 'on', 'on', 'on', 'break'];
const INITIAL_IN = ['5:52', '5:55', '5:58', '6:01', null, '5:57', '5:49', '5:54', '6:00', '5:59', '5:56', null,
  '5:53', '5:50', '5:58', '6:02', null, '5:55', '5:57', '5:51', '5:59', '6:00'];

const WEEK = [
  { day: 'Mon', hours: 172 }, { day: 'Tue', hours: 176 }, { day: 'Wed', hours: 168 },
  { day: 'Thu', hours: 181 }, { day: 'Fri', hours: 0 }, { day: 'Sat', hours: 0 }, { day: 'Sun', hours: 0 },
];
const TODAY_INDEX = 4;

const INITIAL_FEED = [
  { time: '6:02', icon: 'in', text: 'Luis Mejía checked in at Shuttle Loop B (GPS verified)' },
  { time: '6:01', icon: 'alert', text: 'Kayla Brooks is late for Terminal Run — supervisor notified' },
  { time: '6:00', icon: 'in', text: 'Tyler Grant checked in at Returns (QR scan)' },
  { time: '5:59', icon: 'break', text: 'Brianna Cole started a 15-min break' },
  { time: '5:58', icon: 'in', text: 'DeShawn Price checked in at Shuttle Loop B (GPS verified)' },
];

const STATUS = {
  on: { label: 'On site', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  break: { label: 'On break', cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  late: { label: 'Late', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  scheduled: { label: 'Not in yet', cls: 'bg-muted text-muted-foreground' },
  replacement: { label: 'Replacement en route', cls: 'bg-primary/15 text-primary' },
};

const FEED_ICONS = { in: CheckCircle2, alert: AlertTriangle, break: Coffee, swap: RefreshCw, out: Clock };

function initialWorkers() {
  return ROSTER.map(([name, role, zone], i) => ({
    id: i, name, role, zone, status: INITIAL_STATUS[i], checkIn: INITIAL_IN[i],
  }));
}

function fmtMoney(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function clockLabel(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')}`;
}

function meridiem(minutes) {
  return Math.floor(minutes / 60) % 24 < 12 ? 'AM' : 'PM';
}

function Kpi({ icon: Icon, label, value, hint, accent }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 md:p-4 flex items-start gap-3 min-w-0">
      <div className={cn('rounded-lg p-2', accent ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xl md:text-2xl font-bold text-foreground leading-tight truncate">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, right, children, className }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4 min-w-0', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-3">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          {Icon && <Icon className="w-4 h-4 text-primary" />}
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function StaffingPortal() {
  const [workers, setWorkers] = useState(initialWorkers);
  const [feed, setFeed] = useState(INITIAL_FEED);
  const [minute, setMinute] = useState(6 * 60 + 2); // simulated clock: 6:02 AM
  const [live, setLive] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const workersRef = useRef(workers);
  workersRef.current = workers;
  const minuteRef = useRef(minute);

  // Simulation: every few seconds the clock advances and one event happens.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
        const next = minuteRef.current + 3;
        minuteRef.current = next;
        const t = clockLabel(next);
        const ws = workersRef.current;
        const pick = (pred) => {
          const list = ws.filter(pred);
          return list.length ? list[Math.floor(Math.random() * list.length)] : null;
        };
        const roll = Math.random();
        let event = null;
        let patch = null;

        const waiting = pick((w) => w.status === 'scheduled' || w.status === 'late' || w.status === 'replacement');
        if (waiting && roll < 0.45) {
          patch = { id: waiting.id, status: 'on', checkIn: t };
          event = { icon: 'in', text: `${waiting.name} checked in at ${waiting.zone} (${Math.random() < 0.6 ? 'GPS verified' : 'QR scan'})` };
        } else if (roll < 0.7) {
          const onBreak = pick((w) => w.status === 'break');
          if (onBreak) {
            patch = { id: onBreak.id, status: 'on' };
            event = { icon: 'in', text: `${onBreak.name} is back from break` };
          } else {
            const working = pick((w) => w.status === 'on');
            if (working) {
              patch = { id: working.id, status: 'break' };
              event = { icon: 'break', text: `${working.name} started a 15-min break` };
            }
          }
        } else if (roll < 0.85) {
          const late = pick((w) => w.status === 'late');
          if (late) {
            patch = { id: late.id, status: 'replacement' };
            event = { icon: 'swap', text: `Replacement dispatched for ${late.zone} — ETA 12 min` };
          } else {
            const working = pick((w) => w.status === 'on');
            if (working) {
              event = { icon: 'in', text: `Supervisor walk-through completed at ${working.zone}` };
            }
          }
        } else {
          const working = pick((w) => w.status === 'on');
          if (working) {
            event = { icon: 'in', text: `${ROLES.find((r) => r.key === working.role).label}: ${Math.floor(Math.random() * 6) + 3} vehicles moved at ${working.zone}` };
          }
        }

        setMinute(next);
        if (patch) setWorkers((prev) => prev.map((w) => (w.id === patch.id ? { ...w, ...patch } : w)));
        if (event) setFeed((prev) => [{ time: t, ...event }, ...prev].slice(0, 8));
    }, 3500);
    return () => clearInterval(id);
  }, [live]);

  const stats = useMemo(() => {
    const onSite = workers.filter((w) => w.status === 'on' || w.status === 'break').length;
    const late = workers.filter((w) => w.status === 'late').length;
    const replacements = workers.filter((w) => w.status === 'replacement').length;
    const byRole = ROLES.map((r) => {
      const all = workers.filter((w) => w.role === r.key);
      const covered = all.filter((w) => w.status === 'on' || w.status === 'break').length;
      return { ...r, scheduled: all.length, covered };
    });
    const elapsedHours = Math.max(0, (minute - 6 * 60) / 60);
    const todayHours = Math.round(onSite * elapsedHours * 10) / 10;
    const week = WEEK.map((d, i) => (i === TODAY_INDEX ? { ...d, hours: Math.round(todayHours), today: true } : d));
    const weekHours = week.reduce((a, d) => a + d.hours, 0);
    const avgRate = ROLES.reduce((a, r) => a + r.rate, 0) / ROLES.length;
    return {
      onSite, late, replacements, byRole, week, weekHours,
      coverage: Math.round((onSite / workers.length) * 100),
      billing: weekHours * avgRate,
    };
  }, [workers, minute]);

  const maxWeek = Math.max(...stats.week.map((d) => d.hours), 1);

  return (
    <div className="w-full min-w-0 flex justify-center">
    <div className="w-full min-w-0 max-w-7xl px-4 py-6 md:py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-primary uppercase tracking-wider text-xs font-semibold mb-1">Client Portal · Demo</div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">{SITE.name}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
            <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4" />{SITE.area}</span>
            <span className="inline-flex items-center gap-1"><CalendarClock className="w-4 h-4" />{SITE.shift}</span>
          </div>
        </div>
        <div className="flex items-center justify-between md:justify-end gap-3">
          <div className="md:text-right">
            <div className="text-xs text-muted-foreground">Site time</div>
            <div className="text-2xl font-bold tabular-nums text-foreground">{clockLabel(minute)} {meridiem(minute)}</div>
          </div>
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold border',
              live ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground'
            )}
          >
            <span className="relative flex h-2.5 w-2.5">
              {live && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />}
              <span className={cn('relative inline-flex rounded-full h-2.5 w-2.5', live ? 'bg-primary' : 'bg-muted-foreground')} />
            </span>
            {live ? 'LIVE' : 'Paused'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
        <Kpi icon={Users} label="On site now" value={`${stats.onSite}/${workers.length}`} hint="Checked in by phone" accent />
        <Kpi icon={ShieldCheck} label="Coverage" value={`${stats.coverage}%`} hint="Of scheduled positions" accent />
        <Kpi icon={AlertTriangle} label="Late" value={stats.late} hint="Supervisor notified" />
        <Kpi icon={RefreshCw} label="Replacements" value={stats.replacements} hint="En route to site" />
        <Kpi icon={DollarSign} label="Billing this week" value={fmtMoney(stats.billing)} hint={`${stats.weekHours.toLocaleString('en-US')} hours so far`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-w-0">
        {/* Roster */}
        <Panel
          title="Who is on shift"
          icon={UserCheck}
          className="lg:col-span-2 min-w-0"
          right={<span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Smartphone className="w-3.5 h-3.5" />GPS / QR check-in</span>}
        >
          {/* Mobile: one compact card per worker */}
          <ul className="md:hidden divide-y divide-border/60">
            {(showAll ? workers : workers.slice(0, 8)).map((w) => (
              <li key={w.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{w.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {ROLES.find((r) => r.key === w.role).label} · {w.zone}{w.checkIn ? ` · in ${w.checkIn}` : ''}
                  </div>
                </div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', STATUS[w.status].cls)}>
                  {STATUS[w.status].label}
                </span>
              </li>
            ))}
          </ul>
          {workers.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="md:hidden w-full mt-2 py-2 text-sm font-semibold text-primary rounded-lg border border-border"
            >
              {showAll ? 'Show less' : `Show all (${workers.length})`}
            </button>
          )}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm border-0 [&_th]:border-0 [&_td]:border-x-0 [&_td]:border-t-0">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-medium">Worker</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Zone</th>
                  <th className="py-2 pr-3 font-medium">In</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <tr key={w.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-3 font-medium text-foreground whitespace-nowrap">{w.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{ROLES.find((r) => r.key === w.role).label}</td>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{w.zone}</td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">{w.checkIn || '—'}</td>
                    <td className="py-2">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', STATUS[w.status].cls)}>
                        {STATUS[w.status].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4 min-w-0">
          {/* Coverage by role */}
          <Panel title="Coverage by role" icon={ShieldCheck}>
            <div className="space-y-3">
              {stats.byRole.map((r) => {
                const pct = Math.round((r.covered / r.scheduled) * 100);
                return (
                  <div key={r.key}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-foreground">{r.label}</span>
                      <span className="tabular-nums text-muted-foreground">{r.covered}/{r.scheduled}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-700', pct === 100 ? 'bg-primary' : 'bg-amber-500')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Activity feed */}
          <Panel title="Live activity" icon={Activity} right={<Radio className="w-4 h-4 text-primary" />}>
            <ul className="space-y-2.5">
              {feed.map((e, i) => {
                const Icon = FEED_ICONS[e.icon] || Clock;
                return (
                  <li key={`${e.time}-${i}-${e.text}`} className="flex gap-2 text-sm">
                    <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', e.icon === 'alert' ? 'text-amber-500' : 'text-primary')} />
                    <div className="min-w-0">
                      <span className="tabular-nums text-muted-foreground mr-1.5">{e.time}</span>
                      <span className="text-foreground">{e.text}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>

      {/* Hours this week */}
      <Panel
        title="Billable hours this week"
        icon={Clock}
        right={<span className="text-sm text-muted-foreground">Approved hours feed the weekly invoice automatically</span>}
      >
        <div className="grid grid-cols-7 gap-1.5 md:gap-2 items-end h-40">
          {stats.week.map((d) => (
            <div key={d.day} className="flex flex-col items-center justify-end h-full gap-1">
              <span className="text-xs tabular-nums text-muted-foreground">{d.hours || ''}</span>
              <div
                className={cn('w-full max-w-12 rounded-t-md transition-all duration-700', d.today ? 'bg-primary' : 'bg-primary/40')}
                style={{ height: `${Math.max(2, (d.hours / maxWeek) * 100)}%` }}
              />
              <span className={cn('text-xs', d.today ? 'text-primary font-semibold' : 'text-muted-foreground')}>{d.day}</span>
            </div>
          ))}
        </div>
      </Panel>

      <p className="text-xs text-center text-muted-foreground">
        Demo with simulated data. In production every number comes from real check-ins, schedules and approved timesheets.
      </p>
    </div>
    </div>
  );
}

const SLOTS = { portal: () => <StaffingPortal /> };

export default function StaffingPortalPage() {
  return <PageLayout slots={SLOTS} />;
}
