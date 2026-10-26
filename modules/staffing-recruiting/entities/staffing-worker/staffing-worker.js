'use strict';

import crypto from 'crypto';
import { BaseDocument, loopar } from 'loopar';

/** Unambiguous characters (no 0/O, 1/I) for printed badges. */
const BADGE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export default class StaffingWorker extends BaseDocument {
  constructor(props) {
    super(props);
  }

  async beforeSave() {
    this.badge_code = String(this.badge_code || '').trim().toUpperCase() || await StaffingWorker.newBadgeCode();
  }

  /** Random 8-character badge code, unique among workers. */
  static async newBadgeCode() {
    for (;;) {
      const bytes = crypto.randomBytes(8);
      const code = `W${Array.from(bytes, (b) => BADGE_ALPHABET[b % BADGE_ALPHABET.length]).join('').slice(0, 7)}`;
      if (!(await loopar.db.count('Staffing Worker', { badge_code: code }))) return code;
    }
  }
}
