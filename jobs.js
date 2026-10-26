'use strict';

/**
 * Scheduled jobs of the staffing app (run by core/global/scheduler.js in
 * each tenant where the app is installed; see desk → Scheduled Job).
 */

import { loopar, Op } from 'loopar';
import { addDays, today, mondayOf, num, setting, notifyTable } from './modules/staffing/shared/utils.js';
import StaffingTimesheet from './modules/staffing-billing/entities/staffing-timesheet/staffing-timesheet.js';

/** Recomputes document statuses (Valid → Expiring Soon → Expired) and emails the list to recruiting. */
async function documentExpiry() {
  const alertDays = num(await setting('document_alert_days', 30), 30);
  const docs = await loopar.db.getAll('Staffing Worker Document', ['name', 'worker', 'document_type', 'expires_on', 'status'],
    { expires_on: { [Op.lte]: addDays(today(), alertDays) } });

  let changed = 0;
  const attention = [];
  for (const d of docs) {
    if (!d.expires_on) continue;
    const doc = await loopar.getDocument('Staffing Worker Document', d.name);
    const status = await doc.computeStatus();
    if (status !== d.status) { doc.status = status; await doc.save(); changed++; }
    if (['Expiring Soon', 'Expired'].includes(status)) {
      const worker = await loopar.db.getValue('Staffing Worker', 'full_name', d.worker, { ifNotFound: null });
      attention.push({ worker: worker || d.worker, type: d.document_type, expires: d.expires_on, status });
    }
  }
  if (!attention.length) return `${changed} status change(s); nothing expiring`;

  const mail = await notifyTable('recruiting_notify_email', `${attention.length} worker document(s) expiring`,
    `These documents are expired or expire within ${alertDays} days:`,
    [{ key: 'worker', label: 'Worker' }, { key: 'type', label: 'Document' }, { key: 'expires', label: 'Expires' }, { key: 'status', label: 'Status' }],
    attention);
  return `${changed} status change(s); ${attention.length} need attention; ${mail}`;
}

/** Shifts of the next 48 hours that are not fully staffed. */
async function unfilledShifts() {
  const shifts = await loopar.db.getAll('Staffing Shift', ['name', 'site', 'position', 'shift_date', 'start_time', 'headcount', 'assigned_count', 'status'],
    { shift_date: { [Op.between]: [today(), addDays(today(), 2)] }, status: { [Op.in]: ['Open', 'Partially Filled'] } });
  if (!shifts.length) return 'every shift of the next 48h is staffed';

  const rows = [];
  for (const s of shifts) {
    const site = await loopar.db.getValue('Staffing Site', 'site_name', s.site, { ifNotFound: null });
    rows.push({ shift: s.name, when: `${s.shift_date} ${String(s.start_time || '').slice(0, 5)}`, site: site || s.site,
      position: s.position, missing: num(s.headcount) - num(s.assigned_count) });
  }
  const mail = await notifyTable('operations_notify_email', `${rows.length} shift(s) still need workers`,
    'These shifts of the next 48 hours are not fully staffed:',
    [{ key: 'shift', label: 'Shift' }, { key: 'when', label: 'When' }, { key: 'site', label: 'Site' }, { key: 'position', label: 'Position' }, { key: 'missing', label: 'Missing' }],
    rows);
  return `${rows.length} shift(s) understaffed; ${mail}`;
}

/** Monday morning: Draft timesheets of the week that just ended. */
async function weeklyTimesheets() {
  const r = await StaffingTimesheet.generateWeek(addDays(mondayOf(today()), -7));
  return `week of ${r.week}: ${r.created} created, ${r.updated} updated, ${r.skipped} already submitted`;
}

/** Sent invoices past their due date. */
async function overdueInvoices() {
  const invoices = await loopar.db.getAll('Staffing Invoice', ['name', 'client', 'due_date', 'balance'],
    { status: 'Sent', due_date: { [Op.lt]: today() } });
  if (!invoices.length) return 'no overdue invoices';
  const rows = [];
  for (const i of invoices) {
    const client = await loopar.db.getValue('Staffing Client', 'company_name', i.client, { ifNotFound: null });
    rows.push({ invoice: i.name, client: client || i.client, due: i.due_date, balance: `$${num(i.balance).toFixed(2)}` });
  }
  const mail = await notifyTable('sales_notify_email', `${rows.length} overdue invoice(s)`, 'These invoices are past due:',
    [{ key: 'invoice', label: 'Invoice' }, { key: 'client', label: 'Client' }, { key: 'due', label: 'Due' }, { key: 'balance', label: 'Balance' }],
    rows);
  return `${rows.length} overdue; ${mail}`;
}

export default [
  { name: 'document-expiry', label: 'Worker document expiry', schedule: { every: 'daily', at: '06:00' }, run: documentExpiry },
  { name: 'unfilled-shifts', label: 'Understaffed shifts (next 48h)', schedule: { every: 'daily', at: '07:00' }, run: unfilledShifts },
  { name: 'weekly-timesheets', label: 'Weekly timesheets', schedule: { every: 'weekly', on: 'mon', at: '05:00' }, run: weeklyTimesheets },
  { name: 'overdue-invoices', label: 'Overdue invoices', schedule: { every: 'daily', at: '08:00' }, run: overdueInvoices },
];
