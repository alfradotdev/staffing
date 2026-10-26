'use strict';

import { useDocument } from '@loopar/document';
import { PrintLayout, LetterheadBlock, LetterheadFooter, formatPrintValue } from '@loopar/print';

/**
 * Print format of a Staffing Invoice (`/desk/Staffing Invoice/print?name=…`).
 * Company data comes from the default Letterhead; colors from the paper
 * palette of @loopar/print (--lp-*), never from the theme.
 */

const money = (v) => `$${formatPrintValue('money', v ?? 0) ?? '0.00'}`;
const hours = (v) => formatPrintValue('decimal', v ?? 0) ?? '0';
const date = (v) => formatPrintValue('date', v) || '—';
const rows = (v) => {
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
};

const muted = { color: 'var(--lp-muted)' };

function Kicker({ children }) {
  return <p className="lp-label" style={{ marginBottom: 4 }}>{children}</p>;
}

export function InvoiceSheet({ doc = {}, titles = {} }) {
  const title = (entity, name) => titles?.[entity]?.[name] || name;
  const lines = rows(doc.lines);

  return (
    <div className="flex flex-col gap-6">
      <LetterheadBlock />

      <header className="flex flex-wrap items-end justify-between gap-4 pb-4" style={{ borderBottom: '2px solid var(--lp-ink)' }}>
        <p style={{ fontSize: '18pt', fontWeight: 700, lineHeight: 1.15 }}>Invoice</p>
        <div className="text-right">
          <p style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{doc.name}</p>
          <p style={{ ...muted, fontSize: '9pt' }}>Status: {doc.status || 'Draft'}</p>
        </div>
      </header>

      <section className="grid grid-cols-3 gap-6">
        <div>
          <Kicker>Bill to</Kicker>
          <p style={{ fontWeight: 600 }}>{title('Staffing Client', doc.client)}</p>
          {doc.bill_to_email && <p style={muted}>{doc.bill_to_email}</p>}
        </div>
        <div>
          <Kicker>Service period</Kicker>
          <p>{date(doc.period_start)} – {date(doc.period_end)}</p>
        </div>
        <div className="text-right">
          <Kicker>Dates</Kicker>
          <p>Issued {date(doc.invoice_date)}</p>
          <p style={{ fontWeight: 600 }}>Due {date(doc.due_date)}</p>
          {doc.payment_terms && <p style={muted}>{doc.payment_terms}</p>}
        </div>
      </section>

      <section>
        <table className="lp-table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Position</th>
              <th className="lp-num">Hours</th>
              <th className="lp-num">Rate</th>
              <th className="lp-num">OT hours</th>
              <th className="lp-num">OT rate</th>
              <th className="lp-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{title('Staffing Site', l.site)}</td>
                <td>{l.position}</td>
                <td className="lp-num">{hours(l.hours)}</td>
                <td className="lp-num">{money(l.bill_rate)}</td>
                <td className="lp-num">{hours(l.overtime_hours)}</td>
                <td className="lp-num">{money(l.overtime_rate)}</td>
                <td className="lp-num">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="ml-auto w-full max-w-xs space-y-1">
        <div className="flex justify-between"><span style={muted}>Subtotal</span><span className="lp-num">{money(doc.subtotal)}</span></div>
        {Number(doc.tax_amount) > 0 && (
          <div className="flex justify-between"><span style={muted}>Tax ({hours(doc.tax_rate)}%)</span><span className="lp-num">{money(doc.tax_amount)}</span></div>
        )}
        <div className="flex justify-between pt-2" style={{ borderTop: '2px solid var(--lp-ink)' }}>
          <span style={{ fontWeight: 700 }}>Total</span>
          <span className="lp-num" style={{ fontSize: '16pt', fontWeight: 800 }}>{money(doc.total)}</span>
        </div>
        {Number(doc.amount_paid) > 0 && (
          <div className="flex justify-between"><span style={muted}>Paid</span><span className="lp-num">{money(doc.amount_paid)}</span></div>
        )}
        <div className="flex justify-between"><span style={{ fontWeight: 600 }}>Balance due</span><span className="lp-num" style={{ fontWeight: 600 }}>{money(doc.balance)}</span></div>
      </section>

      {doc.notes && (
        <section>
          <Kicker>Notes</Kicker>
          <p className="whitespace-pre-wrap" style={muted}>{doc.notes}</p>
        </section>
      )}

      <LetterheadFooter />
    </div>
  );
}

export default function StaffingInvoicePrint() {
  const { Document } = useDocument();
  return (
    <PrintLayout>
      <InvoiceSheet doc={Document?.data || {}} titles={Document?.linkTitles} />
    </PrintLayout>
  );
}
