/**
 * Pure FactoryFlow / Order-to-Audit ERP Business Logic Engine
 *
 * All monetary arithmetic uses strict integer paisa (1 INR = 100 paisa).
 * All physical inventory quantities use milli-unit rounding (3 decimal places)
 * to eliminate IEEE-754 floating-point drift.
 *
 * Shared by:
 * - Node.js Express backend (/api/finance/*, /api/production/*, /api/ai/*)
 * - React frontend UI & Firestore service layer
 * - Automated test suite (tests/benchmark.test.ts)
 */

export function roundQty(val: number): number {
  return Math.round(val * 1000) / 1000;
}

export function formatPctFromBps(bps: number): string {
  const pct = bps / 100;
  const sign = pct > 0 ? '+' : '';
  return Number.isInteger(pct) ? `${sign}${pct}%` : `${sign}${pct.toFixed(2)}%`;
}

export interface OrderItemCalcInput {
  productId: string;
  sku: string;
  name: string;
  hsnCode: string;
  unit: string;
  quantity: number;
  unitPricePaisa: number;
  gstBps: number;
}

export interface OrderItemCalcOutput extends OrderItemCalcInput {
  lineSubtotalPaisa: number;
  cgstPaisa: number;
  sgstPaisa: number;
  igstPaisa: number;
  lineTaxPaisa: number;
  lineTotalPaisa: number;
}

export interface OrderCalcResult {
  isInterState: boolean;
  items: OrderItemCalcOutput[];
  subtotalPaisa: number;
  cgstPaisa: number;
  sgstPaisa: number;
  igstPaisa: number;
  totalTaxPaisa: number;
  totalAmountPaisa: number;
}

/**
 * Computes deterministic integer-paisa order & GST invoice totals.
 * Intra-state splits GST evenly into CGST + SGST; inter-state assigns full GST to IGST.
 */
export function calculateOrderTotals(
  companyStateCode: string,
  customerStateCode: string,
  items: OrderItemCalcInput[]
): OrderCalcResult {
  if (!/^[0-9]{2}$/.test(companyStateCode) || !/^[0-9]{2}$/.test(customerStateCode)) {
    throw new Error('Valid 2-digit GST state codes are required.');
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    throw new Error('Order must contain between 1 and 30 line items.');
  }

  const isInterState = companyStateCode !== customerStateCode;
  let subtotalPaisa = 0;
  let cgstPaisa = 0;
  let sgstPaisa = 0;
  let igstPaisa = 0;

  const calculatedItems: OrderItemCalcOutput[] = items.map((item, idx) => {
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error(`Invalid positive quantity for items[${idx}].quantity`);
    }
    if (
      typeof item.unitPricePaisa !== 'number' ||
      !Number.isInteger(item.unitPricePaisa) ||
      item.unitPricePaisa < 0
    ) {
      throw new Error(`Invalid integer-paisa value for items[${idx}].unitPricePaisa`);
    }
    if (
      typeof item.gstBps !== 'number' ||
      !Number.isInteger(item.gstBps) ||
      item.gstBps < 0 ||
      item.gstBps > 2800
    ) {
      throw new Error(`Invalid GST basis points for items[${idx}].gstBps`);
    }

    const qtyMilli = Math.round(item.quantity * 1000);
    const lineSubtotalPaisa = Math.round((item.unitPricePaisa * qtyMilli) / 1000);
    const lineTaxPaisa = Math.round((lineSubtotalPaisa * item.gstBps) / 10000);

    let lineCgst = 0;
    let lineSgst = 0;
    let lineIgst = 0;

    if (isInterState) {
      lineIgst = lineTaxPaisa;
    } else {
      lineCgst = Math.floor(lineTaxPaisa / 2);
      lineSgst = lineTaxPaisa - lineCgst;
    }

    subtotalPaisa += lineSubtotalPaisa;
    cgstPaisa += lineCgst;
    sgstPaisa += lineSgst;
    igstPaisa += lineIgst;

    return {
      productId: String(item.productId || ''),
      sku: String(item.sku || ''),
      name: String(item.name || ''),
      hsnCode: String(item.hsnCode || ''),
      unit: String(item.unit || ''),
      quantity: roundQty(item.quantity),
      unitPricePaisa: item.unitPricePaisa,
      gstBps: item.gstBps,
      lineSubtotalPaisa,
      cgstPaisa: lineCgst,
      sgstPaisa: lineSgst,
      igstPaisa: lineIgst,
      lineTaxPaisa,
      lineTotalPaisa: lineSubtotalPaisa + lineTaxPaisa,
    };
  });

  const totalTaxPaisa = cgstPaisa + sgstPaisa + igstPaisa;
  return {
    isInterState,
    items: calculatedItems,
    subtotalPaisa,
    cgstPaisa,
    sgstPaisa,
    igstPaisa,
    totalTaxPaisa,
    totalAmountPaisa: subtotalPaisa + totalTaxPaisa,
  };
}

/**
 * Computes weighted average cost in integer paisa when receiving a purchase into stock.
 */
export function calculatePurchaseStockUpdate(
  beforeQty: number,
  currentCostPerUnitPaisa: number,
  receivedQty: number,
  receivedUnitCostPaisa: number
): {
  afterQty: number;
  weightedCostPerUnitPaisa: number;
  incomingValuePaisa: number;
} {
  if (receivedQty <= 0) {
    throw new Error('Received quantity must be greater than zero.');
  }
  if (!Number.isInteger(receivedUnitCostPaisa) || receivedUnitCostPaisa < 0) {
    throw new Error('Unit cost must be a non-negative integer in paisa.');
  }
  const afterQty = roundQty(beforeQty + receivedQty);
  const existingValuePaisa = Math.round(beforeQty * currentCostPerUnitPaisa);
  const incomingValuePaisa = Math.round(receivedQty * receivedUnitCostPaisa);
  const weightedCostPerUnitPaisa =
    afterQty > 0
      ? Math.round((existingValuePaisa + incomingValuePaisa) / afterQty)
      : receivedUnitCostPaisa;

  return {
    afterQty,
    weightedCostPerUnitPaisa,
    incomingValuePaisa,
  };
}

export interface VarianceInput {
  plannedQty: number;
  actualOutputQty: number;
  wastageQty: number;
  bomBatchYieldQty: number;
  standardLaborCostPaisa: number;
  standardOverheadPaisa: number;
  standardMaterialPerBatchPaisa: number;
  actualMaterialCostPaisa: number;
}

export interface VarianceResult {
  standardCostPaisa: number;
  laborOverheadPaisa: number;
  actualMaterialCostPaisa: number;
  actualTotalCostPaisa: number;
  variancePaisa: number;
  unitActualCostPaisa: number;
  yieldEfficiencyBps: number;
  yieldVarianceBps: number;
  wastagePctBps: number;
}

/**
 * Computes deterministic integer-paisa BOM standard vs actual production cost,
 * yield variance in basis points (-600 bps = -6%), and unit cost.
 */
export function calculateProductionVariance(input: VarianceInput): VarianceResult {
  const {
    plannedQty,
    actualOutputQty,
    wastageQty,
    bomBatchYieldQty,
    standardLaborCostPaisa,
    standardOverheadPaisa,
    standardMaterialPerBatchPaisa,
    actualMaterialCostPaisa,
  } = input;

  if (plannedQty <= 0 || bomBatchYieldQty <= 0) {
    throw new Error('Planned quantity and BOM batch yield must be positive.');
  }

  const scaleMicro = Math.round((plannedQty / bomBatchYieldQty) * 1_000_000);
  const scaledStdMaterialPaisa = Math.round((standardMaterialPerBatchPaisa * scaleMicro) / 1_000_000);
  const scaledLaborOverheadPaisa = Math.round(
    ((standardLaborCostPaisa + standardOverheadPaisa) * scaleMicro) / 1_000_000
  );

  const standardCostPaisa = scaledStdMaterialPaisa + scaledLaborOverheadPaisa;
  const actualTotalCostPaisa = actualMaterialCostPaisa + scaledLaborOverheadPaisa;
  const variancePaisa = actualTotalCostPaisa - standardCostPaisa;

  const unitActualCostPaisa =
    actualOutputQty > 0 ? Math.round(actualTotalCostPaisa / actualOutputQty) : 0;
  const yieldEfficiencyBps = Math.round((actualOutputQty / plannedQty) * 10000);
  const yieldVarianceBps = Math.round(((actualOutputQty - plannedQty) / plannedQty) * 10000);
  const wastagePctBps =
    actualOutputQty + wastageQty > 0
      ? Math.round((wastageQty / (actualOutputQty + wastageQty)) * 10000)
      : 0;

  return {
    standardCostPaisa,
    laborOverheadPaisa: scaledLaborOverheadPaisa,
    actualMaterialCostPaisa,
    actualTotalCostPaisa,
    variancePaisa,
    unitActualCostPaisa,
    yieldEfficiencyBps,
    yieldVarianceBps,
    wastagePctBps,
  };
}

/**
 * Computes material consumption variance in basis points (+500 bps = +5%).
 */
export function calculateConsumptionVarianceBps(
  plannedQty: number,
  actualQty: number
): number {
  if (plannedQty <= 0) return 0;
  return Math.round(((actualQty - plannedQty) / plannedQty) * 10000);
}

/**
 * Checks stock availability for a requested order quantity and returns exact shortage.
 */
export function evaluateStockAvailability(
  requestedQty: number,
  availableStock: number
): {
  sufficient: boolean;
  availableQty: number;
  requestedQty: number;
  shortageQty: number;
} {
  const safeAvail = roundQty(Math.max(0, availableStock));
  const safeReq = roundQty(Math.max(0, requestedQty));
  const shortageQty = safeReq > safeAvail ? roundQty(safeReq - safeAvail) : 0;
  return {
    sufficient: shortageQty === 0,
    availableQty: safeAvail,
    requestedQty: safeReq,
    shortageQty,
  };
}

/**
 * Applies a payment receipt to an invoice in integer paisa.
 */
export function applyPaymentToInvoice(
  balanceDuePaisa: number,
  paidSoFarPaisa: number,
  paymentAmountPaisa: number
): {
  newPaidPaisa: number;
  newBalanceDuePaisa: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
} {
  if (!Number.isInteger(paymentAmountPaisa) || paymentAmountPaisa <= 0) {
    throw new Error('Payment amount must be a positive integer in paisa.');
  }
  if (paymentAmountPaisa > balanceDuePaisa) {
    throw new Error('Payment amount cannot exceed invoice balance due.');
  }
  const newPaidPaisa = paidSoFarPaisa + paymentAmountPaisa;
  const newBalanceDuePaisa = balanceDuePaisa - paymentAmountPaisa;
  const paymentStatus = newBalanceDuePaisa === 0 ? 'paid' : 'partial';
  return { newPaidPaisa, newBalanceDuePaisa, paymentStatus };
}

// ============================================================================
// Food Manufacturing FEFO, MRP Shortage Planning, Recall Traceability & Analytics
// ============================================================================

export interface FefoBatchCandidate {
  id: string;
  batchNumber: string;
  itemId: string;
  expiryDate: string;
  remainingQty: number;
  qcStatus: 'pending' | 'passed' | 'hold' | 'rejected';
}

export interface FefoAllocationResult {
  allocations: Array<{
    batchId: string;
    batchNumber: string;
    quantity: number;
    expiryDate: string;
    remainingAfter: number;
  }>;
  totalAllocated: number;
  shortageQty: number;
  expiredSkippedQty: number;
}

/**
 * First-Expired-First-Out (FEFO) batch allocator.
 * Filters out expired batches (< todayIso) and hold/rejected batches,
 * then consumes batches sorted strictly by earliest expiryDate ASC.
 */
export function allocateBatchesFEFO(
  batches: FefoBatchCandidate[],
  requestedQty: number,
  todayIso: string
): FefoAllocationResult {
  const safeReq = roundQty(Math.max(0, requestedQty));
  if (safeReq === 0) {
    return { allocations: [], totalAllocated: 0, shortageQty: 0, expiredSkippedQty: 0 };
  }

  let expiredSkippedQty = 0;
  const eligible = batches
    .filter((b) => {
      if (b.remainingQty <= 0) return false;
      if (b.qcStatus === 'rejected' || b.qcStatus === 'hold') return false;
      if (b.expiryDate && b.expiryDate < todayIso) {
        expiredSkippedQty = roundQty(expiredSkippedQty + b.remainingQty);
        return false;
      }
      return true;
    })
    .sort((a, b) => (a.expiryDate || '9999-12-31').localeCompare(b.expiryDate || '9999-12-31'));

  let needed = safeReq;
  let totalAllocated = 0;
  const allocations: FefoAllocationResult['allocations'] = [];

  for (const batch of eligible) {
    if (needed <= 0) break;
    const take = roundQty(Math.min(needed, batch.remainingQty));
    if (take > 0) {
      allocations.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        quantity: take,
        expiryDate: batch.expiryDate,
        remainingAfter: roundQty(batch.remainingQty - take),
      });
      needed = roundQty(needed - take);
      totalAllocated = roundQty(totalAllocated + take);
    }
  }

  return {
    allocations,
    totalAllocated,
    shortageQty: needed,
    expiredSkippedQty,
  };
}

export interface MaterialRequirementPlan {
  hasFgShortage: boolean;
  fgShortages: Array<{
    productId: string;
    sku: string;
    productName: string;
    requestedQty: number;
    availableStock: number;
    shortageQty: number;
    bomId?: string;
    canProduceImmediately: boolean;
  }>;
  rawMaterialShortages: Array<{
    itemId: string;
    code: string;
    name: string;
    unit: string;
    requiredQty: number;
    availableStock: number;
    shortageQty: number;
    costPerUnitPaisa: number;
  }>;
  packagingShortages: Array<{
    itemId: string;
    code: string;
    name: string;
    unit: string;
    requiredQty: number;
    availableStock: number;
    shortageQty: number;
    costPerUnitPaisa: number;
  }>;
}

/**
 * Evaluates a buyer or merchant order against Finished Goods stock and linked BOMs
 * to compute exact manufacturing shortfalls and raw/packaging procurement requirements.
 */
export function evaluateOrderFulfillmentPlan(params: {
  orderItems: Array<{ productId: string; sku: string; name: string; quantity: number }>;
  products: Array<{ id: string; currentStock: number }>;
  boms: Array<{
    id: string;
    productId: string;
    batchYieldQty: number;
    rawMaterialItems: Array<{
      itemId: string;
      code: string;
      name: string;
      unit: string;
      qtyPerBatch: number;
      costPerUnitPaisa: number;
    }>;
    packagingItems: Array<{
      itemId: string;
      code: string;
      name: string;
      unit: string;
      qtyPerBatch: number;
      costPerUnitPaisa: number;
    }>;
  }>;
  rawMaterials: Array<{ id: string; currentStock: number; costPerUnitPaisa: number }>;
  packagingMaterials: Array<{ id: string; currentStock: number; costPerUnitPaisa: number }>;
}): MaterialRequirementPlan {
  const fgShortages: MaterialRequirementPlan['fgShortages'] = [];
  const rawNeedMap = new Map<
    string,
    { itemId: string; code: string; name: string; unit: string; requiredQty: number; costPerUnitPaisa: number }
  >();
  const pkgNeedMap = new Map<
    string,
    { itemId: string; code: string; name: string; unit: string; requiredQty: number; costPerUnitPaisa: number }
  >();

  for (const item of params.orderItems) {
    const prod = params.products.find((p) => p.id === item.productId);
    const avail = prod ? prod.currentStock : 0;
    const check = evaluateStockAvailability(item.quantity, avail);
    if (!check.sufficient) {
      const bom = params.boms.find((b) => b.productId === item.productId);
      let canProduceImmediately = false;
      if (bom && bom.batchYieldQty > 0) {
        const scale = check.shortageQty / bom.batchYieldQty;
        canProduceImmediately = true;

        for (const rm of bom.rawMaterialItems) {
          const need = roundQty(rm.qtyPerBatch * scale);
          const cur = rawNeedMap.get(rm.itemId);
          rawNeedMap.set(rm.itemId, {
            itemId: rm.itemId,
            code: rm.code,
            name: rm.name,
            unit: rm.unit,
            requiredQty: roundQty((cur?.requiredQty || 0) + need),
            costPerUnitPaisa: rm.costPerUnitPaisa,
          });
        }
        for (const pm of bom.packagingItems) {
          const need = Math.ceil(pm.qtyPerBatch * scale);
          const cur = pkgNeedMap.get(pm.itemId);
          pkgNeedMap.set(pm.itemId, {
            itemId: pm.itemId,
            code: pm.code,
            name: pm.name,
            unit: pm.unit,
            requiredQty: roundQty((cur?.requiredQty || 0) + need),
            costPerUnitPaisa: pm.costPerUnitPaisa,
          });
        }
      }

      fgShortages.push({
        productId: item.productId,
        sku: item.sku,
        productName: item.name,
        requestedQty: item.quantity,
        availableStock: avail,
        shortageQty: check.shortageQty,
        bomId: bom?.id,
        canProduceImmediately,
      });
    }
  }

  const rawMaterialShortages: MaterialRequirementPlan['rawMaterialShortages'] = [];
  rawNeedMap.forEach((need) => {
    const rm = params.rawMaterials.find((r) => r.id === need.itemId);
    const avail = rm ? rm.currentStock : 0;
    const status = evaluateStockAvailability(need.requiredQty, avail);
    if (!status.sufficient) {
      rawMaterialShortages.push({
        itemId: need.itemId,
        code: need.code,
        name: need.name,
        unit: need.unit,
        requiredQty: need.requiredQty,
        availableStock: avail,
        shortageQty: status.shortageQty,
        costPerUnitPaisa: rm ? rm.costPerUnitPaisa : need.costPerUnitPaisa,
      });
    }
  });

  const packagingShortages: MaterialRequirementPlan['packagingShortages'] = [];
  pkgNeedMap.forEach((need) => {
    const pm = params.packagingMaterials.find((p) => p.id === need.itemId);
    const avail = pm ? pm.currentStock : 0;
    const status = evaluateStockAvailability(need.requiredQty, avail);
    if (!status.sufficient) {
      packagingShortages.push({
        itemId: need.itemId,
        code: need.code,
        name: need.name,
        unit: need.unit,
        requiredQty: need.requiredQty,
        availableStock: avail,
        shortageQty: status.shortageQty,
        costPerUnitPaisa: pm ? pm.costPerUnitPaisa : need.costPerUnitPaisa,
      });
    }
  });

  // Update canProduceImmediately if any raw or packaging material is short
  if (rawMaterialShortages.length > 0 || packagingShortages.length > 0) {
    fgShortages.forEach((f) => {
      f.canProduceImmediately = false;
    });
  }

  return {
    hasFgShortage: fgShortages.length > 0,
    fgShortages,
    rawMaterialShortages,
    packagingShortages,
  };
}

export interface DeterministicAiAnalytics {
  demandForecasts: Array<{
    productId: string;
    sku: string;
    productName: string;
    historicalSoldQty: number;
    currentStock: number;
    projectedNext30DaysQty: number;
    recommendedProductionQty: number;
    confidence: 'high' | 'medium' | 'low';
    rationale: string;
  }>;
  reorderRecommendations: Array<{
    itemType: 'raw_material' | 'packaging' | 'finished_good';
    itemId: string;
    code: string;
    name: string;
    unit: string;
    currentStock: number;
    reorderLevel: number;
    suggestedOrderQty: number;
    urgency: 'critical' | 'warning';
    estimatedCostPaisa: number;
  }>;
  nearExpiryAlerts: Array<{
    batchId: string;
    batchNumber: string;
    itemName: string;
    itemType: string;
    remainingQty: number;
    unit: string;
    expiryDate: string;
    daysRemaining: number;
    severity: 'expired' | 'critical_7d' | 'warning_30d';
  }>;
  unusualTransactions: Array<{
    id: string;
    category: 'wastage_spike' | 'cost_variance' | 'order_outlier' | 'oil_overuse';
    reference: string;
    severity: 'high' | 'medium';
    description: string;
  }>;
}

/**
 * Deterministic statistical analytics engine for AI Insights baseline & verification.
 */
export function computeDeterministicAiInsights(params: {
  todayIso: string;
  products: Array<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    currentStock: number;
    reorderLevel: number;
    standardCostPaisa: number;
  }>;
  rawMaterials: Array<{
    id: string;
    code: string;
    name: string;
    unit: string;
    currentStock: number;
    reorderLevel: number;
    costPerUnitPaisa: number;
  }>;
  packagingMaterials: Array<{
    id: string;
    code: string;
    name: string;
    unit: string;
    currentStock: number;
    reorderLevel: number;
    costPerUnitPaisa: number;
  }>;
  orders: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    totalAmountPaisa: number;
    status: string;
    items: Array<{ productId: string; quantity: number }>;
  }>;
  productionRuns: Array<{
    id: string;
    batchNumber: string;
    productName: string;
    plannedQty: number;
    actualOutputQty: number;
    wastageQty: number;
    standardCostPaisa: number;
    actualTotalCostPaisa: number;
    variancePaisa: number;
    status: string;
  }>;
  batches: Array<{
    id: string;
    batchNumber: string;
    itemName: string;
    itemType: string;
    remainingQty: number;
    unit: string;
    expiryDate: string;
  }>;
}): DeterministicAiAnalytics {
  const soldByProduct = new Map<string, number>();
  const validOrders = params.orders.filter((o) => o.status !== 'cancelled' && o.status !== 'rejected');
  validOrders.forEach((o) => {
    o.items.forEach((it) => {
      soldByProduct.set(it.productId, roundQty((soldByProduct.get(it.productId) || 0) + it.quantity));
    });
  });

  const demandForecasts = params.products.map((p) => {
    const sold = soldByProduct.get(p.id) || 0;
    const projectedNext30DaysQty = Math.max(Math.round(sold * 1.15), Math.round(p.reorderLevel * 1.5));
    const bufferTarget = roundQty(projectedNext30DaysQty + p.reorderLevel * 0.5);
    const recommendedProductionQty = Math.max(0, Math.ceil(bufferTarget - p.currentStock));
    return {
      productId: p.id,
      sku: p.sku,
      productName: p.name,
      historicalSoldQty: sold,
      currentStock: p.currentStock,
      projectedNext30DaysQty,
      recommendedProductionQty,
      confidence: sold >= 200 ? ('high' as const) : sold > 0 ? ('medium' as const) : ('low' as const),
      rationale:
        sold > 0
          ? `15% seasonal lift over ${sold} ${p.unit} booked orders plus safety stock`
          : `Baseline safety buffer from reorder threshold (${p.reorderLevel} ${p.unit})`,
    };
  });

  const reorderRecommendations: DeterministicAiAnalytics['reorderRecommendations'] = [];
  params.rawMaterials.forEach((rm) => {
    if (rm.currentStock <= rm.reorderLevel) {
      const target = Math.max(rm.reorderLevel * 2, rm.reorderLevel + 100);
      const suggested = Math.ceil(target - rm.currentStock);
      reorderRecommendations.push({
        itemType: 'raw_material',
        itemId: rm.id,
        code: rm.code,
        name: rm.name,
        unit: rm.unit,
        currentStock: rm.currentStock,
        reorderLevel: rm.reorderLevel,
        suggestedOrderQty: suggested,
        urgency: rm.currentStock <= rm.reorderLevel * 0.6 ? 'critical' : 'warning',
        estimatedCostPaisa: Math.round(suggested * rm.costPerUnitPaisa),
      });
    }
  });
  params.packagingMaterials.forEach((pm) => {
    if (pm.currentStock <= pm.reorderLevel) {
      const target = Math.max(pm.reorderLevel * 2, pm.reorderLevel + 200);
      const suggested = Math.ceil(target - pm.currentStock);
      reorderRecommendations.push({
        itemType: 'packaging',
        itemId: pm.id,
        code: pm.code,
        name: pm.name,
        unit: pm.unit,
        currentStock: pm.currentStock,
        reorderLevel: pm.reorderLevel,
        suggestedOrderQty: suggested,
        urgency: pm.currentStock <= pm.reorderLevel * 0.6 ? 'critical' : 'warning',
        estimatedCostPaisa: Math.round(suggested * pm.costPerUnitPaisa),
      });
    }
  });

  const todayMs = Date.parse(params.todayIso);
  const nearExpiryAlerts: DeterministicAiAnalytics['nearExpiryAlerts'] = [];
  params.batches
    .filter((b) => b.remainingQty > 0 && b.expiryDate)
    .forEach((b) => {
      const expMs = Date.parse(b.expiryDate);
      if (Number.isNaN(expMs)) return;
      const daysRemaining = Math.ceil((expMs - todayMs) / 86400000);
      if (daysRemaining <= 30) {
        nearExpiryAlerts.push({
          batchId: b.id,
          batchNumber: b.batchNumber,
          itemName: b.itemName,
          itemType: b.itemType,
          remainingQty: b.remainingQty,
          unit: b.unit,
          expiryDate: b.expiryDate,
          daysRemaining,
          severity: daysRemaining < 0 ? 'expired' : daysRemaining <= 7 ? 'critical_7d' : 'warning_30d',
        });
      }
    });
  nearExpiryAlerts.sort((a, b) => a.daysRemaining - b.daysRemaining);

  const unusualTransactions: DeterministicAiAnalytics['unusualTransactions'] = [];
  params.productionRuns
    .filter((r) => r.status === 'completed')
    .forEach((r) => {
      const totalOut = r.actualOutputQty + r.wastageQty;
      const wastagePct = totalOut > 0 ? (r.wastageQty / totalOut) * 100 : 0;
      if (wastagePct >= 5) {
        unusualTransactions.push({
          id: `wastage_${r.id}`,
          category: 'wastage_spike',
          reference: r.batchNumber,
          severity: wastagePct >= 8 ? 'high' : 'medium',
          description: `Batch ${r.batchNumber} (${r.productName}) recorded ${wastagePct.toFixed(1)}% process wastage (${r.wastageQty} units).`,
        });
      }
      if (r.standardCostPaisa > 0 && r.variancePaisa > r.standardCostPaisa * 0.05) {
        unusualTransactions.push({
          id: `var_${r.id}`,
          category: 'cost_variance',
          reference: r.batchNumber,
          severity: 'high',
          description: `Unfavorable cost variance of ₹${(r.variancePaisa / 100).toFixed(2)} on batch ${r.batchNumber}.`,
        });
      }
    });

  if (validOrders.length >= 3) {
    const avgOrder =
      validOrders.reduce((s, o) => s + o.totalAmountPaisa, 0) / validOrders.length;
    validOrders.forEach((o) => {
      if (o.totalAmountPaisa > avgOrder * 2.2) {
        unusualTransactions.push({
          id: `ord_${o.id}`,
          category: 'order_outlier',
          reference: o.orderNumber,
          severity: 'medium',
          description: `Order ${o.orderNumber} from ${o.customerName} (₹${(o.totalAmountPaisa / 100).toFixed(2)}) is >2.2× average order ticket.`,
        });
      }
    });
  }

  return {
    demandForecasts,
    reorderRecommendations,
    nearExpiryAlerts,
    unusualTransactions,
  };
}
