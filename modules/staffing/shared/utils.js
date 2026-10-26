'use strict';

import { loopar } from 'loopar';

/** Child-table value (array or JSON string) as an array of rows. */
export const toRows = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && loopar.utils.isJSON(v)) {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
};

export const num = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export const round2 = (n) => Math.round(n * 100) / 100;

/** Today as YYYY-MM-DD (local date). */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Staffing Settings value, or `fallback` when unset. */
export async function setting(field, fallback = null) {
  let value;
  try {
    value = (await loopar.getDocument('Staffing Settings'))?.[field];
  } catch {
    value = null; // settings never saved yet
  }
  return value === undefined || value === null || value === '' ? fallback : value;
}

const pad = (n) => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** YYYY-MM-DD (or a Date) → local Date at midnight. */
export const parseDate = (v) => {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const [y, m, d] = String(v).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (v, days) => {
  const d = parseDate(v);
  d.setDate(d.getDate() + days);
  return isoDate(d);
};

/** Monday of the week that contains `v`, as YYYY-MM-DD. */
export const mondayOf = (v) => {
  const d = parseDate(v);
  const offset = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - offset);
  return isoDate(d);
};

/** 'YYYY-MM-DD HH:mm:ss' (DB date_time) or ISO → Date, or null. */
export const parseDateTime = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
};

/** Hours between two Dates, two decimals. */
export const hoursBetween = (a, b) => round2((b - a) / 3600000);

/** Rows of a child table, by parent id. */
export async function childRows(entity, parentEntity, parentId, fields = ['*']) {
  if (!parentId) return [];
  return await loopar.db.getAll(entity, fields, { parent_document: parentEntity, parent_id: parentId });
}

const escapeHTML = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Emails a small HTML table to the addresses of a Staffing Settings field
 * (comma-separated). Returns a short status for job logs; never throws.
 */
export async function notifyTable(settingField, subject, intro, columns, rows) {
  const to = String(await setting(settingField, '') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!to.length) return `no ${settingField.replace(/_/g, ' ')} set`;
  const head = columns.map(c => `<th align="left" style="padding:4px 8px">${escapeHTML(c.label)}</th>`).join('');
  const body = rows.map(r => `<tr>${columns.map(c => `<td style="padding:4px 8px">${escapeHTML(r[c.key])}</td>`).join('')}</tr>`).join('');
  try {
    await loopar.mail.send({
      to, subject,
      html: `<p>${escapeHTML(intro)}</p><table border="0" cellspacing="0"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
    });
    return `emailed ${to.join(', ')}`;
  } catch (e) {
    return `email failed: ${e.message}`;
  }
}
