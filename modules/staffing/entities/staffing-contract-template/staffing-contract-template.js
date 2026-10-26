'use strict';

import { BaseDocument, loopar } from 'loopar';

/**
 * Contract text sent for e-signature (shared/contracts.js renders it). One
 * active template per kind: activating one deactivates the others.
 */
export default class StaffingContractTemplate extends BaseDocument {
  constructor(props) {
    super(props);
  }

  async afterSave() {
    if (![1, '1', true].includes(this.active)) return;
    const others = await loopar.db.getAll('Staffing Contract Template', ['name'], { kind: this.kind, active: 1 });
    for (const { name } of others) {
      if (name !== this.name) await loopar.db.setValue('Staffing Contract Template', 'active', 0, name);
    }
  }
}
