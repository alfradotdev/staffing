'use strict';

import { ListLayout } from '@loopar/list';
import { loopar } from 'loopar';
import { Button } from '@cn/components/ui/button';
import { CalendarRange, Download } from 'lucide-react';

const lastMonday = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
  return d.toISOString().slice(0, 10);
};

/** Timesheet list + "Generate week": Draft timesheets from the completed shifts of a week. */
export default function StaffingTimesheetList() {
  const generate = (e) => {
    e.preventDefault();
    const values = { week_start: lastMonday() };
    loopar.dialog({
      type: 'confirm',
      title: 'Generate timesheets',
      content: (
        <label className="block space-y-1.5 text-left">
          <span className="text-sm font-medium">Any day of the week</span>
          <input
            type="date"
            defaultValue={values.week_start}
            onChange={(ev) => { values.week_start = ev.target.value; }}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          />
          <span className="block text-xs text-muted-foreground">
            Creates or rebuilds the Draft timesheet of every worker with completed shifts that week.
          </span>
        </label>
      ),
      ok: () => loopar.call('Staffing Timesheet', 'generateWeek', {
        body: values,
        success: (r) => {
          loopar.notify?.(`Week of ${r.week}: ${r.created} created, ${r.updated} updated, ${r.skipped} already submitted.`);
          loopar.refresh();
        },
      }),
    });
  };

  const weekDialog = (title, description, onOk) => {
    const values = { week_start: lastMonday() };
    loopar.dialog({
      type: 'confirm',
      title,
      content: (
        <label className="block space-y-1.5 text-left">
          <span className="text-sm font-medium">Any day of the week</span>
          <input
            type="date"
            defaultValue={values.week_start}
            onChange={(ev) => { values.week_start = ev.target.value; }}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          />
          <span className="block text-xs text-muted-foreground">{description}</span>
        </label>
      ),
      ok: () => onOk(values),
    });
  };

  const exportPayroll = (e) => {
    e.preventDefault();
    weekDialog('Export payroll', 'Downloads a CSV of the Approved timesheets of that week and marks them Exported.', (values) =>
      loopar.call('Staffing Timesheet', 'exportPayroll', {
        body: values,
        success: (r) => {
          const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
          const a = Object.assign(document.createElement('a'), { href: url, download: r.filename });
          a.click();
          URL.revokeObjectURL(url);
          loopar.notify(`Exported ${r.count} timesheet(s) in batch ${r.batch}.`);
          loopar.refresh();
        },
      }));
  };

  return (
    <ListLayout
      actions={{
        generateWeek: (
          <Button key="generateWeek" variant="secondary" onClick={generate}>
            <CalendarRange className="mr-2 size-4" /> Generate week
          </Button>
        ),
        exportPayroll: (
          <Button key="exportPayroll" variant="secondary" onClick={exportPayroll}>
            <Download className="mr-2 size-4" /> Export payroll
          </Button>
        ),
      }}
    />
  );
}
