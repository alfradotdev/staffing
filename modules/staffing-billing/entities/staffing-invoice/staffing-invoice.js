'use strict';

import { BaseDocument, loopar, Op } from 'loopar';
import { toRows, num, round2, today, addDays, parseDate, setting } from '../../../staffing/shared/utils.js';

const TERMS_DAYS = { 'Net 15': 15, 'Net 30': 30, 'Net 45': 45, 'Net 60': 60 };

/**
 * Client invoice built from approved timesheet hours. Each timesheet line is
 * billed once: generation stamps the line with the invoice, Void releases it.
 * Overtime of a timesheet is spread over its lines by hours, and billed at
 * the line's rate × the agreement's overtime multiplier.
 */
export default class StaffingInvoice extends BaseDocument {
  constructor(props) {
    super(props);
  }

  async beforeSave() {
    if (this.__IS_NEW__ || !this.invoice_date) this.invoice_date = this.invoice_date || today();
    if (!this.payment_terms) {
      this.payment_terms = await loopar.db.getValue('Staffing Client', 'payment_terms', this.client, { ifNotFound: null })
        || await setting('default_payment_terms', 'Net 30');
    }
    if (!this.due_date) this.due_date = addDays(this.invoice_date, TERMS_DAYS[this.payment_terms] ?? 30);
    if (!this.bill_to_email) this.bill_to_email = await this.#billToEmail();
    if (this.tax_rate === undefined || this.tax_rate === null || this.tax_rate === '') {
      this.tax_rate = num(await setting('invoice_tax_rate', 0));
    }

    const lines = toRows(await this.lines);
    for (const l of lines) {
      l.amount = round2(num(l.hours) * num(l.bill_rate) + num(l.overtime_hours) * num(l.overtime_rate));
    }
    this.lines = lines;

    this.subtotal = round2(lines.reduce((s, l) => s + num(l.amount), 0));
    this.tax_amount = round2(this.subtotal * num(this.tax_rate) / 100);
    this.total = round2(this.subtotal + this.tax_amount);
    if (this.status === 'Paid' && !num(this.amount_paid)) this.amount_paid = this.total;
    this.balance = round2(this.total - num(this.amount_paid));
  }

  async #billToEmail() {
    const id = await loopar.db.getValue('Staffing Client', 'id', this.client, { ifNotFound: null });
    const contacts = id ? await loopar.db.getAll('Staffing Client Contact', ['email', 'is_primary'],
      { parent_document: 'Staffing Client', parent_id: id }) : [];
    return contacts.find(c => num(c.is_primary) && c.email)?.email
      || contacts.find(c => c.email)?.email
      || await loopar.db.getValue('Staffing Client', 'email', this.client, { ifNotFound: null });
  }

  async beforeTransition(transition) {
    if (transition.to === 'Sent' && !(num(this.total) > 0)) {
      loopar.throw('The invoice total is zero: check the rate agreement of the client for the service period.');
    }
    if (transition.to === 'Paid') this.amount_paid = num(this.total);
    if (transition.to === 'Void') await StaffingInvoice.release(this.name);
  }

  async delete(...args) {
    if (this.status && this.status !== 'Draft') loopar.throw('Only Draft invoices can be deleted. Void it instead.');
    await StaffingInvoice.release(this.name);
    return await super.delete(...args);
  }

  /** Frees the timesheet lines billed by `invoice`. */
  static async release(invoice) {
    await loopar.db.query('Staffing Timesheet Line').where({ invoice }).update({ invoice: null });
  }

  /**
   * Draft invoices for the approved hours worked between `from` and `to`
   * that no invoice billed yet: one per client (or only `client`).
   */
  static async generate({ from, to, client = null }) {
    if (!from || !to) loopar.throw('Set the service period.');
    if (parseDate(to) < parseDate(from)) loopar.throw('The period ends before it starts.');

    const timesheets = await loopar.db.getAll('Staffing Timesheet', ['id', 'name', 'total_hours', 'overtime_hours'], {
      status: { [Op.in]: ['Approved', 'Exported'] },
      week_start: { [Op.between]: [addDays(from, -6), to] },
    });
    if (!timesheets.length) return { created: [], lines: 0 };
    const otRatio = Object.fromEntries(timesheets.map(t =>
      [t.id, num(t.total_hours) ? num(t.overtime_hours) / num(t.total_hours) : 0]));

    const rows = await loopar.db.query('Staffing Timesheet Line')
      .where({ parent_document: 'Staffing Timesheet' })
      .whereIn('parent_id', timesheets.map(t => t.id))
      .whereBetween('work_date', [from, to])
      .where(q => q.whereNull('invoice').orWhere('invoice', ''))
      .select('name', 'parent_id', 'site', 'position', 'hours', 'bill_rate', 'overtime_multiplier');

    const siteClient = {};
    for (const site of new Set(rows.map(r => r.site))) {
      siteClient[site] = await loopar.db.getValue('Staffing Site', 'client', site, { ifNotFound: null });
    }

    const byClient = new Map();
    for (const r of rows) {
      const c = siteClient[r.site];
      if (!c || (client && c !== client)) continue;
      if (!byClient.has(c)) byClient.set(c, []);
      byClient.get(c).push(r);
    }

    const created = [];
    let billed = 0;
    for (const [c, clientRows] of byClient) {
      const groups = new Map();
      for (const r of clientRows) {
        const key = [r.site, r.position, num(r.bill_rate), num(r.overtime_multiplier, 1.5)].join('|');
        const ot = num(r.hours) * otRatio[r.parent_id];
        const g = groups.get(key) || {
          site: r.site, position: r.position, bill_rate: num(r.bill_rate),
          overtime_rate: round2(num(r.bill_rate) * (num(r.overtime_multiplier, 1.5) || 1.5)), hours: 0, overtime_hours: 0,
        };
        g.hours += num(r.hours) - ot;
        g.overtime_hours += ot;
        groups.set(key, g);
      }
      const lines = [...groups.values()].map(g => ({ ...g, hours: round2(g.hours), overtime_hours: round2(g.overtime_hours) }));

      const invoice = await loopar.newDocument('Staffing Invoice', { client: c, period_start: from, period_end: to, lines });
      await invoice.save();
      await loopar.db.query('Staffing Timesheet Line').whereIn('name', clientRows.map(r => r.name)).update({ invoice: invoice.name });
      created.push(invoice.name);
      billed += clientRows.length;
    }
    return { created, lines: billed };
  }
}
