'use strict';

import { BaseDocument, loopar } from 'loopar';
import { toRows } from '../../../staffing/shared/utils.js';

/** A scanning point (tablet/phone) at a site that records units through a process. */
export default class StaffingStation extends BaseDocument {
  constructor(props) {
    super(props);
  }

  async beforeSave() {
    if (!this.process || !String(this.stages || '').trim()) return;
    const process = await loopar.getDocument('Staffing Process', this.process);
    const known = toRows(await process.stages).map((s) => s.stage.toLowerCase());
    const wanted = String(this.stages).split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = wanted.filter((s) => !known.includes(s.toLowerCase()));
    if (unknown.length) loopar.throw(`Not stages of ${this.process}: ${unknown.join(', ')}.`);
    this.stages = wanted.join(', ');
  }
}
