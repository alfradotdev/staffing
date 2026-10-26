'use strict';

import { BaseController, loopar } from 'loopar';
import { issueClockLink, workerByToken, workerShifts, clock } from '../../../staffing/shared/attendance.js';

/**
 * Mobile clock: public actions authenticate with the worker's personal link
 * token (no account). `sendClockLink` (desk) issues that link.
 */
export default class StaffingWorkerController extends BaseController {
  constructor(props) {
    super(props);
  }

  async actionSendClockLink() {
    return await issueClockLink(this.name);
  }

  async #worker() {
    const worker = await workerByToken(this.data?.token || this.query?.token);
    if (!worker) loopar.throw({ code: 404, message: 'This clock link is not valid. Ask your supervisor for a new one.' });
    return worker;
  }

  async #state(worker) {
    return {
      worker: { name: worker.name, full_name: worker.preferred_name || worker.full_name },
      shifts: await workerShifts(worker),
      now: new Date().toISOString(),
    };
  }

  // Data endpoints: no `message` key, so the client keeps the payload.
  async publicActionClockStatus() {
    return await this.#state(await this.#worker());
  }

  async publicActionClockIn() {
    const worker = await this.#worker();
    const { distance } = await clock(worker, this.data?.shift, 'in', { lat: this.data?.lat, lng: this.data?.lng });
    return { ...(await this.#state(worker)), result: { kind: 'in', distance } };
  }

  async publicActionClockOut() {
    const worker = await this.#worker();
    const { distance } = await clock(worker, this.data?.shift, 'out', { lat: this.data?.lat, lng: this.data?.lng });
    return { ...(await this.#state(worker)), result: { kind: 'out', distance } };
  }
}
