'use strict';

import { ContactFormBase, loopar } from 'loopar';

export default class StaffingApplicant extends ContactFormBase {
  /** Model methods the workflow may run (see Workflow: Staffing Applicant). */
  static workflowMethods = ['hire'];

  constructor(props) {
    super(props);
  }

  /** Business rules on top of the workflow definition. */
  async beforeTransition(transition) {
    if (transition.to === 'Offer' && this.background_check_status !== 'Clear') {
      loopar.throw('The background check must be Clear before making an offer.');
    }
  }

  async beforeSave() {
    await super.beforeSave();
    if (this.__IS_NEW__) {
      this.stage = this.stage || 'New';
      // date_time fields persist NOW when left unset.
      this.interview_at = this.interview_at || null;
    }
    if (this.stage !== 'Rejected') this.rejection_reason = null;

    if (this.job_opening && !this.position) {
      this.position = await loopar.db.getValue('Staffing Job Opening', 'position', this.job_opening, { ifNotFound: null });
    }
  }

  /**
   * Workflow method of the Hire transition: creates the Staffing Worker from
   * this applicant and links it. The workflow sets the stage afterwards.
   */
  async hire() {
    const navigate = (worker) => ({ worker, navigate: `/desk/Staffing Worker/update?name=${encodeURIComponent(worker)}` });
    if (this.worker) return navigate(this.worker);

    const worker = await loopar.newDocument('Staffing Worker', {
      full_name: this.full_name,
      phone: this.phone,
      email: this.email,
      languages: this.languages,
      status: 'Onboarding',
      applicant: this.name,
      background_check_status: this.background_check_status === 'Clear' ? 'Clear' : 'Pending',
      positions: this.position ? [{ position: this.position }] : [],
    });
    await worker.save();

    this.worker = worker.name;
    return navigate(worker.name);
  }
}
