'use strict';

import crypto from 'crypto';
import { loopar, Op } from 'loopar';
import { addDays, today, num, toRows, parseDateTime, childRows, round2 } from './utils.js';
import { sha256, requestOrigin, pagePath } from './attendance.js';
import { shiftWindow } from '../../staffing-operations/entities/staffing-shift/staffing-shift.js';

/** Page of the station kiosk; a website menu row (router only) points at it. */
export const STATION_PAGE = 'Staffing Station Kiosk';

const isOn = (v) => [1, '1', true, 'true'].includes(v);
const nowISO = () => new Date().toISOString();

/** Scanned codes: trimmed, upper case, inner spaces removed. */
export const normalizeCode = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');

/* ---------------------------------------------------------------- VIN */

const VIN_VALUES = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** A 17-character VIN with a valid North American check digit (position 9). */
export function isVin(code) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(code)) return false;
  const sum = [...code].reduce((acc, ch, i) => acc + (/\d/.test(ch) ? Number(ch) : VIN_VALUES[ch]) * VIN_WEIGHTS[i], 0);
  const check = sum % 11 === 10 ? 'X' : String(sum % 11);
  return code[8] === check;
}

/**
 * Year, make and model from NHTSA's public vPIC service (free, no key).
 * Best effort: null when it's unreachable or slow.
 */
export async function decodeVin(vin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, { signal: controller.signal });
    const row = (await r.json())?.Results?.[0];
    if (!row?.Make) return null;
    return { year: row.ModelYear || '', make: row.Make || '', model: row.Model || '' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------ devices */

/** New kiosk link for a station (the previous one stops working). */
export async function issueDeviceLink(stationName) {
  const station = await loopar.getDocument('Staffing Station', stationName);
  const token = crypto.randomBytes(32).toString('base64url');
  station.device_token_hash = sha256(token);
  station.device_linked_at = nowISO();
  await station.save({ validate: false });
  return { url: `${requestOrigin()}${pagePath(STATION_PAGE, 'station')}?token=${token}` };
}

export async function stationByToken(token) {
  if (!token || String(token).length < 20) return null;
  const [row] = await loopar.db.getAll('Staffing Station', ['name'], { device_token_hash: sha256(token), active: 1 });
  if (!row) return null;
  await loopar.db.setValue('Staffing Station', 'last_seen_at', loopar.dateUtils.getDateTime(new Date(), 'DB'), row.name).catch(() => {});
  return await loopar.getDocument('Staffing Station', row.name);
}

/** Stages this station records, in process order: [{ stage, is_final, target_minutes }]. */
export async function stationStages(station) {
  const process = await loopar.getDocument('Staffing Process', station.process);
  const stages = toRows(await process.stages).map((s) => ({ stage: s.stage, is_final: isOn(s.is_final), target_minutes: num(s.target_minutes, null) }));
  const only = String(station.stages || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { all: stages, here: only.length ? stages.filter((s) => only.includes(s.stage.toLowerCase())) : stages };
}

/* ------------------------------------------------------------ workers */

/** Worker by badge, and the shift they are clocked in to at the station's site (when required). */
export async function identifyWorker(station, badge) {
  const code = normalizeCode(badge);
  const [row] = code ? await loopar.db.getAll('Staffing Worker', ['name', 'full_name', 'preferred_name', 'status'], { badge_code: code }) : [];
  if (!row || !['Active', 'Onboarding'].includes(row.status)) loopar.throw('Badge not recognized.');

  const shift = await activeShift(row.name, station.site);
  if (!shift && isOn(station.require_clock_in)) loopar.throw(`${row.preferred_name || row.full_name}: clock in to your shift at this site first.`);
  return { worker: row.name, full_name: row.preferred_name || row.full_name, shift };
}

/** The shift at `site` the worker is Checked In to right now, if any. */
async function activeShift(worker, site) {
  const date = today();
  const shifts = await loopar.db.getAll('Staffing Shift', ['id', 'name', 'shift_date', 'start_time', 'end_time'],
    { site, shift_date: { [Op.between]: [addDays(date, -1), date] }, status: { [Op.ne]: 'Cancelled' } });
  for (const s of shifts) {
    const seat = (await childRows('Staffing Shift Assignment', 'Staffing Shift', s.id, ['worker', 'status']))
      .find((a) => a.worker === worker && a.status === 'Checked In');
    if (seat) return s.name;
  }
  return null;
}

/* -------------------------------------------------------------- units */

/** What the station knows about a scanned unit and the stage it would record next. */
export async function unitInfo(station, rawCode) {
  const code = normalizeCode(rawCode);
  if (code.length < 3) loopar.throw('Scan a unit number, plate or VIN.');
  const unit = await loopar.db.getDoc('Staffing Unit', code, ['name', 'vin', 'year', 'make', 'model', 'current_stage', 'last_event_at']);
  const { all, here } = await stationStages(station);
  const index = unit?.current_stage ? all.findIndex((s) => s.stage === unit.current_stage) : -1;
  const next = all.slice(index + 1).find((s) => here.some((h) => h.stage === s.stage)) || here[0];
  return {
    code,
    known: !!unit,
    vin: unit?.vin || (isVin(code) ? code : null),
    description: unit ? [unit.year, unit.make, unit.model].filter(Boolean).join(' ') : '',
    current_stage: unit?.current_stage || null,
    last_event_at: parseDateTime(unit?.last_event_at)?.toISOString() || null,
    suggested_stage: next?.stage || null,
  };
}

/** Record that `badge` moved unit `code` to `stage` at the station. */
export async function recordEvent(station, { badge, code: rawCode, stage }) {
  const who = await identifyWorker(station, badge);
  const code = normalizeCode(rawCode);
  if (code.length < 3) loopar.throw('Scan a unit number, plate or VIN.');
  const { here } = await stationStages(station);
  const target = here.find((s) => s.stage === stage);
  if (!target) loopar.throw(`"${stage}" is not a stage of this station.`);

  const client = await loopar.db.getValue('Staffing Site', 'client', station.site, { ifNotFound: null });
  let unit = await loopar.getDocument('Staffing Unit', code, null, { ifNotFound: null });
  const isNew = !unit;
  if (isNew) {
    unit = await loopar.newDocument('Staffing Unit', { name: code, client, vin: isVin(code) ? code : null });
  }
  const previousAt = parseDateTime(unit.last_event_at);
  const now = new Date();

  const event = await loopar.newDocument('Staffing Unit Event', {
    unit: code, stage, event_at: now.toISOString(),
    worker: who.worker, station: station.name, shift: who.shift,
    site: station.site, client, process: station.process,
    minutes_since_previous: previousAt ? round2((now - previousAt) / 60000) : null,
    is_final: target.is_final ? 1 : 0,
  });

  if (isNew && unit.vin) {
    const decoded = await decodeVin(unit.vin);
    if (decoded) Object.assign(unit, decoded);
  }
  unit.current_stage = stage;
  unit.current_station = station.name;
  unit.last_event_at = now.toISOString();
  await unit.save({ validate: false });
  await event.save({ validate: false });

  return { event: event.name, worker: who.full_name, unit: await unitInfo(station, code) };
}

/* ------------------------------------------------------------ summary */

/** Today at this station: units per stage and per worker, finished units and average cycle. */
export async function stationToday(station) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const events = await loopar.db.getAll('Staffing Unit Event', ['unit', 'stage', 'worker', 'event_at', 'is_final', 'minutes_since_previous'],
    { station: station.name, event_at: { [Op.gte]: loopar.dateUtils.getDateTime(start, 'DB') } });
  const byStage = {};
  const byWorker = {};
  for (const e of events) {
    byStage[e.stage] = (byStage[e.stage] || 0) + 1;
    byWorker[e.worker] = (byWorker[e.worker] || 0) + 1;
  }
  const names = Object.keys(byWorker).length
    ? Object.fromEntries((await loopar.db.getAll('Staffing Worker', ['name', 'full_name', 'preferred_name'], { name: { [Op.in]: Object.keys(byWorker) } }))
      .map((w) => [w.name, w.preferred_name || w.full_name]))
    : {};
  return {
    events: events.length,
    by_stage: byStage,
    by_worker: Object.entries(byWorker).map(([w, n]) => ({ worker: names[w] || w, count: n })).sort((a, b) => b.count - a.count),
  };
}
