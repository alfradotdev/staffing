'use strict';

import { BaseDocument, loopar } from 'loopar';
import { toRows } from '../../../staffing/shared/utils.js';

/** Stages a unit (a vehicle) moves through at the stations, in order. */
export default class StaffingProcess extends BaseDocument {
  constructor(props) {
    super(props);
  }

  async beforeSave() {
    const stages = toRows(await this.stages).filter((s) => String(s.stage || '').trim());
    if (!stages.length) loopar.throw('Add at least one stage.');
    const seen = new Set();
    for (const s of stages) {
      s.stage = String(s.stage).trim();
      const key = s.stage.toLowerCase();
      if (seen.has(key)) loopar.throw(`Stage "${s.stage}" appears twice.`);
      seen.add(key);
    }
    this.stages = stages;
  }
}
