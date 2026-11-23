/**
 * Pure Integer-Paisa Financial Utilities.
 * Zero floating-point arithmetic is used for any monetary calculation.
 * 1 INR = 100 Paisa (integer).
 */

/**
 * Formats integer paisa into Indian Rupee string (e.g., 124550 -> "₹1,245.50").
 */
export function formatPaisaToInr(paisa: number): string {
  const safePaisa = Number.isFinite(paisa) ? Math.round(paisa) : 0;
  const isNegative = safePaisa < 0;
  const absPaisa = Math.abs(safePaisa);
  const rupees = Math.floor(absPaisa / 100);
  const remPaisa = absPaisa % 100;

  const formattedRupees = rupees.toLocaleString('en-IN');
  const paddedPaisa = String(remPaisa).padStart(2, '0');
  return `${isNegative ? '-' : ''}₹${formattedRupees}.${paddedPaisa}`;
}

/**
 * Formats integer paisa as a plain decimal string for Excel/CSV/PDF tables (e.g., "1245.50").
 */
export function paisaToDecimalString(paisa: number): string {
  const safePaisa = Number.isFinite(paisa) ? Math.round(paisa) : 0;
  const isNegative = safePaisa < 0;
  const absPaisa = Math.abs(safePaisa);
  const rupees = Math.floor(absPaisa / 100);
  const remPaisa = absPaisa % 100;
  return `${isNegative ? '-' : ''}${rupees}.${String(remPaisa).padStart(2, '0')}`;
}

/**
 * Safely parses a user-entered rupee string (e.g., "145.50") into exact integer paisa
 * using string splitting instead of float multiplication.
 */
export function rupeeInputToPaisa(input: string | number): number {
  const raw = String(input).trim().replace(/,/g, '');
  if (!raw) return 0;
  const negative = raw.startsWith('-');
  const clean = negative ? raw.slice(1) : raw;
  if (!/^\d+(\.\d*)?$/.test(clean)) return 0;

  const [wholePart, fracPart = ''] = clean.split('.');
  const rupeesInt = parseInt(wholePart || '0', 10);
  const paddedFrac = (fracPart + '00').slice(0, 2);
  const paisaInt = parseInt(paddedFrac, 10);
  const total = rupeesInt * 100 + paisaInt;
  return negative ? -total : total;
}

/**
 * Formats GST basis points (e.g., 500 -> "5%", 1200 -> "12%").
 */
export function formatGstBps(gstBps: number): string {
  const pct = gstBps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
}

/**
 * Computes integer-paisa line tax using basis points and milli-unit quantities.
 */
export function computeLineTaxPaisa(
  unitPricePaisa: number,
  quantity: number,
  gstBps: number,
  isInterState: boolean
): {
  lineSubtotalPaisa: number;
  cgstPaisa: number;
  sgstPaisa: number;
  igstPaisa: number;
  lineTaxPaisa: number;
  lineTotalPaisa: number;
} {
  const qtyMilli = Math.round(quantity * 1000);
  const lineSubtotalPaisa = Math.round((unitPricePaisa * qtyMilli) / 1000);
  const lineTaxPaisa = Math.round((lineSubtotalPaisa * gstBps) / 10000);

  let cgstPaisa = 0;
  let sgstPaisa = 0;
  let igstPaisa = 0;

  if (isInterState) {
    igstPaisa = lineTaxPaisa;
  } else {
    cgstPaisa = Math.floor(lineTaxPaisa / 2);
    sgstPaisa = lineTaxPaisa - cgstPaisa;
  }

  return {
    lineSubtotalPaisa,
    cgstPaisa,
    sgstPaisa,
    igstPaisa,
    lineTaxPaisa,
    lineTotalPaisa: lineSubtotalPaisa + lineTaxPaisa,
  };
}
