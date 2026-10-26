'use strict';

import { BaseContactFormController } from 'loopar';

/** Pipeline moves (including Create opportunity) go through the generic `transition` action. */
export default class StaffingInquiryController extends BaseContactFormController {
  constructor(props) {
    super(props);
  }
}
