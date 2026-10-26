'use strict';

import { BaseDocument } from 'loopar';
import { setting, num, today } from '../../../staffing/shared/utils.js';

/** Days from today to `date` (YYYY-MM-DD); negative when past. */
const daysUntil = (date) => Math.round((new Date(date) - new Date(today())) / 86400000);

export default class StaffingWorkerDocument extends BaseDocument {
  constructor(props) {
    super(props);
  }

  async beforeSave() {
    this.number_last4 = String(this.number_last4 || '').replace(/\D/g, '').slice(-4) || null;
    this.status = await this.computeStatus();
  }

  async computeStatus() {
    if (!this.expires_on) return this.attachment || this.issued_on ? 'Valid' : 'Pending';
    const days = daysUntil(this.expires_on);
    if (days < 0) return 'Expired';
    return days <= num(await setting('document_alert_days', 30), 30) ? 'Expiring Soon' : 'Valid';
  }
}
