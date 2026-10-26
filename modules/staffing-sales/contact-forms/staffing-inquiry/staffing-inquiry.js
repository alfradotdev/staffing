'use strict';

import { ContactFormBase, loopar, Op } from 'loopar';

/** `services` is stored as comma-separated Service names. */
const splitNames = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

export default class StaffingInquiry extends ContactFormBase {
  /** Model methods the workflow may run (see Workflow: Staffing Inquiry). */
  static workflowMethods = ['createOpportunity'];

  constructor(props) {
    super(props);
  }

  async beforeSave() {
    await super.beforeSave();
    // Keep only published services (the field comes from a public form). Not
    // filtered by app: the site that shows the services is a separate app.
    const wanted = splitNames(this.services);
    const valid = wanted.length
      ? await loopar.db.getAll('Service', ['name'], { name: { [Op.in]: wanted }, published: 1 })
      : [];
    const ok = new Set(valid.map(r => r.name));
    this.services = wanted.filter(n => ok.has(n)).join(',') || null;
  }

  /**
   * Opportunity lines for the requested services: one per active position
   * linked to each service. The headcount goes on the line when there is
   * only one; otherwise Sales splits it.
   */
  async #proposedLines() {
    const services = splitNames(this.services);
    if (!services.length) return [];
    const positions = await loopar.db.getAll('Staffing Position', ['name'], { service: { [Op.in]: services }, active: 1 });
    const headcount = parseInt(this.headcount) || 0;
    return positions.map(({ name }) => ({
      position: name,
      headcount: positions.length === 1 && headcount > 0 ? headcount : 1,
      hours_per_week: 40,
    }));
  }

  async #serviceTitles() {
    const names = splitNames(this.services);
    if (!names.length) return [];
    const rows = await loopar.db.getAll('Service', ['name', 'title'], { name: { [Op.in]: names } });
    return rows.map(r => r.title);
  }

  /** Client with this company name, or a new Prospect with the sender as primary contact. */
  async #findOrCreateClient() {
    const company = String(this.company_name || '').trim();
    const [existing] = await loopar.db.getAll('Staffing Client', ['name'], { company_name: company });
    if (existing) return existing.name;

    const client = await loopar.newDocument('Staffing Client', {
      company_name: company,
      status: 'Prospect',
      email: this.email,
      phone: this.phone,
      notes: `Created from website inquiry ${this.name}.`,
      contacts: [{
        full_name: this.contact_name,
        job_title: this.job_title,
        email: this.email,
        phone: this.phone,
        is_primary: 1,
      }],
    });
    await client.save();
    return client.name;
  }

  /**
   * Workflow method of the Create opportunity transition: creates the
   * Staffing Opportunity (and the client, if new) and links it.
   */
  async createOpportunity() {
    const navigate = (name) => ({ opportunity: name, navigate: `/desk/Staffing Opportunity/update?name=${encodeURIComponent(name)}` });
    if (this.opportunity) return navigate(this.opportunity);

    const titles = await this.#serviceTitles();
    const details = [
      titles.length && `Services: ${titles.join(', ')}`,
      this.location && `Location: ${this.location}`,
      this.headcount && `Approx. headcount: ${this.headcount}`,
      this.start_date && `Desired start: ${this.start_date}`,
      '',
      this.message,
    ].filter(v => v !== undefined && v !== null && v !== false && v !== 0).join('\n');

    const opportunity = await loopar.newDocument('Staffing Opportunity', {
      title: [this.company_name, titles.length === 1 ? titles[0] : titles.length ? 'Multiple services' : null]
        .filter(Boolean).join(' — '),
      client: await this.#findOrCreateClient(),
      stage: 'New',
      source: 'Website',
      owner: loopar.auth.user() || null,
      expected_start: this.start_date || null,
      inquiry: this.name,
      lines: await this.#proposedLines(),
      notes: details,
    });
    await opportunity.save();

    this.opportunity = opportunity.name;
    this.status = 'Read';
    return navigate(opportunity.name);
  }
}
