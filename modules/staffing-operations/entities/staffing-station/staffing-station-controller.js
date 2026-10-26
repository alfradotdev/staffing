'use strict';

import { BaseController, loopar } from 'loopar';
import { issueDeviceLink, stationByToken, stationStages, identifyWorker, unitInfo, recordEvent, stationToday } from '../../../staffing/shared/stations.js';

/**
 * Station kiosk: public actions authenticate with the device link token
 * (no account); workers identify by scanning their badge. `linkDevice`
 * (desk) issues the device link.
 */
export default class StaffingStationController extends BaseController {
  constructor(props) {
    super(props);
  }

  async actionLinkDevice() {
    return await issueDeviceLink(this.name);
  }

  async #station() {
    const station = await stationByToken(this.data?.token || this.query?.token);
    if (!station) loopar.throw({ code: 404, message: 'This station link is not valid or the station is inactive.' });
    return station;
  }

  // Data endpoints: no `message` key, so the client keeps the payload.
  async publicActionKiosk() {
    const station = await this.#station();
    const site = await loopar.db.getValue('Staffing Site', 'site_name', station.site, { ifNotFound: station.site });
    const { here } = await stationStages(station);
    return {
      station: { name: station.name, station_name: station.station_name, site, process: station.process, stages: here },
      today: await stationToday(station),
    };
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
