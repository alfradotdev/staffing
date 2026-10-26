'use strict';

import { BaseController } from 'loopar';
import StaffingTimesheet from './staffing-timesheet.js';

export default class StaffingTimesheetController extends BaseController {
  constructor(props) {
    super(props);
  }

  /** Creates/rebuilds the Draft timesheets of a week: `{ week_start }`. */
  async actionGenerateWeek() {
    const data = this.data || {};
    // Data endpoint: no `message` key, so the client keeps the payload.
    return await StaffingTimesheet.generateWeek(data.week_start || this.query?.week_start || new Date());
  }

  /** CSV of the week's Approved timesheets for the payroll provider: `{ week_start }`. */
  async actionExportPayroll() {
    const data = this.data || {};
    return await StaffingTimesheet.exportPayroll(data.week_start || this.query?.week_start);
  }
}
