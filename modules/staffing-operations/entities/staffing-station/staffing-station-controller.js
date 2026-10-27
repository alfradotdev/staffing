'use strict';

import { BaseController, loopar } from 'loopar';
import { HEARTBEAT_MINUTES, issueDeviceLink, linkThisDevice, pairDevice, rememberDevice, stationOfDevice, stationStages, identifyWorker, unitInfo, recordEvent, stationToday } from '../../../staffing/shared/stations.js';

/**
 * Station kiosk: the device is linked once with a single-use pairing link
 * (`linkDevice`, desk) and from then on identifies itself with its cookie
 * (no account); workers identify by scanning their badge.
 */
export default class StaffingStationController extends BaseController {
  constructor(props) {
    super(props);
  }

  async actionLinkDevice() {
    return await issueDeviceLink(this.name);
  }

  /** Links the device making the request and signs its user out (see linkThisDevice). */
  async actionUseThisDevice() {
    return await linkThisDevice(this.name);
  }

  async #station() {
    const station = await stationOfDevice();
    if (!station) loopar.throw({ code: 404, message: 'This device is not linked to an active station.' });
    return station;
  }

  async #kiosk(station) {
    const site = await loopar.db.getValue('Staffing Site', 'site_name', station.site, { ifNotFound: station.site });
    const { here } = await stationStages(station);
    return {
      station: { name: station.name, station_name: station.station_name, site, process: station.process, stages: here },
      today: await stationToday(station),
      heartbeat_minutes: HEARTBEAT_MINUTES,
    };
  }

  /** Opens a pairing link: this device becomes the station. */
  async publicActionPair() {
    const paired = await pairDevice(this.data?.code);
    if (!paired) loopar.throw({ code: 404, message: 'This link was already used or has expired. Ask a supervisor for a new one.' });
    rememberDevice(paired.token);
    return await this.#kiosk(paired.station);
  }

  // Data endpoints: no `message` key, so the client keeps the payload.
  async publicActionKiosk() {
    return await this.#kiosk(await this.#station());
  }

  async publicActionIdentify() {
    return { who: await identifyWorker(await this.#station(), this.data?.badge) };
  }

  async publicActionUnit() {
    return { unit: await unitInfo(await this.#station(), this.data?.code) };
  }

  async publicActionRecord() {
    const station = await this.#station();
    const result = await recordEvent(station, { badge: this.data?.badge, code: this.data?.code, stage: this.data?.stage });
    return { ...result, today: await stationToday(station) };
  }
}
