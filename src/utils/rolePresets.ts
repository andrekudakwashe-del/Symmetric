import { StaffPermissions } from '../types';

export const getRolePresetPermissions = (role: string): StaffPermissions => {
  const normRole = (role || '').toUpperCase();

  if (normRole === 'OWNER' || normRole === 'SUPER_ADMIN' || normRole === 'ADMIN') {
    return {
      canEditCartPrice: true,
      canApplyCartDiscount: true,
      canDeleteCartItem: true,
      canClearCart: true,
      canManageInventory: true,
      canEditPriceCost: true,
      canSellNegativeStock: true,
      canReceiveGRN: true,
      canBreakCases: true,
      canAccessReports: true,
      canManageExpenses: true,
      canPerformShiftEnd: true,
      canManageStaff: true,
      canCreateDirectGrv: true,
      canApproveDirectGrv: true,
      canUseCustomerChange: true,
      canIssueCustomerCredit: true,
      canSubmitEOD: true,
      canApproveEOD: true,
      canViewVarianceInvestigation: true,
      canViewAuditLog: true,
      canPinOverride: true,
      canManageCompany: true,
      canEditMasterPrice: true,
      canEditExchangeRate: true, // Owner-only by default
      canSeeMargin: true,
      // Cash Custody Chain & Accounts Clerk Permissions
      canCreateCashTransferFloat: true,
      canCollectTillTransfer: true,
      canPaySupplierTransfer: true,
      canCreateBankDepositTransfer: true,
      canReceiveHqTransfer: true,
      canExecuteOwnerOverride: true,
    };
  }

  if (normRole === 'BRANCH_MANAGER' || normRole === 'MANAGER') {
    return {
      canEditCartPrice: true,
      canApplyCartDiscount: true,
      canDeleteCartItem: true,
      canClearCart: true,
      canManageInventory: true,
      canEditPriceCost: false, // Edit Master Price OFF
      canSellNegativeStock: true,
      canReceiveGRN: true,
      canBreakCases: true,
      canAccessReports: true,
      canManageExpenses: true,
      canPerformShiftEnd: true,
      canManageStaff: true,
      canCreateDirectGrv: true,
      canApproveDirectGrv: true,
      canUseCustomerChange: true,
      canIssueCustomerCredit: true,
      canSubmitEOD: true,
      canApproveEOD: true,
      canViewVarianceInvestigation: true,
      canViewAuditLog: true,
      canPinOverride: true,
      canManageCompany: false, // Manage Company OFF
      canEditMasterPrice: false, // Edit Master Price OFF
      canEditExchangeRate: false, // Exchange Rate OFF without Owner assignment
      canSeeMargin: true,
      canAuditStocktake: false,
      canPerformDailyBlindCount: true,
    };
  }

  if (normRole === 'SUPERVISOR') {
    return {
      canEditCartPrice: true,
      canApplyCartDiscount: true,
      canDeleteCartItem: true,
      canClearCart: true,
      canManageInventory: true,
      canEditPriceCost: false,
      canSellNegativeStock: true,
      canReceiveGRN: true,
      canBreakCases: true,
      canAccessReports: true,
      canManageExpenses: true,
      canPerformShiftEnd: true,
      canManageStaff: false,
      canCreateDirectGrv: false,
      canApproveDirectGrv: true, // Approve GRV ON
      canUseCustomerChange: true,
      canIssueCustomerCredit: true,
      canSubmitEOD: false,
      canApproveEOD: true, // Approve EOD ON
      canViewVarianceInvestigation: true, // View Variance ON
      canViewAuditLog: true,
      canPinOverride: true, // PIN Override ON
      canManageCompany: false,
      canEditMasterPrice: false,
      canEditExchangeRate: false,
      canSeeMargin: true,
      canAuditStocktake: false,
      canPerformDailyBlindCount: true,
    };
  }

  if (normRole === 'CASHIER' || normRole === 'STAFF') {
    return {
      canEditCartPrice: false,
      canApplyCartDiscount: false,
      canDeleteCartItem: false, // Delete Item OFF
      canClearCart: false, // Clear Cart OFF
      canManageInventory: false,
      canEditPriceCost: false,
      canSellNegativeStock: false,
      canReceiveGRN: false,
      canBreakCases: false,
      canAccessReports: false,
      canManageExpenses: false,
      canPerformShiftEnd: false,
      canManageStaff: false,
      canCreateDirectGrv: true, // Create GRV ON
      canApproveDirectGrv: false,
      canUseCustomerChange: true, // Use Change ON
      canIssueCustomerCredit: true, // Issue Credit ON
      canSubmitEOD: true, // Submit EOD ON
      canApproveEOD: false,
      canViewVarianceInvestigation: false,
      canViewAuditLog: false,
      canPinOverride: false,
      canManageCompany: false,
      canEditMasterPrice: false,
      canEditExchangeRate: false,
      canSeeMargin: false, // See Margin OFF
      canAuditStocktake: false,
      canPerformDailyBlindCount: false,
    };
  }

  if (normRole === 'STOCK_CLERK' || normRole === 'CLERK') {
    return {
      canEditCartPrice: false,
      canApplyCartDiscount: false,
      canDeleteCartItem: false,
      canClearCart: false,
      canManageInventory: true,
      canEditPriceCost: false,
      canSellNegativeStock: false,
      canReceiveGRN: true, // GRN Only ON
      canBreakCases: true,
      canAccessReports: false,
      canManageExpenses: false,
      canPerformShiftEnd: false,
      canManageStaff: false,
      canCreateDirectGrv: false,
      canApproveDirectGrv: false,
      canUseCustomerChange: false,
      canIssueCustomerCredit: false,
      canSubmitEOD: false,
      canApproveEOD: false,
      canViewVarianceInvestigation: false,
      canViewAuditLog: false,
      canPinOverride: false,
      canManageCompany: false,
      canEditMasterPrice: false,
      canEditExchangeRate: false,
      canSeeMargin: false,
      canAuditStocktake: false,
      canPerformDailyBlindCount: true,
    };
  }

  return getRolePresetPermissions('CASHIER');
};
