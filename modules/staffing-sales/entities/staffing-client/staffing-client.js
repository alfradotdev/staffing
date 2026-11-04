'use strict';

import { BaseDocument, loopar, Op } from 'loopar';
import { clientNames } from '../../../staffing/shared/clients.js';

/**
 * A company the agency staffs. The company itself (name, email, phone,
 * billing address, contacts) is the core Customer in `customer`; this
 * document only keeps the staffing data: pipeline status, industry,
 * website, payment terms and the Master Services Agreement.
 *
 * The client has no name of its own, so its title (selects, prints, desk
 * lists) and the select search follow the Customer's `customer_name`.
 */
export default class StaffingClient extends BaseDocument {
  constructor(props) {
    super(props);
  }

  async beforeSave() {
    if (this.customer) {
      const other = (await loopar.db.getAll('Staffing Client', ['name'], { customer: this.customer })).find((c) => c.name !== this.name);
      if (other) loopar.throw(`Customer ${this.customer} already is Staffing Client ${other.name}.`);
    }
  }

  /** Titles of some clients: their Customer's name. */
  async titlesFor(names) {
    return Object.fromEntries(await clientNames([...names]));
  }

  async getValueDescriptive(name) {
    return (await clientNames([name])).get(name);
  }

  /** Customers whose name matches the select search, read before the (sync) condition is built. */
  #searchCustomers = null;

  buildConditionToSelect(q = null) {
    if (q === null || q === '') return {};
    const like = { [Op.like]: `%${q}%` };
    const customers = this.#searchCustomers || [];
    return customers.length ? { [Op.or]: [{ name: like }, { customer: { [Op.in]: customers } }] } : { name: like };
  }

  /** Select search by client code or customer name; rows carry `customer_name` as their title. */
  async getListToSelectElement(q = null) {
    this.#searchCustomers = q
      ? (await loopar.db.getAll('Customer', ['name'], { customer_name: { [Op.like]: `%${q}%` } })).map((c) => c.name)
      : null;
    const result = await super.getListToSelectElement(q);
    const titles = await clientNames(result.rows.map((r) => r.name));
    return {
      ...result,
      title_fields: ['customer_name'],
      rows: result.rows.map((r) => ({ ...r, customer_name: titles.get(r.name) })),
    };
  }
}
