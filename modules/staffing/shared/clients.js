'use strict';

/*
 * Staffing Client ↔ core Customer. A client keeps only the staffing data
 * (pipeline status, industry, website, payment terms, MSA) and a `customer`
 * link; the company name, email, phone, billing address and contacts live
 * in the Customer (apps/loopar/modules/crm) and are always read from there.
 */

import { loopar, Op, CHILD_POSITION_COLUMN } from 'loopar';
import { createCustomer, customersByName, customerRow } from '../../../../loopar/modules/crm/customers.js';
import { customerContacts, ensureCustomerContact } from '../../../../loopar/modules/crm/portal-access.js';

const CLIENT = 'Staffing Client';

/** Customer fields the app reads for a client (name + bill-to data). */
export const CLIENT_CUSTOMER_FIELDS = ['customer_name', 'email', 'phone', 'address', 'city', 'state', 'zip_code', 'country'];

/** Customer linked to Staffing Client `client` (name), or null. */
export async function clientCustomerName(client) {
  if (!client) return null;
  return await loopar.db.getValue(CLIENT, 'customer', client, { ifNotFound: null });
}

/** Customer row of a client (`fields` of CLIENT_CUSTOMER_FIELDS by default), or null. */
export async function clientCustomer(client, fields = CLIENT_CUSTOMER_FIELDS) {
  return await customerRow(await clientCustomerName(client), fields);
}

/** Display names of some clients, as a Map client → customer_name (the client code when unlinked). */
export async function clientNames(clients) {
  const list = [...new Set((clients || []).filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const rows = await loopar.db.getAll(CLIENT, ['name', 'customer'], { name: { [Op.in]: list } });
  const customers = await customersByName(rows.map((r) => r.customer), ['customer_name']);
  const names = new Map(list.map((c) => [c, c]));
  for (const row of rows) names.set(row.name, customers.get(row.customer)?.customer_name || row.name);
  return names;
}

/** Display name of one client. */
export async function clientName(client) {
  return (await clientNames([client])).get(client) ?? client;
}

/**
 * People of a client (its Customer's contacts), primary first:
 * [{ contact, full_name, email, phone, user, job_title, is_primary }].
 */
export async function clientContacts(client) {
  const customer = await clientCustomerName(client);
  if (!customer) return [];
  const links = await customerContacts(customer);
  if (!links.length) return [];
  const rows = await loopar.db.getAll('Customer Contact', ['name', 'full_name', 'email', 'phone', 'user'],
    { name: { [Op.in]: links.map((l) => l.contact) } });
  const byName = new Map(rows.map((r) => [r.name, r]));
  return links
    .filter((l) => byName.has(l.contact))
    .map((l) => {
      const { name: _name, ...person } = byName.get(l.contact);
      return { contact: l.contact, ...person, job_title: l.job_title ?? null, is_primary: loopar.utils.trueValue(l.is_primary) ? 1 : 0 };
    });
}

/** Contact that receives contracts and invoices: the primary one with email, else the first with email. */
export async function clientBillingContact(client) {
  return (await clientContacts(client)).find((c) => c.email) || null;
}

/** Staffing Client whose Customer is called `companyName` (exact name), or null. */
export async function findClientByCompany(companyName) {
  const company = String(companyName || '').trim().replace(/\s+/g, ' ');
  if (!company) return null;
  const customers = await loopar.db.getAll('Customer', ['name'], { customer_name: company });
  if (!customers.length) return null;
  const [client] = await loopar.db.getAll(CLIENT, ['name'], { customer: { [Op.in]: customers.map((c) => c.name) } });
  return client?.name ?? null;
}

/**
 * Sets the job title (and optionally the primary flag) of `contact` on
 * Customer `customer`. The child rows are saved through the Customer with
 * every existing row (and its `name`), as child tables require.
 */
export async function setContactRole(customer, contact, { job_title, is_primary } = {}) {
  const doc = await loopar.getDocument('Customer', customer);
  const parent = await loopar.db.getRow('Customer', customer, ['id']);
  const rows = (await loopar.db.getAll('Customer Contact Link', ['name', 'contact', 'job_title', 'is_primary', CHILD_POSITION_COLUMN],
    { parent_id: parent.id, parent_document: 'Customer' }))
    .sort((a, b) => (a[CHILD_POSITION_COLUMN] ?? 0) - (b[CHILD_POSITION_COLUMN] ?? 0))
    .map(({ [CHILD_POSITION_COLUMN]: _position, ...row }) => row);
  const row = rows.find((r) => r.contact === contact);
  if (!row) return;
  const changed = (job_title !== undefined && (row.job_title ?? null) !== (job_title || null))
    || (is_primary !== undefined && Number(loopar.utils.trueValue(row.is_primary)) !== Number(!!is_primary));
  if (!changed) return;
  if (job_title !== undefined) row.job_title = job_title || null;
  if (is_primary) for (const r of rows) r.is_primary = r === row ? 1 : 0;
  doc.contacts = rows;
  await doc.save();
}

/**
 * New Staffing Client for a company: creates its Customer (type Company),
 * adds `contact` as a contact of that Customer (primary when it is the
 * first) and saves the client with the staffing fields of `client`.
 * Returns the client name.
 */
export async function createClient({ customer = {}, contact = null, client = {} } = {}) {
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const customerName = await createCustomer({
    customer_type: 'Company',
    ...customer,
    // createCustomer makes the primary contact from the customer email: it
    // is this person when they share the email.
    ...(contact?.full_name && same(contact.email, customer.email) ? { contact_name: contact.full_name } : {}),
  });

  const email = contact?.email || customer.email;
  if (email) {
    const contactName = await ensureCustomerContact(customerName, {
      email,
      full_name: contact?.full_name || customer.customer_name,
      phone: contact?.phone ?? customer.phone ?? null,
    });
    if (contact?.job_title) await setContactRole(customerName, contactName, { job_title: contact.job_title });
  }

  const doc = await loopar.newDocument(CLIENT, { ...client, customer: customerName });
  await doc.save();
  return doc.name;
}
