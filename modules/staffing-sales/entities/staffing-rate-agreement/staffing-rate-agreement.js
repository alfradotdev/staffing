'use strict';

import { BaseDocument, loopar, applyTransition } from 'loopar';
import { toRows, num, round2, parseDate, setting } from '../../../staffing/shared/utils.js';
import { renderContract } from '../../../staffing/shared/contracts.js';

const isOn = (v) => [1, '1', true, 'true'].includes(v);

/**
 * Bill (and optional pay) rates per position for a client, or one of its
 * sites. Only Active agreements price shifts and timesheets
 * (shared/rates.js). Workflow: Draft → Pending Signature (e-signature link
 * to the client) → Active → Expired; a Manager can still activate without a
 * signature (e.g. a paper contract).
 */
export default class StaffingRateAgreement extends BaseDocument {
  /** Model methods the workflow may run (see Workflow: Staffing Rate Agreement). */
  static workflowMethods = ['sendForSignature', 'cancelSignature'];

  constructor(props) {
    super(props);
  }

  async __init__(ifNotFound) {
    await super.__init__(ifNotFound);
    // New agreements: the client's primary contact signs by default.
    if (this.client && !this.signer_email) await this.#defaultSigner();
  }

  async #defaultSigner() {
    const client = await loopar.getDocument('Staffing Client', this.client, null, { ifNotFound: null });
    const contacts = toRows(await client?.contacts);
    const primary = contacts.find((c) => isOn(c.is_primary) && c.email) || contacts.find((c) => c.email);
    if (primary) {
      this.signer_name ||= primary.full_name;
      this.signer_email = primary.email;
    }
  }

  /** Workflow method of "Send for signature": the contract goes to the signer by email. */
  async sendForSignature() {
    if (!this.signer_email) await this.#defaultSigner();
    if (!this.signer_name || !this.signer_email) loopar.throw('Set the signer name and email (or a primary contact with email on the client).');

    const client = await loopar.getDocument('Staffing Client', this.client);
    const includeMsa = !client.msa_signed_at;
    const signer = { name: this.signer_name, email: this.signer_email };
    const { html, title } = await renderContract(this, signer, { includeMsa });

    // Core model; its class comes with any instance.
    const SignatureRequest = (await loopar.newDocument('Signature Request')).constructor;
    const { request, emailed } = await SignatureRequest.issue({
      document: 'Staffing Rate Agreement', documentName: this.name,
      title: `${title} — ${client.company_name || client.name}`,
      html, signerName: signer.name, signerEmail: signer.email,
      sender: await setting('company_name', null),
    });
    this.signature_request = request.name;
    this.includes_msa = includeMsa ? 1 : 0;
    this.signed_at = null;
    loopar.notify?.(emailed ? `Sent to ${signer.email} for signature.` : 'The email could not be sent: open the signature request to share the link.');
    return { navigate: emailed ? null : `/desk/Signature Request/update?name=${encodeURIComponent(request.name)}` };
  }

  /** Workflow method of "Cancel signature": the pending link stops working. */
  async cancelSignature() {
    if (!this.signature_request) return;
    const request = await loopar.getDocument('Signature Request', this.signature_request, null, { ifNotFound: null });
    if (request?.status === 'Pending') await request.revoke();
  }

  /** Called by the Signature Request when the client signs. */
  async onSignatureSigned(request) {
    this.signed_at = request.signed_at;
    await applyTransition(this, 'Mark signed', {}, { system: true });
    if (isOn(this.includes_msa)) {
      const client = await loopar.getDocument('Staffing Client', this.client);
      client.msa_signed_at = request.signed_at;
      client.msa_signature = request.name;
      if (client.status === 'Prospect') client.status = 'Active';
      await client.save({ validate: false });
    }
    await this.#notifyTeam(`Signed: ${request.title}`, `${request.signed_name}${request.signed_title ? ` (${request.signed_title})` : ''} signed ${this.name}. The rates are now active.`);
  }

  /** Called by the Signature Request when the client declines. */
  async onSignatureDeclined(request) {
    this.notes = [this.notes, `Signature declined by ${request.signer_name}: ${request.decline_reason}`].filter(Boolean).join('\n');
    await applyTransition(this, 'Mark declined', {}, { system: true });
    await this.#notifyTeam(`Declined: ${request.title}`, `${request.signer_name} declined ${this.name}: ${request.decline_reason}`);
  }

  async #notifyTeam(subject, text) {
    const to = String(await setting('sales_notify_email', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!to.length) return;
    try {
      await loopar.mail.send({ to, subject, html: `<p>${String(text).replace(/</g, '&lt;')}</p>` });
    } catch (e) {
      console.warn('[rate agreement] notify failed:', e.message);
    }
  }

  async beforeSave() {
    // Sent or signed: the contract terms are frozen (the signed copy must
    // match). Whatever the form sends, the stored terms stay; "Revise" or
    // "Cancel signature" reopen the agreement as a Draft.
    if (!this.__IS_NEW__ && !this.__TRANSITION__ && ['Pending Signature', 'Active'].includes(this.status)) {
      const stored = await loopar.db.getDoc('Staffing Rate Agreement', this.__DOCUMENT_NAME__,
        ['id', 'client', 'site', 'valid_from', 'valid_to', 'overtime_multiplier', 'signer_name', 'signer_email']);
      Object.assign(this, {
        client: stored.client, site: stored.site, valid_from: stored.valid_from, valid_to: stored.valid_to,
        overtime_multiplier: stored.overtime_multiplier, signer_name: stored.signer_name, signer_email: stored.signer_email,
      });
      const rows = await loopar.db.getAll('Staffing Rate Line', ['*'], { parent_document: 'Staffing Rate Agreement', parent_id: stored.id });
      this.lines = rows.map(({ id, name, parent_id, parent_document, ...line }) => line);
      return;
    }

    if (this.site) {
      const siteClient = await loopar.db.getValue('Staffing Site', 'client', this.site, { ifNotFound: null });
      if (siteClient && siteClient !== this.client) loopar.throw(`Site ${this.site} belongs to another client.`);
    }
    if (this.valid_to && parseDate(this.valid_to) < parseDate(this.valid_from)) {
      loopar.throw('"Valid to" must be on or after "Valid from".');
    }

    const multiplier = num(this.overtime_multiplier, 1.5) || 1.5;
    this.overtime_multiplier = multiplier;
    const lines = toRows(await this.lines);
    const seen = new Set();
    for (const line of lines) {
      if (seen.has(line.position)) loopar.throw(`${line.position} appears twice in the rates.`);
      seen.add(line.position);
      line.overtime_bill_rate = round2(num(line.bill_rate) * multiplier);
    }
    this.lines = lines;
  }

  async beforeTransition(transition) {
    if (['Active', 'Pending Signature'].includes(transition.to) && !toRows(await this.lines).length) {
      loopar.throw('Add at least one rate before activating or sending the agreement.');
    }
  }
}
