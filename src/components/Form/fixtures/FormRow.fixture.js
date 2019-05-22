import { HelpFormRow, ValidationFormRow } from '../FormRow';
import { VALIDATION_ERROR_TYPE } from '../../../constants';

export default [
  {
    component: HelpFormRow,
    name: 'HelpFormRow',
    props: {
      id: '1',
      children: 'text',
      onChange: () => {},
    },
  },
  {
    component: ValidationFormRow,
    name: 'error ValidationFormRow',
    props: {
      id: '1',
      children: 'test',
      validation: {
        message: 'error validation',
        type: VALIDATION_ERROR_TYPE,
      },
      onChange: () => {},
    },
  },
];
