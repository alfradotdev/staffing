'use strict';

import { useForm, FormLayout } from '@loopar/form';
import { loopar } from 'loopar';
import { Button } from '@cn/components/ui/button';
import { ExternalLink } from 'lucide-react';

const workerUrl = (name) => `/desk/Staffing Worker/update?name=${encodeURIComponent(name)}`;

/**
 * Pipeline actions (Screening, Interview, Hire…) come from the workflow.
 * This view only adds a shortcut to the hired worker. `children` must be
 * passed through: the website's contact_form element renders this same
 * component and injects the honeypot, captcha and Send button as children.
 */
export default function StaffingApplicantForm({ children }) {
  const { getValue } = useForm();
  const worker = getValue('worker');

  const actions = worker ? {
    openWorker: (
      <Button variant="link" onClick={(e) => { e.preventDefault(); loopar.navigate(workerUrl(worker)); }}>
        <ExternalLink className="mr-2" /> Open worker
      </Button>
    ),
  } : {};

  return <FormLayout actions={actions}>{children}</FormLayout>;
}
