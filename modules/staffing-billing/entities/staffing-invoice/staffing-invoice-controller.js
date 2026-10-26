'use strict';

import { BaseController } from 'loopar';
import StaffingInvoice from './staffing-invoice.js';

export default class StaffingInvoiceController extends BaseController {
  constructor(props) {
    super(props);
  }

  /** Draft invoices for the unbilled approved hours of `{ from, to, client? }`. */
  async actionGenerate() {
    const data = this.data || {};
    // Data endpoint: no `message` key, so the client keeps the payload.
    return await StaffingInvoice.generate({ from: data.from, to: data.to, client: data.client || null });
  }
}
