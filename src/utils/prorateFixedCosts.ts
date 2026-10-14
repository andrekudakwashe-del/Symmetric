import { FixedMonthlyCost } from '../types';

export interface ProratedFixedCostItem {
  cost: FixedMonthlyCost;
  monthlyAmount: number;
  dailyRate: number;
  overlapDays: number;
  daysInMonth: number;
  proratedAmount: number;
  formulaDisplay: string;
}

export interface ProrationResult {
  startDate: string;
  endDate: string;
  totalDays: number;
  totalProratedAmount: number;
  items: ProratedFixedCostItem[];
}

/**
 * Prorates monthly fixed costs for any arbitrary date range using true calendar daily rates.
 * Like QuickBooks & Accrual Accounting:
 * For each month in the range:
 * days_in_month = new Date(year, month + 1, 0).getDate()
 * daily_rate = monthly_amount / days_in_month
 * prorated_amount = sum(daily_rate for each active overlapping day in range)
 */
export function calculateProratedFixedCosts(
  fixedCosts: FixedMonthlyCost[],
  startDate: string,
  endDate: string,
  targetCurrency: 'USD' | 'ZiG' = 'USD'
): ProrationResult {
  const start = new Date(startDate);
  const end = new Date(endDate);

  // If invalid dates, return 0
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return {
      startDate,
      endDate,
      totalDays: 0,
      totalProratedAmount: 0,
      items: [],
    };
  }

  // Generate list of ISO dates (YYYY-MM-DD) in the range inclusive
  const dateList: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    dateList.push(`${y}-${m}-${d}`);
    current.setDate(current.getDate() + 1);
  }

  const totalDays = dateList.length;

  // Filter costs by currency and active state
  const activeCosts = fixedCosts.filter(
    (c) => !c.is_deleted && c.is_active && (!c.currency || c.currency === targetCurrency)
  );

  let totalProratedSum = 0;
  const items: ProratedFixedCostItem[] = [];

  for (const cost of activeCosts) {
    let costProratedAmount = 0;
    let overlapDays = 0;

    // Normalizing effective dates (support YYYY-MM and YYYY-MM-DD)
    const effectiveFrom = cost.effective_from_date.length === 7
      ? `${cost.effective_from_date}-01`
      : cost.effective_from_date;
    const effectiveTo = cost.effective_to_date
      ? (cost.effective_to_date.length === 7 ? `${cost.effective_to_date}-31` : cost.effective_to_date)
      : null;

    // Map month string YYYY-MM to its days count for quick reference
    const daysInMonthMap = new Map<string, number>();

    for (const dayStr of dateList) {
      if (dayStr >= effectiveFrom && (!effectiveTo || dayStr <= effectiveTo)) {
        overlapDays++;
        const monthKey = dayStr.slice(0, 7);
        if (!daysInMonthMap.has(monthKey)) {
          const [yr, mn] = monthKey.split('-').map(Number);
          const daysInM = new Date(yr, mn, 0).getDate();
          daysInMonthMap.set(monthKey, daysInM);
        }
        const daysInMonth = daysInMonthMap.get(monthKey)!;
        const dailyRate = cost.monthly_amount / daysInMonth;
        costProratedAmount += dailyRate;
      }
    }

    costProratedAmount = Math.round(costProratedAmount * 100) / 100;

    // Determine representative days_in_month for single month formula display
    const firstMonthKey = dateList[0]?.slice(0, 7) || new Date().toISOString().slice(0, 7);
    const [repYr, repMn] = firstMonthKey.split('-').map(Number);
    const repDaysInMonth = new Date(repYr, repMn, 0).getDate();
    const repDailyRate = Math.round((cost.monthly_amount / repDaysInMonth) * 100) / 100;

    const currSymbol = cost.currency === 'ZiG' ? 'ZiG ' : '$';

    let formulaDisplay = '';
    if (daysInMonthMap.size <= 1) {
      formulaDisplay = `${cost.name} - ${currSymbol}${cost.monthly_amount.toFixed(0)}/mo (prorated ${overlapDays}/${repDaysInMonth} = ${currSymbol}${costProratedAmount.toFixed(2)})`;
    } else {
      formulaDisplay = `${cost.name} - ${currSymbol}${cost.monthly_amount.toFixed(0)}/mo (prorated ${overlapDays} days = ${currSymbol}${costProratedAmount.toFixed(2)})`;
    }

    items.push({
      cost,
      monthlyAmount: cost.monthly_amount,
      dailyRate: repDailyRate,
      overlapDays,
      daysInMonth: repDaysInMonth,
      proratedAmount: costProratedAmount,
      formulaDisplay,
    });

    totalProratedSum += costProratedAmount;
  }

  return {
    startDate,
    endDate,
    totalDays,
    totalProratedAmount: Math.round(totalProratedSum * 100) / 100,
    items,
  };
}
