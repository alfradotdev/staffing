'use strict';

import { loopar } from 'loopar';
import { num, childRows, parseDate } from './utils.js';

/**
 * Rates for one worked position, by priority:
 *   bill rate  → active Rate Agreement (site-specific first, then client-wide) → position default
 *   pay rate   → agreement line pay rate → the worker's own rate for the position → position default
 * Overtime multiplier comes from the agreement (1.5 when there is none).
 */

const inRange = (agreement, date) => {
  const d = parseDate(date);
  if (agreement.valid_from && parseDate(agreement.valid_from) > d) return false;
  if (agreement.valid_to && parseDate(agreement.valid_to) < d) return false;
  return true;
};

/** Active agreement that applies to client/site on `date`, or null. */
export async function agreementFor(client, site, date) {
  if (!client) return null;
  const rows = await loopar.db.getAll('Staffing Rate Agreement',
    ['id', 'name', 'site', 'valid_from', 'valid_to', 'overtime_multiplier'], { client, status: 'Active' });
  const valid = rows.filter(a => inRange(a, date) && (!a.site || a.site === site));
  valid.sort((a, b) => (b.site ? 1 : 0) - (a.site ? 1 : 0) || String(b.valid_from).localeCompare(String(a.valid_from)));
  return valid[0] || null;
}

async function workerRate(worker, position) {
  if (!worker) return 0;
  const id = await loopar.db.getValue('Staffing Worker', 'id', worker, { ifNotFound: null });
  const rows = await childRows('Staffing Worker Position', 'Staffing Worker', id, ['position', 'pay_rate']);
  return num(rows.find(r => r.position === position)?.pay_rate);
}

export async function ratesFor({ client, site, position, worker, date }) {
  const agreement = await agreementFor(client, site, date);
  const line = agreement
    ? (await childRows('Staffing Rate Line', 'Staffing Rate Agreement', agreement.id, ['position', 'bill_rate', 'pay_rate']))
        .find(l => l.position === position)
    : null;
  const pos = position
    ? await loopar.db.getDoc('Staffing Position', position, ['default_bill_rate', 'default_pay_rate'])
    : null;

  return {
    agreement: agreement?.name || null,
    bill_rate: num(line?.bill_rate) || num(pos?.default_bill_rate),
    pay_rate: num(line?.pay_rate) || (await workerRate(worker, position)) || num(pos?.default_pay_rate),
    overtime_multiplier: num(agreement?.overtime_multiplier, 1.5) || 1.5,
  };
}

/** Whether `worker` lists `position` among the positions it can work. */
export async function isQualified(worker, position) {
  const id = await loopar.db.getValue('Staffing Worker', 'id', worker, { ifNotFound: null });
  const rows = await childRows('Staffing Worker Position', 'Staffing Worker', id, ['position']);
  return rows.some(r => r.position === position);
}
