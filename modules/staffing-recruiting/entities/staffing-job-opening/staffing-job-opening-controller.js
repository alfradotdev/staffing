'use strict';

import { BaseController, loopar } from 'loopar';

/** Fields the Careers page may show; nothing internal leaves the server. */
const PUBLIC_FIELDS = [
  'name', 'title', 'position', 'location', 'summary', 'employment_type', 'shifts',
  'pay_min', 'pay_max', 'openings', 'description', 'requirements',
];

export default class StaffingJobOpeningController extends BaseController {
  static publicActions = ['openings'];

  constructor(props) {
    super(props);
  }

  /** Open, published openings for the Careers page. */
  async publicActionOpenings() {
    const rows = await loopar.db.getAll('Staffing Job Opening', PUBLIC_FIELDS, { status: 'Open', published: 1 });
    // Markdown rendered here (staff-authored content), so the page ships no markdown parser.
    const html = (md) => (md ? loopar.markdownRenderer(md) : '');
    const openings = rows.map(({ description, requirements, ...row }) => ({
      ...row,
      description_html: html(description),
      requirements_html: html(requirements),
    }));
    // Data endpoint: no `message` key, so the client keeps the payload.
    return { openings };
  }
}
