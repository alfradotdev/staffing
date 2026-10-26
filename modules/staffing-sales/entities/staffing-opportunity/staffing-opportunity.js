'use strict';

import { BaseDocument, loopar, Op } from 'loopar';
import { toRows, num, round2, today } from '../../../staffing/shared/utils.js';

export default class StaffingOpportunity extends BaseDocument {
  constructor(props) {
    super(props);
  }

  /** Business rules on top of the workflow definition. */
  async beforeTransition(transition) {
    if (transition.to === 'Won') {
      if (!this.client) loopar.throw('Set the client before marking the opportunity as won.');
      if (!toRows(await this.lines).length) loopar.throw('Add the requested staff (lines) before marking the opportunity as won.');
    }
  }

  async beforeSave() {
    if (this.stage !== 'Lost') this.lost_reason = null;
    await this.computeLines();
  }

  /** Line bill rate defaults to the position's; weekly value = headcount × hours × rate. */
  async computeLines() {
    const lines = toRows(await this.lines);
    const positions = [...new Set(lines.map(l => l.position).filter(Boolean))];
    const rates = positions.length
      ? await loopar.db.getAll('Staffing Position', ['name', 'default_bill_rate'], { name: { [Op.in]: positions } })
      : [];
    const rateOf = Object.fromEntries(rates.map(r => [r.name, num(r.default_bill_rate)]));

    let hours = 0, value = 0;
    for (const line of lines) {
      if (!num(line.bill_rate)) line.bill_rate = rateOf[line.position] || 0;
      const lineHours = num(line.headcount, 1) * num(line.hours_per_week);
      line.weekly_value = round2(lineHours * num(line.bill_rate));
      hours += lineHours;
      value += line.weekly_value;
    }

    this.lines = lines;
    this.estimated_weekly_hours = round2(hours);
    this.estimated_weekly_value = round2(value);
  }

  /** Winning the deal activates the client and its planned sites. */
  async afterSave() {
    if (this.stage !== 'Won' || !this.client) return;

    const client = await loopar.getDocument('Staffing Client', this.client, null, { ifNotFound: null });
    if (client && client.status !== 'Active') {
      client.status = 'Active';
      await client.save();
    }

    const sites = await loopar.db.getAll('Staffing Site', ['name'], { client: this.client, status: 'Planned' });
    for (const { name } of sites) {
      await loopar.db.setValue('Staffing Site', 'status', 'Active', name);
    }

    await this.#draftRateAgreement();
  }

  /** The won deal's rates become a Draft Rate Agreement (once) for Sales to review and activate. */
  async #draftRateAgreement() {
    const [existing] = await loopar.db.getAll('Staffing Rate Agreement', ['name'], { opportunity: this.name });
    if (existing) return;

    const byPosition = new Map();
    for (const line of toRows(await this.lines)) {
      if (line.position && !byPosition.has(line.position)) {
        byPosition.set(line.position, { position: line.position, bill_rate: num(line.bill_rate) });
      }
    }
    if (!byPosition.size) return;

    const company = await loopar.db.getValue('Staffing Client', 'company_name', this.client, { ifNotFound: null });
    const agreement = await loopar.newDocument('Staffing Rate Agreement', {
      title: `${company || this.client} rates`,
      client: this.client,
      site: this.site || null,
      valid_from: this.expected_start || today(),
      opportunity: this.name,
      lines: [...byPosition.values()],
    });
    await agreement.save();
  }
}
