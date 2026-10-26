'use strict';

import { BaseDocument } from 'loopar';

export default class StaffingJobOpening extends BaseDocument {
  constructor(props) {
    super(props);
  }

  async beforeSave() {
    // Only open positions can be listed on the Careers page.
    if (this.status !== 'Open') this.published = 0;
  }
}
