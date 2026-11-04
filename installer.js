
'use strict';

import {CoreInstaller, loopar, Op, CHILD_POSITION_COLUMN} from 'loopar';
import {linkPortalUser} from '../loopar/modules/crm/portal-access.js';

const READ = ['view', 'list', 'search'];

/** Read-only access (view, list, search) to each document. */
const read = (...documents) => documents.flatMap(document => READ.map(action => ({document, action})));

/**
 * Day-to-day work on each document: everything except delete, bulkDelete,
 * rename and moderate (Manager only). Explicit actions instead of `*` + deny,
 * because a deny would also win over the Manager role for a user holding both.
 */
const WORK = ['view', 'list', 'search', 'create', 'update', 'print', 'history', 'addComment'];
// Workflow moves (`transition`) are granted per document below; the workflow
// itself narrows each transition to its allowed roles.
const work = (...documents) => documents.flatMap(document => WORK.map(action => ({document, action})));

/** E-signature requests sent for rate agreements: read them, resend the link or revoke it. */
const SIGNATURES = [
    ...read('Signature Request'),
    {document: 'Signature Request', action: 'resend'},
    {document: 'Signature Request', action: 'revoke'},
];

/** Core CRM documents: Sales keeps the clients' customers and contacts, the other roles read them. */
const CUSTOMERS_WORK = ['view', 'list', 'search', 'create', 'update'].flatMap(action =>
    ['Customer', 'Customer Contact'].map(document => ({document, action})));

const CLIENT = 'Staffing Client';
const OLD_CONTACT = 'Staffing Client Contact';
/** Staffing Client columns that moved to the core Customer (1.12.0), old → Customer field. */
const MOVED_COLUMNS = {
    company_name: 'customer_name',
    email: 'email',
    phone: 'phone',
    billing_address: 'address',
    billing_city: 'city',
    billing_state: 'state',
    billing_zip_code: 'zip_code',
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

/** Example process for the stations, created once (the admin may edit or delete it). */
const SAMPLE_PROCESS = {
    name: 'Vehicle Turn',
    active: 1,
    description: 'Sample: a returned rental car through wash, detail and inspection until it is ready to rent. Edit the stages to match each client.',
    stages: [
        {stage: 'Received', is_final: 0, target_minutes: 10},
        {stage: 'Washing', is_final: 0, target_minutes: 15},
        {stage: 'Detailing', is_final: 0, target_minutes: 20},
        {stage: 'Inspection', is_final: 0, target_minutes: 5},
        {stage: 'Ready', is_final: 1, target_minutes: null},
    ],
};

export default class installer extends CoreInstaller {
    constructor(props){
        super(props);
    }

    async install(reinstall = false) {
        const result = await super.install(reinstall);
        await this.#migrateClientsToCustomers();
        return result;
    }

    /**
     * One-time migration (1.12.0): a Staffing Client keeps only its staffing
     * data and a `customer` link; company name, email, phone and billing
     * address moved to the core Customer, and the client contacts (the
     * removed Staffing Client Contact child table) to the Customer's contacts.
     *
     * The old columns survive alterSchema as orphans, so they are read here.
     * Every client gets a Customer (once) and each old contact a Customer
     * Contact linked to it (matched by email, or by name when it has none);
     * an old `portal_user` is linked to its contact. Only when nothing failed
     * are the old columns, the child table and its entity meta and grants
     * removed; otherwise everything stays and the next update retries.
     * Idempotent; delete once every tenant is past 1.12.0.
     */
    async #migrateClientsToCustomers() {
        const q = () => loopar.db.qx();
        // A knex SchemaBuilder accumulates statements: take a fresh one per call.
        const schema = () => q().schema;

        try {
            if (!(await schema().hasTable(CLIENT)) || !(await schema().hasColumn(CLIENT, 'customer'))) return;
            if (!(await schema().hasTable('Customer')) || !loopar.getRef('Customer Contact', false)) {
                console.warn('[staffing] The core Customer is not installed yet: update the loopar app, then staffing again.');
                return;
            }

            const moved = [];
            for (const column of Object.keys(MOVED_COLUMNS)) {
                if (await schema().hasColumn(CLIENT, column)) moved.push(column);
            }
            const deletedColumn = await schema().hasColumn(CLIENT, '__deleted_at__');
            const oldContacts = await schema().hasTable(OLD_CONTACT);

            let failed = 0;
            const clients = await q()(CLIENT).select(['id', 'name', 'customer', 'status', ...moved, ...(deletedColumn ? ['__deleted_at__'] : [])]);
            for (const client of clients) {
                try {
                    const customer = client.customer || await this.#customerFor(client, moved);
                    if (oldContacts) failed += await this.#migrateContacts(client, customer);
                } catch (e) {
                    failed++;
                    console.error(`[staffing] Staffing Client ${client.name}: not migrated to a Customer:`, e.message);
                }
            }

            // Keep the old data while anything is still to migrate (the next update retries).
            if (failed) {
                console.warn(`[staffing] ${failed} client(s)/contact(s) not migrated; the old client columns and contacts are kept.`);
                return;
            }

            for (const column of moved) await loopar.db.dropOrphanColumn(CLIENT, column);
            const removed = await this.#dropOldContactEntity();
            if (moved.length || removed) {
                console.log('[staffing] Staffing Clients migrated to core Customers');
                await loopar.build();
            }
        } catch (e) {
            console.error('[staffing] Staffing Client → Customer migration failed:', e.message);
        }
    }

    /** Creates the Customer of an old client row and links it. Returns the customer name. */
    async #customerFor(client, moved) {
        const values = {};
        for (const column of moved) {
            const value = clean(client[column]);
            if (value) values[MOVED_COLUMNS[column]] = value;
        }

        const customer = await loopar.newDocument('Customer');
        Object.assign(customer, {
            ...values,
            customer_name: values.customer_name || client.name,
            customer_type: 'Company',
            status: client.__deleted_at__ || client.status === 'Inactive' ? 'Inactive' : 'Active',
        });
        await customer.save();

        // Linked right away (not through the document: a soft-deleted client
        // must stay deleted), so a later failure never creates it twice.
        await loopar.db.qx()(CLIENT).where({id: client.id}).update({customer: customer.name});
        return customer.name;
    }

    /**
     * Old contacts of a client → contacts of its Customer (job title and
     * primary flag on the link row), skipping the ones already linked.
     * Returns the number of failures.
     */
    async #migrateContacts(client, customerName) {
        const q = () => loopar.db.qx();
        const old = await q()(OLD_CONTACT).select('*').where({parent_id: client.id, parent_document: CLIENT});
        if (!old.length) return 0;
        old.sort((a, b) => (a[CHILD_POSITION_COLUMN] ?? a.id) - (b[CHILD_POSITION_COLUMN] ?? b.id));

        const parent = await loopar.db.getRow('Customer', customerName, ['id']);
        if (!parent) throw new Error(`Customer ${customerName} does not exist.`);
        const links = (await loopar.db.getAll('Customer Contact Link', ['name', 'contact', 'job_title', 'is_primary', CHILD_POSITION_COLUMN],
            {parent_id: parent.id, parent_document: 'Customer'}))
            .sort((a, b) => (a[CHILD_POSITION_COLUMN] ?? 0) - (b[CHILD_POSITION_COLUMN] ?? 0))
            .map(({[CHILD_POSITION_COLUMN]: _position, ...row}) => row);
        const known = links.length
            ? await loopar.db.getAll('Customer Contact', ['name', 'full_name', 'email', 'user'], {name: {[Op.in]: links.map(l => l.contact)}})
            : [];

        let changed = false;
        const portal = [];
        for (const row of old) {
            const email = clean(row.email).toLowerCase();
            const validEmail = EMAIL_RE.test(email) ? email : null;
            const fullName = clean(row.full_name) || validEmail || 'Contact';

            let contact = known.find(k => validEmail ? k.email === validEmail : !k.email && k.full_name === fullName)?.name;
            if (!contact) {
                if (validEmail) contact = (await loopar.db.getRow('Customer Contact', {email: validEmail}, ['name']))?.name;
                if (!contact) {
                    const doc = await loopar.newDocument('Customer Contact');
                    Object.assign(doc, {full_name: fullName, email: validEmail, phone: clean(row.phone) || null});
                    await doc.save();
                    contact = doc.name;
                }
                known.push({name: contact, full_name: fullName, email: validEmail});
            }
            if (!links.some(l => l.contact === contact)) {
                links.push({contact, job_title: clean(row.job_title) || null, is_primary: loopar.utils.trueValue(row.is_primary) ? 1 : 0});
                changed = true;
            }
            if (row.portal_user) portal.push([contact, row.portal_user]);
        }

        if (changed) {
            const doc = await loopar.getDocument('Customer', customerName);
            doc.contacts = links;
            await doc.save();
        }

        let failed = 0;
        for (const [contact, user] of portal) {
            try {
                if (!(await loopar.db.getRow('User', user, ['name']))) continue; // the user no longer exists
                await linkPortalUser(contact, user);
            } catch (e) {
                failed++;
                console.error(`[staffing] Portal user ${user} of client ${client.name} not linked to contact ${contact}:`, e.message);
            }
        }
        return failed;
    }

    /** Removes the Staffing Client Contact entity: meta row, grants and table. Returns whether anything was removed. */
    async #dropOldContactEntity() {
        const q = () => loopar.db.qx();
        const schema = () => q().schema;
        let removed = false;

        // Names matched in JS: MySQL compares case-insensitively.
        const meta = (await q()('Entity').select('id', 'name')).filter(e => e.name === OLD_CONTACT);
        if (meta.length) {
            await q()('Entity').whereIn('id', meta.map(e => e.id)).delete();
            removed = true;
        }
        if (await schema().hasTable('Permission')) {
            const grants = (await q()('Permission').select('id', 'document')).filter(p => p.document === OLD_CONTACT);
            if (grants.length) await q()('Permission').whereIn('id', grants.map(p => p.id)).delete();
        }
        if (await schema().hasTable(OLD_CONTACT)) {
            await schema().dropTable(OLD_CONTACT);
            removed = true;
        }
        return removed;
    }

    async installData(reinstall = false) {
        const result = await super.installData(reinstall);
        // Documents with child rows can't come from installer.json without
        // being re-applied on every update, so the sample is created here.
        if (!(await loopar.db.count('Staffing Process', {name: SAMPLE_PROCESS.name}))) {
            const process = await loopar.newDocument('Staffing Process', SAMPLE_PROCESS);
            await process.save({validate: false, forceChildren: true});
        }
        return result;
    }

    /**
     * Application roles (seeded idempotently by CoreInstaller.seedRoles).
     * By convention CoreInstaller also seeds "Staffing Manager" (the whole
     * app, including Settings, the Position catalog and deletes) and
     * "Staffing User" (reads everything, edits only its own records).
     *
     * Job roles below follow the business flow. Nobody but the Manager
     * deletes or renames records or edits Staffing Settings / Staffing Position.
     * Child tables (lines, worker positions) are saved through their parent
     * and need no grant of their own. Clients' companies and contacts are
     * core Customers / Customer Contacts, granted explicitly below.
     */
    static roles = [
        {
            // Convention role, declared to add the core documents the app
            // works with (Signature Request lives in loopar).
            name: 'Staffing Manager',
            description: 'Full access to every document of the Staffing app, plus the e-signature requests it sends.',
            is_system_role: 1,
            grants: [
                {document: 'App:staffing', action: '*'},
                ...SIGNATURES,
                ...CUSTOMERS_WORK,
            ],
        },
        {
            name: 'Staffing Sales',
            description: 'Sells and bills the service: website inquiries (review, convert, discard), opportunities (pipeline), rate agreements and their e-signature, client invoices, clients and their sites. Reads positions, job openings, workers and contract templates.',
            is_system_role: 1,
            grants: [
                ...work('Staffing Inquiry', 'Staffing Opportunity', 'Staffing Client', 'Staffing Site'),
                {document: 'Staffing Inquiry', action: 'transition'},
                {document: 'Staffing Opportunity', action: 'transition'},
                ...work('Staffing Rate Agreement', 'Staffing Invoice'),
                ...CUSTOMERS_WORK,
                {document: 'Staffing Rate Agreement', action: 'transition'},
                {document: 'Staffing Invoice', action: 'transition'},
                {document: 'Staffing Invoice', action: 'generate'},
                ...read('Staffing Position', 'Staffing Job Opening', 'Staffing Worker', 'Staffing Shift', 'Staffing Contract Template'),
                ...SIGNATURES,
            ],
        },
        {
            name: 'Staffing Recruiter',
            description: 'Hires the workforce: job openings, applicants (screening to Hire), workers and their documents. Reads clients, sites and positions.',
            is_system_role: 1,
            grants: [
                ...work('Staffing Job Opening', 'Staffing Applicant', 'Staffing Worker', 'Staffing Worker Document'),
                {document: 'Staffing Applicant', action: 'transition'},
                {document: 'Staffing Worker', action: 'sendClockLink'},
                ...read('Staffing Position', 'Staffing Site', 'Staffing Client', 'Staffing Shift', 'Customer'),
            ],
        },
        {
            name: 'Staffing Supervisor',
            description: 'Runs a site day to day: schedules shifts and assignments, records check-in/out, sends clock links, sets up scanning stations, submits weekly timesheets and keeps worker documents up to date.',
            is_system_role: 1,
            grants: [
                ...read('Staffing Worker', 'Staffing Site', 'Staffing Client', 'Staffing Position', 'Customer'),
                ...work('Staffing Worker Document', 'Staffing Shift', 'Staffing Timesheet', 'Staffing Station', 'Staffing Unit'),
                ...read('Staffing Process', 'Staffing Unit Event'),
                {document: 'Staffing Station', action: 'linkDevice'},
                {document: 'Staffing Station', action: 'useThisDevice'},
                {document: 'Staffing Timesheet', action: 'transition'},
                {document: 'Staffing Timesheet', action: 'generateWeek'},
                {document: 'Staffing Worker', action: 'sendClockLink'},
            ],
        },
    ];
}
