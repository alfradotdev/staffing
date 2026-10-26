
'use strict';

import {CoreInstaller, loopar} from 'loopar';

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
     * Child tables (contacts, lines, worker positions) are saved through
     * their parent and need no grant of their own.
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
                ...read('Staffing Position', 'Staffing Site', 'Staffing Client', 'Staffing Shift'),
            ],
        },
        {
            name: 'Staffing Supervisor',
            description: 'Runs a site day to day: schedules shifts and assignments, records check-in/out, sends clock links, sets up scanning stations, submits weekly timesheets and keeps worker documents up to date.',
            is_system_role: 1,
            grants: [
                ...read('Staffing Worker', 'Staffing Site', 'Staffing Client', 'Staffing Position'),
                ...work('Staffing Worker Document', 'Staffing Shift', 'Staffing Timesheet', 'Staffing Station', 'Staffing Unit'),
                ...read('Staffing Process', 'Staffing Unit Event'),
                {document: 'Staffing Station', action: 'linkDevice'},
                {document: 'Staffing Timesheet', action: 'transition'},
                {document: 'Staffing Timesheet', action: 'generateWeek'},
                {document: 'Staffing Worker', action: 'sendClockLink'},
            ],
        },
    ];
}
