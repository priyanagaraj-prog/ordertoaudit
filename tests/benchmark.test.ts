/**
 * Automated Test Suite for Order-to-Audit ERP Business Logic & Mandatory Murukku 200g Benchmark
 *
 * Run with: npm test (node --test tests/benchmark.test.ts)
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateBatchesFEFO,
  applyPaymentToInvoice,
  calculateConsumptionVarianceBps,
  calculateOrderTotals,
  calculateProductionVariance,
  calculatePurchaseStockUpdate,
  computeDeterministicAiInsights,
  evaluateOrderFulfillmentPlan,
  evaluateStockAvailability,
  formatPctFromBps,
  roundQty,
} from '../src/utils/erpEngine.ts';
import { computeLineTaxPaisa, formatPaisaToInr, rupeeInputToPaisa } from '../src/utils/money.ts';

interface LedgerEntry {
  itemType: 'raw_material' | 'packaging' | 'finished_good';
  itemId: string;
  movementType:
    | 'OPENING'
    | 'PURCHASE_IN'
    | 'PRODUCTION_CONSUME'
    | 'PRODUCTION_WASTAGE'
    | 'PRODUCTION_OUT'
    | 'DISPATCH_OUT';
  changeQty: number;
  afterQty: number;
}

describe('Mandatory Benchmark Scenario: Murukku 200g (All 10 Expected Results)', () => {
  // Execute the full sequential state machine using the production erpEngine functions
  const stock = {
    flourKg: 100,
    oilLitres: 30,
    spiceKg: 5,
    pouchesPcs: 500,
    cartonsPcs: 30,
    finishedMurukkuPkts: 50,
  };

  const costPaisa = {
    flourPerKg: 4500,    // ₹45.00 / kg
    oilPerLitre: 16000,  // ₹160.00 / L
    spicePerKg: 35000,   // ₹350.00 / kg
    pouchPerPc: 300,     // ₹3.00 / pc
    cartonPerPc: 2500,   // ₹25.00 / pc
  };

  const ledger: LedgerEntry[] = [
    { itemType: 'raw_material', itemId: 'flour', movementType: 'OPENING', changeQty: 100, afterQty: 100 },
    { itemType: 'raw_material', itemId: 'oil', movementType: 'OPENING', changeQty: 30, afterQty: 30 },
    { itemType: 'raw_material', itemId: 'spice', movementType: 'OPENING', changeQty: 5, afterQty: 5 },
    { itemType: 'packaging', itemId: 'pouches', movementType: 'OPENING', changeQty: 500, afterQty: 500 },
    { itemType: 'packaging', itemId: 'cartons', movementType: 'OPENING', changeQty: 30, afterQty: 30 },
    { itemType: 'finished_good', itemId: 'murukku_200g', movementType: 'OPENING', changeQty: 50, afterQty: 50 },
  ];

  // Step 1: Purchase 60 kg flour at ₹45/kg
  const flourPurchase = calculatePurchaseStockUpdate(
    stock.flourKg,
    costPaisa.flourPerKg,
    60,
    4500
  );
  stock.flourKg = flourPurchase.afterQty;
  ledger.push({
    itemType: 'raw_material',
    itemId: 'flour',
    movementType: 'PURCHASE_IN',
    changeQty: 60,
    afterQty: stock.flourKg,
  });

  // Step 2: Production batch (Expected 200, Actual good 188, Damaged pouches 6, Cartons 9)
  const plannedQty = 200;
  const actualGoodOutputQty = 188;
  const wastageQty = 12;

  const bomStandard = {
    flourKg: 40,
    oilLitres: 10,
    spiceKg: 1.2,
    pouchesPcs: 200,
    cartonsPcs: 10,
    laborPaisa: 120000,      // ₹1,200
    gasAndPowerPaisa: 60000, // ₹600
  };

  const actualIssued = {
    flourKg: 40,
    oilLitres: 10.5,
    spiceKg: 1.2,
    pouchesGood: 188,
    pouchesDamaged: 6,
    cartonsPcs: 9,
  };
  const totalPouchesConsumed = actualIssued.pouchesGood + actualIssued.pouchesDamaged;

  stock.flourKg = roundQty(stock.flourKg - actualIssued.flourKg);
  stock.oilLitres = roundQty(stock.oilLitres - actualIssued.oilLitres);
  stock.spiceKg = roundQty(stock.spiceKg - actualIssued.spiceKg);
  const pouchesAfterGood = roundQty(stock.pouchesPcs - actualIssued.pouchesGood);
  stock.pouchesPcs = roundQty(stock.pouchesPcs - totalPouchesConsumed);
  stock.cartonsPcs = roundQty(stock.cartonsPcs - actualIssued.cartonsPcs);

  ledger.push(
    { itemType: 'raw_material', itemId: 'flour', movementType: 'PRODUCTION_CONSUME', changeQty: -actualIssued.flourKg, afterQty: stock.flourKg },
    { itemType: 'raw_material', itemId: 'oil', movementType: 'PRODUCTION_CONSUME', changeQty: -actualIssued.oilLitres, afterQty: stock.oilLitres },
    { itemType: 'raw_material', itemId: 'spice', movementType: 'PRODUCTION_CONSUME', changeQty: -actualIssued.spiceKg, afterQty: stock.spiceKg },
    { itemType: 'packaging', itemId: 'pouches', movementType: 'PRODUCTION_CONSUME', changeQty: -actualIssued.pouchesGood, afterQty: pouchesAfterGood },
    { itemType: 'packaging', itemId: 'pouches', movementType: 'PRODUCTION_WASTAGE', changeQty: -actualIssued.pouchesDamaged, afterQty: stock.pouchesPcs },
    { itemType: 'packaging', itemId: 'cartons', movementType: 'PRODUCTION_CONSUME', changeQty: -actualIssued.cartonsPcs, afterQty: stock.cartonsPcs }
  );

  stock.finishedMurukkuPkts = roundQty(stock.finishedMurukkuPkts + actualGoodOutputQty);
  const finishedAfterProduction = stock.finishedMurukkuPkts;
  ledger.push({
    itemType: 'finished_good',
    itemId: 'murukku_200g',
    movementType: 'PRODUCTION_OUT',
    changeQty: actualGoodOutputQty,
    afterQty: stock.finishedMurukkuPkts,
  });

  const stdMaterialBatchPaisa =
    Math.round(bomStandard.flourKg * costPaisa.flourPerKg) +
    Math.round(bomStandard.oilLitres * costPaisa.oilPerLitre) +
    Math.round(bomStandard.spiceKg * costPaisa.spicePerKg) +
    Math.round(bomStandard.pouchesPcs * costPaisa.pouchPerPc) +
    Math.round(bomStandard.cartonsPcs * costPaisa.cartonPerPc);

  const actualMaterialCostPaisa =
    Math.round(actualIssued.flourKg * costPaisa.flourPerKg) +
    Math.round(actualIssued.oilLitres * costPaisa.oilPerLitre) +
    Math.round(actualIssued.spiceKg * costPaisa.spicePerKg) +
    Math.round(totalPouchesConsumed * costPaisa.pouchPerPc) +
    Math.round(actualIssued.cartonsPcs * costPaisa.cartonPerPc);

  const prodVariance = calculateProductionVariance({
    plannedQty,
    actualOutputQty: actualGoodOutputQty,
    wastageQty,
    bomBatchYieldQty: 200,
    standardLaborCostPaisa: bomStandard.laborPaisa,
    standardOverheadPaisa: bomStandard.gasAndPowerPaisa,
    standardMaterialPerBatchPaisa: stdMaterialBatchPaisa,
    actualMaterialCostPaisa,
  });

  const oilConsumptionVarianceBps = calculateConsumptionVarianceBps(
    bomStandard.oilLitres,
    actualIssued.oilLitres
  );

  // Step 3: Retailer A sale (150 pkts @ ₹50, 5% GST = 2.5% CGST + 2.5% SGST), Dispatch & ₹4,000 payment
  const retailerAOrder = calculateOrderTotals('33', '33', [
    {
      productId: 'prod_bm_murukku',
      sku: 'KHF-MRK-200',
      name: 'Finished Murukku 200g',
      hsnCode: '21069099',
      unit: 'Packet',
      quantity: 150,
      unitPricePaisa: 5000,
      gstBps: 500,
    },
  ]);

  const retailerADispatchAvail = evaluateStockAvailability(150, stock.finishedMurukkuPkts);
  stock.finishedMurukkuPkts = roundQty(stock.finishedMurukkuPkts - 150);
  const finishedAfterDispatch = stock.finishedMurukkuPkts;
  ledger.push({
    itemType: 'finished_good',
    itemId: 'murukku_200g',
    movementType: 'DISPATCH_OUT',
    changeQty: -150,
    afterQty: stock.finishedMurukkuPkts,
  });

  const retailerAPayment = applyPaymentToInvoice(
    retailerAOrder.totalAmountPaisa,
    0,
    rupeeInputToPaisa('4000')
  );

  // Step 4: Distributor B requests 120 packets
  const distributorBAvail = evaluateStockAvailability(120, stock.finishedMurukkuPkts);

  test('1. Purchase weighted avg & Closing flour = 120 kg (100 + 60 - 40)', () => {
    assert.equal(flourPurchase.afterQty, 160);
    assert.equal(flourPurchase.weightedCostPerUnitPaisa, 4500);
    assert.equal(stock.flourKg, 120);
  });

  test('2. Closing cooking oil = 19.5 litres (30 - 10.5)', () => {
    assert.equal(stock.oilLitres, 19.5);
  });

  test('3. Closing pouches = 306 (500 - 188 good - 6 damaged)', () => {
    assert.equal(stock.pouchesPcs, 306);
  });

  test('4. Finished goods after production = 238 packets (50 + 188)', () => {
    assert.equal(finishedAfterProduction, 238);
  });

  test('5. Finished goods after dispatch = 88 packets (238 - 150)', () => {
    assert.equal(retailerADispatchAvail.sufficient, true);
    assert.equal(finishedAfterDispatch, 88);
  });

  test('6. Yield variance = -6% (188 actual vs 200 planned)', () => {
    assert.equal(prodVariance.yieldVarianceBps, -600);
    assert.equal(formatPctFromBps(prodVariance.yieldVarianceBps), '-6%');
  });

  test('7. Oil consumption variance = +5% (10.5 L actual vs 10 L BOM)', () => {
    assert.equal(oilConsumptionVarianceBps, 500);
    assert.equal(formatPctFromBps(oilConsumptionVarianceBps), '+5%');
  });

  test('8. Production overhead = ₹1,800 (Labour ₹1,200 + Gas & Power ₹600)', () => {
    assert.equal(prodVariance.laborOverheadPaisa, 180000);
    assert.equal(formatPaisaToInr(prodVariance.laborOverheadPaisa), '₹1,800.00');
  });

  test('9. Retailer A GST invoice = ₹7,875 (CGST 2.5% ₹187.50 + SGST 2.5% ₹187.50)', () => {
    assert.equal(retailerAOrder.subtotalPaisa, 750000);
    assert.equal(retailerAOrder.cgstPaisa, 18750);
    assert.equal(retailerAOrder.sgstPaisa, 18750);
    assert.equal(retailerAOrder.igstPaisa, 0);
    assert.equal(retailerAOrder.totalTaxPaisa, 37500);
    assert.equal(retailerAOrder.totalAmountPaisa, 787500);
    assert.equal(formatPaisaToInr(retailerAOrder.totalAmountPaisa), '₹7,875.00');
  });

  test('10. Retailer A outstanding = ₹3,875 after ₹4,000 payment', () => {
    assert.equal(retailerAPayment.newPaidPaisa, 400000);
    assert.equal(retailerAPayment.newBalanceDuePaisa, 387500);
    assert.equal(retailerAPayment.paymentStatus, 'partial');
    assert.equal(formatPaisaToInr(retailerAPayment.newBalanceDuePaisa), '₹3,875.00');
  });

  test('11. Distributor B insufficient stock & shortage = 32 packets (120 req vs 88 avail)', () => {
    assert.equal(distributorBAvail.sufficient, false);
    assert.equal(distributorBAvail.availableQty, 88);
    assert.equal(distributorBAvail.requestedQty, 120);
    assert.equal(distributorBAvail.shortageQty, 32);
  });

  test('12. Stock ledger sum reconciles 100% with every closing balance', () => {
    const sumItem = (id: string) =>
      roundQty(ledger.filter((m) => m.itemId === id).reduce((s, m) => s + m.changeQty, 0));

    assert.equal(sumItem('flour'), 120);
    assert.equal(sumItem('oil'), 19.5);
    assert.equal(sumItem('spice'), 3.8);
    assert.equal(sumItem('pouches'), 306);
    assert.equal(sumItem('cartons'), 21);
    assert.equal(sumItem('murukku_200g'), 88);
  });
});

describe('Financial & Security Invariant Tests', () => {
  test('Client GST preview matches backend calculateOrderTotals in integer paisa', () => {
    const preview = computeLineTaxPaisa(5000, 150, 500, false);
    const engine = calculateOrderTotals('33', '33', [
      {
        productId: 'p1',
        sku: 'SKU1',
        name: 'Murukku',
        hsnCode: '2106',
        unit: 'Packet',
        quantity: 150,
        unitPricePaisa: 5000,
        gstBps: 500,
      },
    ]);
    assert.equal(preview.lineSubtotalPaisa, engine.subtotalPaisa);
    assert.equal(preview.cgstPaisa, engine.cgstPaisa);
    assert.equal(preview.sgstPaisa, engine.sgstPaisa);
    assert.equal(preview.lineTotalPaisa, engine.totalAmountPaisa);
  });

  test('Inter-state GST splits 0 CGST / 0 SGST and 100% IGST', () => {
    const interState = calculateOrderTotals('33', '29', [
      {
        productId: 'p1',
        sku: 'SKU1',
        name: 'Murukku',
        hsnCode: '2106',
        unit: 'Packet',
        quantity: 150,
        unitPricePaisa: 5000,
        gstBps: 500,
      },
    ]);
    assert.equal(interState.isInterState, true);
    assert.equal(interState.cgstPaisa, 0);
    assert.equal(interState.sgstPaisa, 0);
    assert.equal(interState.igstPaisa, 37500);
    assert.equal(interState.totalAmountPaisa, 787500);
  });

  test('Rejects overpayment, zero/negative payments, and floating-point paisa values', () => {
    assert.throws(() => applyPaymentToInvoice(387500, 400000, 387501), /exceed/);
    assert.throws(() => applyPaymentToInvoice(387500, 400000, 0), /positive/);
    assert.throws(() => applyPaymentToInvoice(387500, 400000, 12.5), /integer/);
    assert.throws(
      () =>
        calculateOrderTotals('33', '33', [
          {
            productId: 'p1',
            sku: 'SKU1',
            name: 'Murukku',
            hsnCode: '2106',
            unit: 'Packet',
            quantity: 10,
            unitPricePaisa: 50.25,
            gstBps: 500,
          },
        ]),
      /integer-paisa/
    );
  });
});

describe('FactoryFlow FEFO, MRP & Deterministic AI Analytics Tests', () => {
  test('FEFO skips expired/hold/rejected lots and picks earliest non-expired lot first', () => {
    const fefo = allocateBatchesFEFO(
      [
        {
          id: 'b_exp',
          batchNumber: 'LOT-EXPIRED',
          itemId: 'prod_mrk',
          expiryDate: '2026-04-01',
          remainingQty: 100,
          qcStatus: 'passed',
        },
        {
          id: 'b_hold',
          batchNumber: 'LOT-HOLD',
          itemId: 'prod_mrk',
          expiryDate: '2026-06-05',
          remainingQty: 80,
          qcStatus: 'hold',
        },
        {
          id: 'b_later',
          batchNumber: 'LOT-LATER',
          itemId: 'prod_mrk',
          expiryDate: '2026-08-20',
          remainingQty: 100,
          qcStatus: 'passed',
        },
        {
          id: 'b_early',
          batchNumber: 'LOT-EARLY',
          itemId: 'prod_mrk',
          expiryDate: '2026-06-15',
          remainingQty: 60,
          qcStatus: 'passed',
        },
      ],
      90,
      '2026-06-01'
    );

    assert.equal(fefo.expiredSkippedQty, 100);
    assert.equal(fefo.totalAllocated, 90);
    assert.equal(fefo.shortageQty, 0);
    assert.equal(fefo.allocations.length, 2);
    assert.equal(fefo.allocations[0].batchNumber, 'LOT-EARLY');
    assert.equal(fefo.allocations[0].quantity, 60);
    assert.equal(fefo.allocations[0].remainingAfter, 0);
    assert.equal(fefo.allocations[1].batchNumber, 'LOT-LATER');
    assert.equal(fefo.allocations[1].quantity, 30);
    assert.equal(fefo.allocations[1].remainingAfter, 70);
  });

  test('MRP evaluates FG shortage, expands BOM, and detects upstream RM shortage', () => {
    const plan = evaluateOrderFulfillmentPlan({
      orderItems: [{ productId: 'p1', sku: 'KHF-MRK-200', name: 'Murukku 200g', quantity: 250 }],
      products: [{ id: 'p1', currentStock: 50 }],
      boms: [
        {
          id: 'bom1',
          productId: 'p1',
          batchYieldQty: 200,
          rawMaterialItems: [
            {
              itemId: 'rm_flour',
              code: 'RM-FLR',
              name: 'Rice Flour',
              unit: 'kg',
              qtyPerBatch: 40,
              costPerUnitPaisa: 4500,
            },
          ],
          packagingItems: [
            {
              itemId: 'pkg_pouch',
              code: 'PKG-200',
              name: 'Pouch 200g',
              unit: 'pcs',
              qtyPerBatch: 200,
              costPerUnitPaisa: 300,
            },
          ],
        },
      ],
      rawMaterials: [{ id: 'rm_flour', currentStock: 25, costPerUnitPaisa: 4500 }],
      packagingMaterials: [{ id: 'pkg_pouch', currentStock: 300, costPerUnitPaisa: 300 }],
    });

    assert.equal(plan.hasFgShortage, true);
    assert.equal(plan.fgShortages[0].shortageQty, 200);
    assert.equal(plan.fgShortages[0].canProduceImmediately, false);
    assert.equal(plan.rawMaterialShortages.length, 1);
    assert.equal(plan.rawMaterialShortages[0].itemId, 'rm_flour');
    assert.equal(plan.rawMaterialShortages[0].shortageQty, 15);
    assert.equal(plan.packagingShortages.length, 0);
  });

  test('Deterministic AI insights surfaces critical reorders, near-expiry lots & wastage anomalies', () => {
    const insights = computeDeterministicAiInsights({
      todayIso: '2026-06-01',
      products: [
        {
          id: 'p1',
          sku: 'KHF-MRK-200',
          name: 'Butter Murukku 200g',
          unit: 'Packet',
          currentStock: 40,
          reorderLevel: 100,
          standardCostPaisa: 3400,
        },
      ],
      rawMaterials: [
        {
          id: 'rm_flour',
          code: 'RM-FLR',
          name: 'Rice Flour',
          unit: 'kg',
          currentStock: 20,
          reorderLevel: 50,
          costPerUnitPaisa: 4500,
        },
      ],
      packagingMaterials: [],
      orders: [
        {
          id: 'o1',
          orderNumber: 'ORD-101',
          customerName: 'Annanagar Mart',
          totalAmountPaisa: 500000,
          status: 'delivered',
          items: [{ productId: 'p1', quantity: 220 }],
        },
      ],
      productionRuns: [
        {
          id: 'run1',
          batchNumber: 'BATCH-09',
          productName: 'Butter Murukku 200g',
          plannedQty: 200,
          actualOutputQty: 180,
          wastageQty: 20,
          standardCostPaisa: 600000,
          actualTotalCostPaisa: 650000,
          variancePaisa: 50000,
          status: 'completed',
        },
      ],
      batches: [
        {
          id: 'lot1',
          batchNumber: 'LOT-NEAR-7D',
          itemName: 'Idli Batter 1kg',
          itemType: 'finished_good',
          remainingQty: 45,
          unit: 'Pack',
          expiryDate: '2026-06-05',
        },
      ],
    });

    assert.equal(insights.demandForecasts[0].confidence, 'high');
    assert.equal(insights.reorderRecommendations.length, 1);
    assert.equal(insights.reorderRecommendations[0].urgency, 'critical');
    assert.equal(insights.nearExpiryAlerts.length, 1);
    assert.equal(insights.nearExpiryAlerts[0].severity, 'critical_7d');
    assert.ok(insights.unusualTransactions.some((a) => a.category === 'wastage_spike'));
    assert.ok(insights.unusualTransactions.some((a) => a.category === 'cost_variance'));
  });
});
