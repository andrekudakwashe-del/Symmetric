import React from 'react';
import { Customer, Salesperson } from '../../types';
import { Form3CustomerChange } from './Form3CustomerChange';

interface Form3SalesEntryProps {
  currentUser: Salesperson;
  preselectedCustomer?: Customer | string | null;
  onNavigateToCashLog?: () => void;
  onNavigateToHome?: () => void;
  onNavigateToReconcile?: () => void;
}

export const Form3SalesEntry: React.FC<Form3SalesEntryProps> = ({
  currentUser,
  preselectedCustomer = null,
  onNavigateToCashLog,
  onNavigateToHome,
  onNavigateToReconcile,
}) => {
  return (
    <Form3CustomerChange
      currentUser={currentUser}
      preselectedCustomer={preselectedCustomer}
      onNavigateToCashLog={onNavigateToCashLog}
      onNavigateToHome={onNavigateToHome}
      onNavigateToReconcile={onNavigateToReconcile}
    />
  );
};
export default Form3SalesEntry;
