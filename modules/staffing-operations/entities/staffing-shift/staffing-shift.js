'use strict';

import { BaseDocument, loopar, Op } from 'loopar';
import { toRows, num, round2, addDays, parseDateTime, hoursBetween, childRows } from '../../../staffing/shared/utils.js';
import { isQualified } from '../../../staffing/shared/rates.js';

/** Assignment states that hold a seat on the shift. */
const ACTIVE = ['Assigned', 'Confirmed', 'Checked In', 'Completed'];

/** Start/end Dates of a shift; an end at or before the start ends the next day. */
export function shiftWindow({ shift_date, start_time, end_time }) {
  if (!shift_date || !start_time || !end_time) return null;
  const date = String(shift_date).slice(0, 10);
  const start = new Date(`${date}T${String(start_time).slice(0, 8)}`);
  let end = new Date(`${date}T${String(end_time).slice(0, 8)}`);
  if (isNaN(start) || isNaN(end)) return null;
  if (end <= start) end = new Date(end.getTime() + 86400000);
  return { start, end };
}

/** Paid hours of a span: the unpaid break only applies to spans longer than 5h. */
const paidHours = (start, end, breakMinutes) => {
  const gross = hoursBetween(start, end);
  return Math.max(0, round2(gross > 5 ? gross - breakMinutes / 60 : gross));
};

export default class StaffingShift extends BaseDocument {
  constructor(props) {
    super(props);
  }

  async beforeSave() {
    if (this.site) this.client = await loopar.db.getValue('Staffing Site', 'client', this.site, { ifNotFound: null });

    const window = shiftWindow(this);
    if (!window) loopar.throw('Set the date, start and end of the shift.');
    const breakMinutes = Math.max(0, num(this.break_minutes, 0));
    this.scheduled_hours = paidHours(window.start, window.end, breakMinutes);
    this.headcount = Math.max(1, parseInt(this.headcount) || 1);

    const rows = toRows(await this.assignments);
    for (const row of rows) row.status = row.status || 'Assigned';
    await this.#validateAssignments(rows, window);

    for (const row of rows) {
      const checkIn = parseDateTime(row.check_in);
      const checkOut = parseDateTime(row.check_out);
      if (checkIn && checkOut && checkOut <= checkIn) loopar.throw(`${row.worker}: check out must be after check in.`);

      // Times move the assignment forward; explicit No Show / Cancelled stay.
      if (checkOut && ['Assigned', 'Confirmed', 'Checked In'].includes(row.status)) row.status = 'Completed';
      else if (checkIn && ['Assigned', 'Confirmed'].includes(row.status)) row.status = 'Checked In';

      row.hours = checkIn && checkOut
        ? paidHours(checkIn, checkOut, breakMinutes)
        : row.status === 'Completed' ? this.scheduled_hours : null;
      row.check_in = row.check_in || null;
      row.check_out = row.check_out || null;
    }
    this.assignments = rows;

    const active = rows.filter(r => ACTIVE.includes(r.status));
    this.assigned_count = active.length;

    if (this.status !== 'Cancelled') {
      this.status = active.length && active.every(r => r.status === 'Completed') ? 'Completed'
        : active.length >= this.headcount ? 'Filled'
        : active.length ? 'Partially Filled'
        : 'Open';
    }
  }

  async #validateAssignments(rows, window) {
    const active = rows.filter(r => ACTIVE.includes(r.status));
    if (active.length > this.headcount) {
      loopar.throw(`The shift needs ${this.headcount} worker(s) and has ${active.length} assigned.`);
    }

    const seen = new Set();
    for (const row of rows) {
      if (!row.worker) loopar.throw('Every assignment needs a worker.');
      if (seen.has(row.worker)) loopar.throw(`${row.worker} is assigned twice to this shift.`);
      seen.add(row.worker);
    }

    for (const row of active) {
      const worker = await loopar.db.getDoc('Staffing Worker', row.worker, ['full_name', 'status']);
      if (!worker) loopar.throw(`Worker ${row.worker} does not exist.`);
      const label = `${worker.full_name} (${row.worker})`;
      if (!['Active', 'Onboarding'].includes(worker.status)) loopar.throw(`${label} is ${worker.status} and can't be scheduled.`);
      if (!(await isQualified(row.worker, this.position))) loopar.throw(`${label} is not qualified as ${this.position}.`);
      if (await this.#overlaps(row.worker, window)) loopar.throw(`${label} already works another shift at that time.`);
    }
  }

  /** Whether `worker` holds a seat on another shift that overlaps `window`. */
  async #overlaps(worker, window) {
    const date = String(this.shift_date).slice(0, 10);
    const shifts = await loopar.db.getAll('Staffing Shift', ['id', 'name', 'shift_date', 'start_time', 'end_time'], {
      shift_date: { [Op.between]: [addDays(date, -1), addDays(date, 1)] },
      status: { [Op.ne]: 'Cancelled' },
    });
    for (const s of shifts) {
      if (s.name === this.name) continue;
      const other = shiftWindow(s);
      if (!other || other.start >= window.end || other.end <= window.start) continue;
      const seats = await childRows('Staffing Shift Assignment', 'Staffing Shift', s.id, ['worker', 'status']);
      if (seats.some(a => a.worker === worker && ACTIVE.includes(a.status))) return true;
    }
    return false;
  }
}
