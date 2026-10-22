import { daysEnding } from './workspace.ts';
export const expenseBase = '/api/v1/admin/expenses';
export const categories = {
  Cloud: '클라우드',
  DeveloperProgram: '개발자 프로그램',
  Domain: '도메인',
  Software: '개발 도구',
  Design: '디자인',
  Advertising: '광고',
  Fees: '수수료',
  Other: '기타',
  AppleDeveloper: 'Apple Developer Program',
  GooglePlayConsole: 'Google Play Console',
  EmailSmsApi: '이메일 · SMS · 외부 API',
  Accounting: '회계 · 세무 · 사업자',
} as const;
export const statuses = {
  Paid: '결제 완료',
  Estimated: '추정 / 예정',
  Cancelled: '취소',
  Provisional: '잠정 / 미확정 청구',
} as const;
export type Category = keyof typeof categories;
export type Status = keyof typeof statuses;
export interface ExpenseValues {
  name: string;
  provider: string;
  category: Category;
  occurredOn: string;
  paidOn: string | null;
  currency: string;
  netAmount: string | null;
  taxAmount: string | null;
  grossAmount: string;
  paymentMethod: string;
  status: Status;
  kind: 'Charge' | 'Refund' | 'Adjustment';
  invoiceReference: string | null;
  memo: string | null;
  convertedCurrency: string | null;
  exchangeRate: string | null;
  exchangeRateOn: string | null;
  originalExpenseId: number | null;
  customCategory?: string | null;
  periodFrom?: string | null;
  periodThrough?: string | null;
  exchangeRateSource?: string | null;
  serviceName?: string | null;
}
export interface Expense extends ExpenseValues {
  id: number;
  requestId: string;
  revision: number;
  source: 'Manual' | 'Recurring' | 'Azure';
  reconciledByExpenseId: number | null;
  noLongerReported: boolean;
  subscriptionId: string | null;
  resourceGroup: string | null;
  environment: string | null;
  serviceName: string | null;
  rawImportedAmount: string | null;
}
export interface Evidence {
  id: number;
  fileName: string;
  contentType: string;
  bytes: number;
  createdAtUtc: string;
}
export interface ExpenseRow {
  expense: Expense;
  attachments: Evidence[];
}
export interface ExpensePage {
  items: ExpenseRow[];
  nextCursor: number | null;
}
export interface ExpenseConfig {
  enabled: boolean;
  azureSyncEnabled: boolean;
  azureInsightsEnabled?: boolean;
  evidenceScanningConfigured: boolean;
  azureScopes: { scope: string; environment: string; allowWholeSubscription?: boolean }[];
  pricing: {
    monthlyUsdReferencePrice: number;
    currency: string;
    trialDays: number;
  };
}
export interface Total {
  currency: string;
  status: Status;
  gross: number;
  net: number | null;
  tax: number | null;
  rows: number;
  missingEvidence: number;
  unknownTax: number;
}
export interface Breakdown {
  currency: string;
  status: Status;
  label: string;
  gross: number;
}
export interface Summary {
  totals: Total[];
  months: Breakdown[];
  categories: Breakdown[];
  services: Breakdown[];
  days?: Breakdown[];
  sources?: Breakdown[];
}
export interface Schedule {
  schedule: {
    id: number;
    templateExpenseId: number;
    frequency: 'Monthly' | 'Yearly';
    nextDueOn: string;
    isEnabled: boolean;
    revision: number;
  };
  name: string;
  provider: string;
  currency: string;
  grossAmount: number;
}
export interface SyncRun {
  id: number;
  scope: string;
  environment: string;
  month: string;
  lastSuccessAtUtc: string | null;
  lastStartedAtUtc: string | null;
  status: string;
  failureCode: string | null;
  importedRows: number;
}
export interface Audit {
  id: number;
  adminUserId: number | null;
  action: string;
  beforeJson: string | null;
  afterJson: string | null;
  createdAtUtc: string;
}
export interface Filters {
  search: string;
  sort: string;
  from: string;
  through: string;
  category: string;
  currency: string;
  provider: string;
  paymentMethod: string;
  status: string;
  environment: string;
  serviceName: string;
}
export function initialFilters(today: string): Filters {
  return {
    ...daysEnding(today, 7),
    search: '',
    sort: 'newest',
    category: '',
    currency: '',
    provider: '',
    paymentMethod: '',
    status: '',
    environment: '',
    serviceName: '',
  };
}
export function expenseQuery(filters: Filters, cursor?: number | null): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value.trim()) query.set(key, value.trim());
  if (cursor) query.set('cursor', String(cursor));
  return query.toString();
}
export function blankExpense(today: string): ExpenseValues {
  return {
    name: '',
    provider: '',
    category: 'Other',
    occurredOn: today,
    paidOn: null,
    currency: 'KRW',
    netAmount: null,
    taxAmount: null,
    grossAmount: '',
    paymentMethod: '',
    status: 'Estimated',
    kind: 'Charge',
    invoiceReference: null,
    memo: null,
    convertedCurrency: null,
    exchangeRate: null,
    exchangeRateOn: null,
    originalExpenseId: null,
  };
}
export function validateExpense(value: ExpenseValues): string | null {
  if (
    !value.name.trim() ||
    !value.provider.trim() ||
    !value.paymentMethod.trim()
  )
    return '비용 이름, 공급자, 결제 수단을 입력하세요.';
  if (!/^[A-Z]{3}$/.test(value.currency))
    return '통화는 KRW, USD 등 대문자 ISO 코드로 입력하세요.';
  if (!/^-?\d+(\.\d{1,12})?$/.test(value.grossAmount))
    return '합계 금액을 입력하세요. 소수점은 최대 12자리입니다.';
  if (value.status === 'Paid' && !value.paidOn)
    return '실제 결제일을 입력하세요.';
  if (!!value.periodFrom !== !!value.periodThrough || (value.periodFrom && value.periodThrough && value.periodFrom > value.periodThrough))
    return '비용 귀속 기간의 시작일과 종료일을 순서대로 입력하세요.';
  if (value.customCategory && value.category !== 'Other') return '사용자 정의 분류는 기타 항목에서 입력하세요.';
  if ((value.netAmount === null) !== (value.taxAmount === null))
    return '공급가액과 세액을 함께 입력하거나 둘 다 비워 두세요.';
  if (
    value.kind === 'Refund' &&
    (!value.originalExpenseId || Number(value.grossAmount) >= 0)
  )
    return '환불 원본 비용 ID와 음수 금액을 입력하세요.';
  if (value.convertedCurrency || value.exchangeRate || value.exchangeRateOn) {
    if (
      !value.convertedCurrency ||
      !value.exchangeRate ||
      !value.exchangeRateOn ||
      Number(value.exchangeRate) <= 0
    )
      return '환산 통화, 양수 환율, 환율 기준일을 함께 입력하세요.';
  }
  return null; // Exact decimal arithmetic, tax reconciliation and concurrent edits are validated again in SQL-backed API.
}
export function money(
  amount: string | number | null,
  currency: string,
): string {
  if (amount === null) return '미확인';
  try {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 4,
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
