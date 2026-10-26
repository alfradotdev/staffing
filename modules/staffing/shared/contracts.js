'use strict';

import { loopar } from 'loopar';
import { toRows, num, setting, today } from './utils.js';

const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => `$${num(v).toFixed(2)}`;
const mdCell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The active template of a kind (Master Services Agreement | Rate Schedule). */
export async function activeTemplate(kind) {
  const [row] = await loopar.db.getAll('Staffing Contract Template', ['name'], { kind, active: 1 });
  if (!row) loopar.throw(`There is no active "${kind}" contract template. Create one in Staffing Contract Template.`);
  return await loopar.getDocument('Staffing Contract Template', row.name);
}

/** Markdown table of an agreement's rates. */
function ratesTable(agreement, lines) {
  const multiplier = num(agreement.overtime_multiplier, 1.5) || 1.5;
  const rows = lines.map((l) => `| ${mdCell(l.position)} | ${money(l.bill_rate)} | ${money(num(l.overtime_bill_rate) || num(l.bill_rate) * multiplier)} |`);
  return ['| Position | Hourly rate | Overtime rate |', '|---|---:|---:|', ...rows].join('\n');
}

/** Values the `{{…}}` placeholders resolve to. */
export async function contractContext(agreement, signer) {
  const client = await loopar.getDocument('Staffing Client', agreement.client);
  const site = agreement.site ? await loopar.getDocument('Staffing Site', agreement.site, null, { ifNotFound: null }) : null;
  const lines = toRows(await agreement.lines);
  const address = [client.billing_address, client.billing_city, [client.billing_state, client.billing_zip_code].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');

  const companyName = await setting('company_name', null);
  const companyAddress = await setting('company_address', null);
  if (!companyName || !companyAddress) {
    loopar.throw('Set the company name and address in Staffing Settings before sending contracts: they identify a party of the agreement.');
  }

  return {
    company: {
      name: companyName,
      address: String(companyAddress).replace(/\s*\n\s*/g, ', '),
      phone: await setting('phone', ''),
      email: await setting('email', ''),
    },
    client: {
      company_name: client.company_name || client.name,
      address,
      payment_terms: client.payment_terms || await setting('default_payment_terms', 'Net 30'),
    },
    agreement: {
      name: agreement.name,
      title: agreement.title || agreement.name,
      site: site ? site.site_name || site.name : 'All client sites',
      valid_from: agreement.valid_from || today(),
      valid_to: agreement.valid_to || 'until terminated',
      overtime_multiplier: num(agreement.overtime_multiplier, 1.5) || 1.5,
    },
    signer: { name: signer.name, email: signer.email },
    rates_table: ratesTable(agreement, lines),
    today: today(),
  };
}

/** `{{a.b}}` → value; unknown placeholders are left visible so they get noticed. */
export function merge(text, context) {
  return String(text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path) => {
    const value = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), context);
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * The HTML sent for signature: the Rate Schedule, preceded by the Master
 * Services Agreement when the client hasn't signed one yet.
 */
export async function renderContract(agreement, signer, { includeMsa }) {
  const context = await contractContext(agreement, signer);
  const kinds = includeMsa ? ['Master Services Agreement', 'Rate Schedule'] : ['Rate Schedule'];
  const parts = [];
  const titles = [];
  for (const kind of kinds) {
    const template = await activeTemplate(kind);
    const title = merge(template.document_title, context);
    titles.push(title);
    parts.push(`<section class="contract-part"><h1>${escapeHTML(title)}</h1>${loopar.markdownRenderer(merge(template.body, context))}</section>`);
  }
  return { html: parts.join('<hr />'), title: titles.join(' + ') };
}
