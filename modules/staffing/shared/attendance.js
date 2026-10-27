'use strict';

import crypto from 'crypto';
import { loopar, getRequest, Op } from 'loopar';
import { addDays, today, num, setting, parseDateTime, childRows, toRows } from './utils.js';
import { shiftWindow } from '../../staffing-operations/entities/staffing-shift/staffing-shift.js';

/** Page of the worker's mobile clock; a website menu row (router only) points at it. */
export const CLOCK_PAGE = 'Staffing Clock';

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const isOn = (v) => [1, '1', true, 'true'].includes(v);

/** Origin of the current request (proxy headers first). */
export function requestOrigin() {
  const req = getRequest();
  const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').split(',')[0].trim();
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || process.env.DOMAIN || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

/**
 * Kiosk path of a page from the active website's menu (`/kiosk/clock`): the
 * page without the site's navigation, for phones and station tablets.
 */
export function kioskPath(page, hint) {
  const item = (loopar.webApp?.menu_items || []).find((m) => m.page === page);
  if (!item?.link) loopar.throw(`The website has no page "${page}". Add a menu row (router only) with that page, e.g. link "${hint}".`);
  return `/kiosk/${item.link}`;
}

/** Great-circle distance in meters. */
export function distanceMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * New personal clock link for a worker (the previous one stops working),
 * emailed when the worker has an email. Returned so staff can text it.
 */
export async function issueClockLink(workerName) {
  const worker = await loopar.getDocument('Staffing Worker', workerName);
  const token = crypto.randomBytes(32).toString('base64url');
  const url = `${requestOrigin()}${kioskPath(CLOCK_PAGE, 'clock')}?token=${token}`;
  worker.clock_token_hash = sha256(token);
  worker.clock_link_sent_at = new Date().toISOString();
  await worker.save({ validate: false });

  let emailed = false;
  if (worker.email) {
    const company = await setting('company_name', 'Your employer');
    try {
      await loopar.mail.send({
        to: worker.email,
        subject: `${company}: your shift clock-in link`,
        html: `<p>Hi ${String(worker.preferred_name || worker.full_name || '').replace(/</g, '&lt;')},</p>
<p>Use this personal link on your phone to clock in and out of your shifts. Save it to your home screen and don't share it.</p>
<p><a href="${url}" style="background:#15803d;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open my clock</a></p>
<p style="color:#666;font-size:12px">${url}</p>`,
      });
      emailed = true;
    } catch (e) {
      console.warn(`[attendance] clock link email to ${worker.email} failed:`, e.message);
    }
  }
  return { url, emailed };
}

export async function workerByToken(token) {
  if (!token || String(token).length < 20) return null;
  const [row] = await loopar.db.getAll('Staffing Worker', ['name'], { clock_token_hash: sha256(token) });
  if (!row) return null;
  const worker = await loopar.getDocument('Staffing Worker', row.name);
  return ['Active', 'Onboarding'].includes(worker.status) ? worker : null;
}

const SHOWN = ['Assigned', 'Confirmed', 'Checked In', 'Completed'];

/** The worker's shifts around now (yesterday's overnight shift to tomorrow's early one). */
export async function workerShifts(worker, now = new Date()) {
  const early = num(await setting('clock_in_early_minutes', 30), 30) * 60000;
  const date = today();
  const shifts = await loopar.db.getAll('Staffing Shift',
    ['id', 'name', 'site', 'position', 'shift_date', 'start_time', 'end_time', 'break_minutes', 'status'],
    { shift_date: { [Op.between]: [addDays(date, -1), addDays(date, 1)] }, status: { [Op.ne]: 'Cancelled' } });

  const out = [];
  for (const s of shifts) {
    const seat = (await childRows('Staffing Shift Assignment', 'Staffing Shift', s.id, ['worker', 'status', 'check_in', 'check_out', 'hours']))
      .find((a) => a.worker === worker.name && SHOWN.includes(a.status));
    const window = shiftWindow(s);
    if (!seat || !window) continue;
    // Shown from 12h before the start until 6h after the end.
    if (now < new Date(window.start.getTime() - 12 * 3600000) || now > new Date(window.end.getTime() + 6 * 3600000)) continue;

    const site = await loopar.db.getDoc('Staffing Site', s.site, ['site_name', 'address', 'city', 'latitude', 'longitude', 'geofence_radius_m']);
    const opensAt = new Date(window.start.getTime() - early);
    out.push({
      shift: s.name,
      position: s.position,
      site: site?.site_name || s.site,
      address: [site?.address, site?.city].filter(Boolean).join(', '),
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      status: seat.status,
      check_in: parseDateTime(seat.check_in)?.toISOString() || null,
      check_out: parseDateTime(seat.check_out)?.toISOString() || null,
      hours: seat.hours,
      geofenced: num(site?.latitude, null) !== null && num(site?.longitude, null) !== null,
      can_clock_in: ['Assigned', 'Confirmed'].includes(seat.status) && now >= opensAt && now < window.end,
      clock_in_opens: opensAt.toISOString(),
      can_clock_out: seat.status === 'Checked In',
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Clock in/out: `kind` 'in' | 'out', `coords` { lat, lng, accuracy } from the
 * phone. The site's geofence (radius + GPS margin) is enforced when the site
 * has coordinates.
 */
export async function clock(worker, shiftName, kind, coords = {}) {
  const now = new Date();
  const mine = (await workerShifts(worker, now)).find((s) => s.shift === shiftName);
  if (!mine) loopar.throw('This shift is not available on your clock.');
  if (kind === 'in' && !mine.can_clock_in) {
    loopar.throw(['Checked In', 'Completed'].includes(mine.status)
      ? 'You already clocked in to this shift.'
      : `Clock-in opens at ${new Date(mine.clock_in_opens).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`);
  }
  if (kind === 'out' && !mine.can_clock_out) loopar.throw('Clock in first.');

  const shift = await loopar.getDocument('Staffing Shift', shiftName);
  const site = await loopar.db.getDoc('Staffing Site', shift.site, ['latitude', 'longitude', 'geofence_radius_m']);
  const lat = num(coords.lat, null);
  const lng = num(coords.lng, null);
  let distance = null;

  if (lat === null || lng === null) {
    if (isOn(await setting('clock_require_location', 1))) loopar.throw('Turn on location for this page to clock in or out.');
  } else if (mine.geofenced) {
    distance = Math.round(distanceMeters({ lat, lng }, { lat: num(site.latitude), lng: num(site.longitude) }));
    const allowed = num(site.geofence_radius_m, 150) + num(await setting('clock_gps_slack_m', 50), 50);
    if (distance > allowed) loopar.throw(`You are ${distance} m from the site. Clock ${kind} when you are on site (within ${allowed} m).`);
  }

  const list = toRows(await shift.assignments);
  const seat = list.find((a) => a.worker === worker.name);
  if (kind === 'in') {
    seat.check_in = now.toISOString();
    seat.check_in_distance_m = distance;
  } else {
    seat.check_out = now.toISOString();
    seat.check_out_distance_m = distance;
  }
  shift.assignments = list;
  await shift.save();
  return { distance };
}
