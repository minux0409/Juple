/**
 * Shared by PurchaseEditorScreen and RepeatPurchaseLogPurchaseScreen, since log-purchase's
 * Amount/Store/Variant/Quantity/Memo fields go through the same backend PurchaseFieldsNormalizer as
 * a plain Purchase create/update (see LogPurchaseCommand). Validates shape only - never converts a
 * decimal string to a number, since a value like "999999999999999.9999" is exactly representable as
 * a Backend decimal(19,4) but not as a JS Number.
 */

/**
 * Returns the trimmed string unchanged, null for an empty field, or 'invalid' for anything that
 * isn't a plain non-negative decimal (rejects exponent notation, thousands separators,
 * "NaN"/"Infinity", and any other non-digit content). The backend remains the final validation
 * authority (decimal scale/precision, range) - this only rejects clearly-invalid text before it is
 * ever sent, and the original digits always reach the backend verbatim.
 */
export function validateOptionalDecimalText(text: string): string | null | 'invalid' {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : 'invalid';
}

/** True for "0", "0.0", "00.000", etc. - checked as text so a zero value is caught without ever parsing the string to a number. */
export function isZeroDecimalText(text: string): boolean {
  return /^0+(\.0+)?$/.test(text);
}

export function getLengthValidationError(value: string, field: string, maxLength: number): string | null {
  if (value.trim().length > maxLength) {
    return `${field}은(는) ${maxLength}자 이하로 입력해 주세요.`;
  }
  return null;
}
