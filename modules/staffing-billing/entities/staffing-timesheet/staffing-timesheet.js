'use strict';

import { BaseDocument, loopar, Op, applyTransition } from 'loopar';
import { toRows, num, round2, addDays, mondayOf, setting } from '../../../staffing/shared/utils.js';
import { ratesFor } from '../../../staffing/shared/rates.js';

/**
 * Weekly hours of one worker. While Draft, the lines are rebuilt from the
 * worker's Completed shift assignments of the week (Monday to Sunday);
 * after Submit they are frozen and move through the workflow
 * (Draft → Submitted → Approved → Exported).
 *
 * Overtime: hours above Settings.overtime_threshold_hours in the week. Pay
 * and billing use the FLSA regular-rate approach: every hour at its own rate,
 * plus the overtime premium (multiplier − 1) on the weighted average rate.
 */
export default class StaffingTimesheet extends BaseDocument {
  constructor(props) {
    super(props);
  }

  async beforeSave() {
    // Submitted or later: the hours are frozen. Whatever the form sends, the
    // stored worker, week and lines stay (Reject reopens it as a Draft).
    const frozen = !this.__IS_NEW__ && (this.status || 'Draft') !== 'Draft'
      ? await loopar.db.getDoc('Staffing Timesheet', this.__DOCUMENT_NAME__, ['id', 'worker', 'week_start'])
      : null;
    if (frozen) {
      this.worker = frozen.worker;
      this.week_start = frozen.week_start;
    }

    if (!this.week_start) loopar.throw('Set the week.');
    this.week_start = mondayOf(this.week_start);

    const others = await loopar.db.getAll('Staffing Timesheet', ['name'], { worker: this.worker, week_start: this.week_start });
    if (others.some(t => t.name !== this.name)) {
      loopar.throw(`${this.worker} already has a timesheet for the week of ${this.week_start}.`);
    }

    if (frozen) {
      const rows = await loopar.db.getAll('Staffing Timesheet Line', ['*'], { parent_document: 'Staffing Timesheet', parent_id: frozen.id });
      this.lines = rows.map(({ id, name, parent_id, parent_document, ...line }) => line);
    } else {
      this.lines = await this.buildLines();
    }
    await this.computeTotals();
  }

  /** Approved hours feed payroll and invoices: every line needs its rates. */
  async beforeTransition(transition) {
    if (transition.to !== 'Approved') return;
    const lines = toRows(await this.lines);
    if (!lines.length) loopar.throw('The timesheet has no hours to approve.');
    const missing = lines.filter(l => !num(l.bill_rate) || !num(l.pay_rate));
    if (missing.length) {
      const days = missing.map(l => `${l.work_date} (${l.position})`).join(', ');
      loopar.throw(`Missing pay or bill rate on ${days}. Activate a rate agreement that covers those dates, or set the position's default rates, then reject and rebuild the timesheet.`);
    }
  }

  /** Lines from the worker's completed assignments of the week. */
  async buildLines() {
    const from = this.week_start, to = addDays(this.week_start, 6);
    const shifts = await loopar.db.getAll('Staffing Shift',
      ['id', 'name', 'site', 'client', 'position', 'shift_date'],
      { shift_date: { [Op.between]: [from, to] }, status: { [Op.ne]: 'Cancelled' } });
    if (!shifts.length) return [];

    const byId = Object.fromEntries(shifts.map(s => [s.id, s]));
    const seats = await loopar.db.getAll('Staffing Shift Assignment', ['parent_id', 'hours'], {
      parent_document: 'Staffing Shift',
      parent_id: { [Op.in]: shifts.map(s => s.id) },
      worker: this.worker,
      status: 'Completed',
    });

    const lines = [];
    for (const seat of seats) {
      const shift = byId[seat.parent_id];
      if (!shift) continue;
      const rates = await ratesFor({ client: shift.client, site: shift.site, position: shift.position, worker: this.worker, date: shift.shift_date });
      lines.push({
        work_date: String(shift.shift_date).slice(0, 10),
        shift: shift.name,
        site: shift.site,
        position: shift.position,
        hours: round2(num(seat.hours)),
        pay_rate: rates.pay_rate,
        bill_rate: rates.bill_rate,
        overtime_multiplier: rates.overtime_multiplier,
      });
    }
    return lines.sort((a, b) => a.work_date.localeCompare(b.work_date));
  }

  async computeTotals() {
    const lines = toRows(await this.lines);
    const threshold = num(await setting('overtime_threshold_hours', 40), 40);

    const total = round2(lines.reduce((s, l) => s + num(l.hours), 0));
    const overtime = round2(Math.max(0, total - threshold));
    const basePay = lines.reduce((s, l) => s + num(l.hours) * num(l.pay_rate), 0);
    const baseBill = lines.reduce((s, l) => s + num(l.hours) * num(l.bill_rate), 0);
    const multiplier = Math.max(...lines.map(l => num(l.overtime_multiplier, 1.5)), 1.5);
    const premium = (base) => total ? (base / total) * (multiplier - 1) * overtime : 0;

    this.total_hours = total;
    this.overtime_hours = overtime;
    this.regular_hours = round2(total - overtime);
    this.gross_pay = round2(basePay + premium(basePay));
    this.billable_amount = round2(baseBill + premium(baseBill));
  }

  /**
   * Payroll export of the Approved timesheets of the week of `weekStart`:
   * one CSV row per worker (payroll ID, hours, average rate, regular/overtime
   * pay) in a generic layout most payroll providers import. Each exported
   * timesheet moves to Exported with the batch id.
   */
  static async exportPayroll(weekStart) {
    const week = mondayOf(weekStart);
    const sheets = await loopar.db.getAll('Staffing Timesheet',
      ['name', 'worker', 'regular_hours', 'overtime_hours', 'total_hours', 'gross_pay'], { week_start: week, status: 'Approved' });
    if (!sheets.length) loopar.throw(`There are no Approved timesheets for the week of ${week}.`);

    const batch = `PAY-${week}-${Date.now().toString(36).toUpperCase()}`;
    const esc = (v) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
    const header = ['employee_id', 'worker', 'name', 'week_start', 'regular_hours', 'overtime_hours', 'avg_pay_rate', 'regular_pay', 'overtime_pay', 'gross_pay', 'timesheet'];
    const rows = [header];
    const threshold = num(await setting('overtime_threshold_hours', 40), 40);

    for (const t of sheets) {
      const worker = await loopar.db.getDoc('Staffing Worker', t.worker, ['full_name', 'payroll_id']);
      const total = num(t.total_hours), overtime = num(t.overtime_hours);
      const doc = await loopar.getDocument('Staffing Timesheet', t.name);
      const lines = toRows(await doc.lines);
      const base = lines.reduce((s, l) => s + num(l.hours) * num(l.pay_rate), 0);
      const avg = total ? base / total : 0;
      const multiplier = Math.max(...lines.map(l => num(l.overtime_multiplier, 1.5)), 1.5);
      const regular = round2(avg * Math.min(total, threshold));
      const overtimePay = round2(avg * multiplier * overtime);
      rows.push([worker?.payroll_id || '', t.worker, worker?.full_name || '', week, num(t.regular_hours), overtime,
        round2(avg), regular, overtimePay, round2(regular + overtimePay), t.name]);
      await applyTransition(doc, 'Mark exported', { payroll_batch: batch });
    }

    return { batch, count: sheets.length, filename: `${batch}.csv`, csv: rows.map(r => r.map(esc).join(',')).join('\n') + '\n' };
  }

  /**
   * Draft timesheets for every worker with completed shifts in the week of
   * `weekStart`: creates the missing ones and rebuilds existing Drafts.
   * Submitted or later timesheets are left alone.
   */
  static async generateWeek(weekStart) {
    const week = mondayOf(weekStart);
    const shifts = await loopar.db.getAll('Staffing Shift', ['id'],
      { shift_date: { [Op.between]: [week, addDays(week, 6)] }, status: { [Op.ne]: 'Cancelled' } });
    const seats = shifts.length
      ? await loopar.db.getAll('Staffing Shift Assignment', ['worker'], {
          parent_document: 'Staffing Shift', parent_id: { [Op.in]: shifts.map(s => s.id) }, status: 'Completed',
        })
      : [];
    const workers = [...new Set(seats.map(s => s.worker))];

    const result = { week, created: 0, updated: 0, skipped: 0 };
    for (const worker of workers) {
      const [existing] = await loopar.db.getAll('Staffing Timesheet', ['name', 'status'], { worker, week_start: week });
      if (existing && existing.status && existing.status !== 'Draft') { result.skipped++; continue; }
      const doc = existing
        ? await loopar.getDocument('Staffing Timesheet', existing.name)
        : await loopar.newDocument('Staffing Timesheet', { worker, week_start: week });
      await doc.save();
      existing ? result.updated++ : result.created++;
    }
    return result;
  }
}
