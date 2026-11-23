/**
 * Order-to-Audit ERP Firestore Service Layer
 *
 * Implements:
 * - Real-time Firestore subscriptions with structured error handling
 * - Transactional stock updates (Purchases, Production Runs, Dispatches)
 * - Traceable append-only stock_movements ledger
 * - Immutable append-only audit_logs
 * - Integer-paisa calculations verified via Node.js backend endpoints
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { callApi } from '../lib/apiClient';
import { db, handleFirestoreError, OperationType, stripUndefined } from '../lib/firebase';
import {
  allocateBatchesFEFO,
  applyPaymentToInvoice,
  calculateProductionVariance,
  calculatePurchaseStockUpdate,
  evaluateStockAvailability,
  roundQty,
} from '../utils/erpEngine';
import { PRODUCT_STUDIO_IMAGES } from '../utils/productImages';
import type {
  AuditLog,
  Bom,
  CompanySetting,
  Customer,
  Dispatch,
  GstInvoice,
  InventoryBatch,
  OrderLineItem,
  PackagingMaterial,
  Payment,
  Product,
  ProductionRun,
  Purchase,
  PurchaseRequest,
  QcInspection,
  QcParameterCheck,
  RawMaterial,
  SalesOrder,
  StockMovement,
  Supplier,
  UserProfile,
  UserRole,
  WipStage,
} from '../types/erp';

export interface ActorMeta {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
}

function makeDocId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

export function makeDocNumber(prefix: string): string {
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const seq = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}-${yymm}-${seq}`;
}

// ============================================================================
// Subscriptions
// ============================================================================

export function subscribeCollection<T>(
  collectionName: string,
  onData: (items: T[]) => void,
  orderField = 'createdAt',
  direction: 'asc' | 'desc' = 'desc'
): Unsubscribe {
  const q = query(collection(db, collectionName), orderBy(orderField, direction));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, collectionName)
  );
}

export function subscribeSalesOrders(
  actorUid: string,
  role: UserRole,
  onData: (items: SalesOrder[]) => void
): Unsubscribe {
  const col = collection(db, 'sales_orders');
  const q =
    role === 'salesman'
      ? query(col, where('salesmanUid', '==', actorUid))
      : query(col, orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as SalesOrder);
      if (role === 'salesman') {
        items.sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || ''));
      }
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'sales_orders')
  );
}

export function subscribeCompanySettings(
  onData: (setting: CompanySetting | null) => void
): Unsubscribe {
  const ref = doc(db, 'settings', 'company');
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        onData({ id: snap.id, ...(snap.data() as Omit<CompanySetting, 'id'>) });
      } else {
        onData(null);
      }
    },
    (error) => handleFirestoreError(error, OperationType.GET, 'settings/company')
  );
}

// ============================================================================
// Audit Helper
// ============================================================================

async function writeAuditLog(
  actor: ActorMeta,
  action: string,
  entityType: string,
  entityId: string,
  summary: string
): Promise<void> {
  const logId = makeDocId('aud');
  try {
    await setDoc(doc(db, 'audit_logs', logId), {
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action,
      entityType,
      entityId,
      summary: summary.slice(0, 300),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `audit_logs/${logId}`);
  }
}

// ============================================================================
// Settings & User Management
// ============================================================================

export async function saveCompanySettings(
  actor: ActorMeta,
  data: Omit<CompanySetting, 'id' | 'updatedAt' | 'updatedBy'>
): Promise<void> {
  const ref = doc(db, 'settings', 'company');
  try {
    await setDoc(
      ref,
      stripUndefined({
        ...data,
        updatedBy: actor.uid,
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    );
    await writeAuditLog(
      actor,
      'SETTINGS_UPDATED',
      'settings',
      'company',
      `Updated company profile & GSTIN (${data.gstin})`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/company');
  }
}

export async function updateUserRoleAndStatus(
  actor: ActorMeta,
  targetUid: string,
  updates: { role: UserRole; status: 'active' | 'inactive'; department?: string; phone?: string }
): Promise<void> {
  const ref = doc(db, 'users', targetUid);
  try {
    await updateDoc(
      ref,
      stripUndefined({
        role: updates.role,
        status: updates.status,
        department: updates.department,
        phone: updates.phone,
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      'USER_ROLE_UPDATED',
      'users',
      targetUid,
      `Set user ${targetUid} role to ${updates.role} (${updates.status})`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUid}`);
  }
}

// ============================================================================
// Master Data CRUD (Customers, Products, Raw Materials, Packaging, BOM)
// ============================================================================

export async function createCustomer(
  actor: ActorMeta,
  payload: Omit<Customer, 'id' | 'outstandingPaisa' | 'createdBy' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeDocId('cust');
  try {
    await setDoc(
      doc(db, 'customers', id),
      stripUndefined({
        ...payload,
        outstandingPaisa: 0,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      'CUSTOMER_CREATED',
      'customers',
      id,
      `Created customer ${payload.businessName} (${payload.code})`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `customers/${id}`);
  }
}

export async function updateCustomer(
  actor: ActorMeta,
  id: string,
  updates: Partial<Omit<Customer, 'id' | 'code' | 'createdBy' | 'createdAt'>>
): Promise<void> {
  try {
    await updateDoc(
      doc(db, 'customers', id),
      stripUndefined({
        ...updates,
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(actor, 'CUSTOMER_UPDATED', 'customers', id, `Updated customer ${id}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `customers/${id}`);
  }
}

export async function createProduct(
  actor: ActorMeta,
  payload: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeDocId('prod');
  try {
    await setDoc(
      doc(db, 'products', id),
      stripUndefined({
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      'PRODUCT_CREATED',
      'products',
      id,
      `Added SKU ${payload.sku} - ${payload.name}`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `products/${id}`);
  }
}

export async function updateProduct(
  actor: ActorMeta,
  id: string,
  updates: Partial<Omit<Product, 'id' | 'sku' | 'createdAt'>>
): Promise<void> {
  try {
    await updateDoc(
      doc(db, 'products', id),
      stripUndefined({
        ...updates,
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(actor, 'PRODUCT_UPDATED', 'products', id, `Updated product ${id}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `products/${id}`);
  }
}

export async function createRawMaterial(
  actor: ActorMeta,
  payload: Omit<RawMaterial, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeDocId('rm');
  try {
    await setDoc(
      doc(db, 'raw_materials', id),
      stripUndefined({
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      'RAW_MATERIAL_CREATED',
      'raw_materials',
      id,
      `Added raw material ${payload.code} - ${payload.name}`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `raw_materials/${id}`);
  }
}

export async function createPackagingMaterial(
  actor: ActorMeta,
  payload: Omit<PackagingMaterial, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeDocId('pkg');
  try {
    await setDoc(
      doc(db, 'packaging_materials', id),
      stripUndefined({
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      'PACKAGING_CREATED',
      'packaging_materials',
      id,
      `Added packaging item ${payload.code} - ${payload.name}`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `packaging_materials/${id}`);
  }
}

export async function saveBom(
  actor: ActorMeta,
  existingBomId: string | null,
  payload: Omit<Bom, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'>
): Promise<string> {
  const id = existingBomId || makeDocId('bom');
  try {
    if (existingBomId) {
      await updateDoc(
        doc(db, 'boms', id),
        stripUndefined({
          batchYieldQty: payload.batchYieldQty,
          batchUnit: payload.batchUnit,
          standardLaborCostPaisa: payload.standardLaborCostPaisa,
          standardOverheadPaisa: payload.standardOverheadPaisa,
          rawMaterialItems: payload.rawMaterialItems,
          packagingItems: payload.packagingItems,
          notes: payload.notes,
          updatedBy: actor.uid,
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      await setDoc(
        doc(db, 'boms', id),
        stripUndefined({
          ...payload,
          updatedBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
    await writeAuditLog(
      actor,
      existingBomId ? 'BOM_UPDATED' : 'BOM_CREATED',
      'boms',
      id,
      `${existingBomId ? 'Updated' : 'Created'} BOM for ${payload.productSku} (${payload.productName})`
    );
    return id;
  } catch (error) {
    handleFirestoreError(
      error,
      existingBomId ? OperationType.UPDATE : OperationType.CREATE,
      `boms/${id}`
    );
  }
}

// ============================================================================
// Transactional Workflows (Purchase Receipt, Production, Sales Order, Invoice, Dispatch, Payment)
// ============================================================================

export async function createPurchaseOrder(
  actor: ActorMeta,
  payload: Omit<Purchase, 'id' | 'status' | 'createdBy' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeDocId('po');
  try {
    await setDoc(
      doc(db, 'purchases', id),
      stripUndefined({
        ...payload,
        status: 'ordered',
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      'PURCHASE_CREATED',
      'purchases',
      id,
      `Created PO ${payload.purchaseNumber} from ${payload.supplierName}`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `purchases/${id}`);
  }
}

export async function createSupplier(
  actor: ActorMeta,
  payload: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeDocId('sup');
  try {
    await setDoc(
      doc(db, 'suppliers', id),
      stripUndefined({
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      'SUPPLIER_CREATED',
      'suppliers',
      id,
      `Added supplier ${payload.code} — ${payload.name}`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `suppliers/${id}`);
  }
}

export async function createPurchaseRequest(
  actor: ActorMeta,
  payload: Omit<PurchaseRequest, 'id' | 'status' | 'requestedBy' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeDocId('pr');
  try {
    await setDoc(
      doc(db, 'purchase_requests', id),
      stripUndefined({
        ...payload,
        status: 'pending',
        requestedBy: actor.displayName || actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      'PR_CREATED',
      'purchase_requests',
      id,
      `Created Purchase Request ${payload.prNumber} for ${payload.itemName} (${payload.requestedQty} ${payload.unit})`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `purchase_requests/${id}`);
  }
}

export async function updatePurchaseRequestStatus(
  actor: ActorMeta,
  prId: string,
  status: PurchaseRequest['status'],
  linkedPoId?: string
): Promise<void> {
  try {
    await updateDoc(
      doc(db, 'purchase_requests', prId),
      stripUndefined({
        status,
        linkedPoId,
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      'PR_UPDATED',
      'purchase_requests',
      prId,
      `Updated Purchase Request ${prId} to ${status}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `purchase_requests/${prId}`);
  }
}

/**
 * Converts a Purchase Request into a formal Purchase Order atomically.
 */
export async function convertPrToPurchaseOrder(
  actor: ActorMeta,
  pr: PurchaseRequest,
  supplier: { name: string; gstin?: string; id?: string },
  gstBps = 500
): Promise<string> {
  const poId = makeDocId('po');
  const subtotalPaisa = Math.round(pr.requestedQty * pr.estimatedUnitCostPaisa);
  const totalTaxPaisa = Math.round((subtotalPaisa * gstBps) / 10000);
  const totalAmountPaisa = subtotalPaisa + totalTaxPaisa;
  const purchaseNumber = makeDocNumber('PO');

  try {
    await runTransaction(db, async (tx) => {
      const prRef = doc(db, 'purchase_requests', pr.id);
      const prSnap = await tx.get(prRef);
      if (!prSnap.exists()) throw new Error('Purchase request not found.');
      const curPr = prSnap.data() as PurchaseRequest;
      if (curPr.status === 'converted_to_po') {
        throw new Error('Purchase request already converted to a Purchase Order.');
      }

      tx.set(
        doc(db, 'purchases', poId),
        stripUndefined({
          purchaseNumber,
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierGstin: supplier.gstin || '',
          linkedPrId: pr.id,
          itemCategory: pr.itemCategory,
          items: [
            {
              itemId: pr.itemId,
              code: pr.itemCode,
              name: pr.itemName,
              unit: pr.unit,
              quantity: pr.requestedQty,
              unitCostPaisa: pr.estimatedUnitCostPaisa,
              gstBps,
              lineTotalPaisa: totalAmountPaisa,
            },
          ],
          subtotalPaisa,
          totalTaxPaisa,
          totalAmountPaisa,
          status: 'ordered',
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      tx.update(prRef, {
        status: 'converted_to_po',
        linkedPoId: poId,
        updatedAt: serverTimestamp(),
      });
    });

    await writeAuditLog(
      actor,
      'PR_CONVERTED_TO_PO',
      'purchases',
      poId,
      `Converted ${pr.prNumber} into ${purchaseNumber} (${supplier.name})`
    );
    return poId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `purchases/${poId}`);
  }
}

/**
 * Transactionally receives a purchase order (GRN):
 * - Updates stock on raw_materials or packaging_materials
 * - Recomputes weighted-average costPerUnitPaisa in integer paisa
 * - Creates trackable InventoryBatch (lotCode, mfgDate, expiryDate, qcStatus: 'pending')
 * - Writes PURCHASE_IN entries to stock_movements
 * - Marks purchase as received and logs audit trail
 */
export async function receivePurchaseTransaction(
  actor: ActorMeta,
  purchaseId: string,
  invoiceRef: string,
  grnMeta?: {
    grnNumber?: string;
    batchNumber?: string;
    mfgDate?: string;
    expiryDate?: string;
  }
): Promise<void> {
  try {
    let poNumber = '';
    const todayIso = new Date().toISOString().slice(0, 10);
    const defaultExpIso = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
    const grnNumber = grnMeta?.grnNumber || makeDocNumber('GRN');
    const baseBatch = grnMeta?.batchNumber || makeDocNumber('LOT');
    const mfgDate = grnMeta?.mfgDate || todayIso;
    const expiryDate = grnMeta?.expiryDate || defaultExpIso;

    await runTransaction(db, async (tx) => {
      const poRef = doc(db, 'purchases', purchaseId);
      const poSnap = await tx.get(poRef);
      if (!poSnap.exists()) throw new Error('Purchase order not found.');
      const po = poSnap.data() as Purchase;
      if (po.status === 'received') throw new Error('Purchase order already received.');
      poNumber = po.purchaseNumber;

      const targetCollection =
        po.itemCategory === 'raw_material' ? 'raw_materials' : 'packaging_materials';
      const itemType = po.itemCategory === 'raw_material' ? 'raw_material' : 'packaging';

      // Read all item docs first before writes
      const itemRefs = po.items.map((item) => doc(db, targetCollection, item.itemId));
      const itemSnaps = await Promise.all(itemRefs.map((ref) => tx.get(ref)));

      itemSnaps.forEach((snap, idx) => {
        if (!snap.exists()) {
          throw new Error(`Inventory item ${po.items[idx].name} not found.`);
        }
        const item = po.items[idx];
        const currentData = snap.data() as {
          currentStock: number;
          costPerUnitPaisa: number;
          shelfLifeDays?: number;
        };
        const beforeQty = Number(currentData.currentStock || 0);
        const addQty = Number(item.quantity || 0);
        const stockCalc = calculatePurchaseStockUpdate(
          beforeQty,
          currentData.costPerUnitPaisa || 0,
          addQty,
          item.unitCostPaisa
        );

        const itemBatchNo = po.items.length > 1 ? `${baseBatch}-${idx + 1}` : baseBatch;
        const computedExp =
          grnMeta?.expiryDate ||
          (currentData.shelfLifeDays
            ? new Date(Date.now() + currentData.shelfLifeDays * 86400000).toISOString().slice(0, 10)
            : expiryDate);

        tx.update(itemRefs[idx], {
          currentStock: stockCalc.afterQty,
          costPerUnitPaisa: stockCalc.weightedCostPerUnitPaisa,
          updatedAt: serverTimestamp(),
        });

        const batchId = makeDocId('batch');
        tx.set(doc(db, 'inventory_batches', batchId), {
          itemType,
          itemId: item.itemId,
          itemCode: item.code,
          itemName: item.name,
          batchNumber: itemBatchNo,
          lotCode: itemBatchNo,
          mfgDate,
          expiryDate: computedExp,
          initialQty: addQty,
          remainingQty: addQty,
          unit: item.unit,
          unitCostPaisa: item.unitCostPaisa,
          qcStatus: 'pending',
          sourceType: 'grn',
          sourceId: purchaseId,
          sourceRef: grnNumber,
          supplierName: po.supplierName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const movId = makeDocId('mov');
        tx.set(doc(db, 'stock_movements', movId), {
          itemType,
          itemId: item.itemId,
          itemCode: item.code,
          itemName: item.name,
          movementType: 'PURCHASE_IN',
          unit: item.unit,
          beforeQty,
          changeQty: addQty,
          afterQty: stockCalc.afterQty,
          unitCostPaisa: item.unitCostPaisa,
          totalValuePaisa: stockCalc.incomingValuePaisa,
          refType: 'PURCHASE',
          refId: purchaseId,
          refNumber: po.purchaseNumber,
          batchNumber: itemBatchNo,
          actorUid: actor.uid,
          actorName: actor.displayName,
          createdAt: serverTimestamp(),
        });
      });

      tx.update(poRef, {
        status: 'received',
        grnNumber,
        batchNumber: baseBatch,
        mfgDate,
        expiryDate,
        invoiceRef: invoiceRef || po.invoiceRef || '',
        receivedBy: actor.uid,
        receivedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
    });

    await writeAuditLog(
      actor,
      'PURCHASE_RECEIVED',
      'purchases',
      purchaseId,
      `Received PO ${poNumber} (${grnNumber}, Lot ${baseBatch}) and updated inventory stock`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `purchases/${purchaseId}`);
  }
}

/**
 * Schedules a new Production Run from a BOM and computes standard cost via server endpoint.
 */
export async function createProductionRun(
  actor: ActorMeta,
  bom: Bom,
  plannedQty: number,
  batchNumber: string,
  linkedOrder?: { orderId: string; orderNumber: string }
): Promise<string> {
  const id = makeDocId('prodrun');
  const scaleFactor = plannedQty / bom.batchYieldQty;

  const stdMaterialBatchPaisa =
    bom.rawMaterialItems.reduce(
      (sum, m) => sum + Math.round(m.qtyPerBatch * m.costPerUnitPaisa),
      0
    ) +
    bom.packagingItems.reduce(
      (sum, p) => sum + Math.round(p.qtyPerBatch * p.costPerUnitPaisa),
      0
    );

  const serverCost = await callApi<{
    standardCostPaisa: number;
    laborOverheadPaisa: number;
  }>('/api/production/calculate-variance', 'POST', {
    plannedQty,
    actualOutputQty: 0,
    wastageQty: 0,
    bomBatchYieldQty: bom.batchYieldQty,
    standardLaborCostPaisa: bom.standardLaborCostPaisa,
    standardOverheadPaisa: bom.standardOverheadPaisa,
    standardMaterialPerBatchPaisa: stdMaterialBatchPaisa,
    actualMaterialCostPaisa: 0,
  });

  const rawPlanned = bom.rawMaterialItems.map((m) => {
    const qty = roundQty(m.qtyPerBatch * scaleFactor);
    return {
      itemId: m.itemId,
      code: m.code,
      name: m.name,
      unit: m.unit,
      plannedQty: qty,
      actualQty: qty,
      unitCostPaisa: m.costPerUnitPaisa,
      totalCostPaisa: Math.round(qty * m.costPerUnitPaisa),
    };
  });

  const pkgPlanned = bom.packagingItems.map((p) => {
    const qty = roundQty(p.qtyPerBatch * scaleFactor);
    return {
      itemId: p.itemId,
      code: p.code,
      name: p.name,
      unit: p.unit,
      plannedQty: qty,
      actualQty: qty,
      unitCostPaisa: p.costPerUnitPaisa,
      totalCostPaisa: Math.round(qty * p.costPerUnitPaisa),
    };
  });

  try {
    await setDoc(
      doc(db, 'production_runs', id),
      stripUndefined({
        batchNumber,
        productId: bom.productId,
        productSku: bom.productSku,
        productName: bom.productName,
        bomId: bom.id,
        plannedQty,
        actualOutputQty: 0,
        wastageQty: 0,
        rawMaterialsConsumed: rawPlanned,
        packagingConsumed: pkgPlanned,
        standardCostPaisa: serverCost.standardCostPaisa,
        actualMaterialCostPaisa: 0,
        laborOverheadPaisa: serverCost.laborOverheadPaisa,
        actualTotalCostPaisa: 0,
        variancePaisa: 0,
        status: 'in_progress',
        wipStage: 'mixing' as WipStage,
        qcStatus: 'pending',
        linkedOrderId: linkedOrder?.orderId,
        linkedOrderNumber: linkedOrder?.orderNumber,
        supervisorUid: actor.uid,
        supervisorName: actor.displayName,
        startedAt: new Date().toISOString(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      'PRODUCTION_STARTED',
      'production_runs',
      id,
      `Started batch ${batchNumber} for ${bom.productName} (Planned: ${plannedQty})`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `production_runs/${id}`);
  }
}

export async function advanceProductionWipStage(
  actor: ActorMeta,
  runId: string,
  wipStage: WipStage
): Promise<void> {
  try {
    await updateDoc(doc(db, 'production_runs', runId), {
      wipStage,
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog(
      actor,
      'PRODUCTION_WIP_UPDATED',
      'production_runs',
      runId,
      `Batch ${runId} moved to WIP stage: ${wipStage}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `production_runs/${runId}`);
  }
}

/**
 * Transactionally completes a Production Run:
 * - Validates raw material and packaging stock availability
 * - Deducts raw materials & packaging materials
 * - Adds finished goods output to products
 * - Records PRODUCTION_CONSUME, PRODUCTION_OUT, and PRODUCTION_WASTAGE ledger entries
 * - Calculates exact cost variance via server engine
 */
export async function completeProductionRunTransaction(
  actor: ActorMeta,
  run: ProductionRun,
  bom: Bom,
  params: {
    actualOutputQty: number;
    wastageQty: number;
    wastageReason: string;
    rawMaterialsConsumed: Array<{ itemId: string; actualQty: number }>;
    packagingConsumed: Array<{
      itemId: string;
      actualQty?: number;
      goodQty?: number;
      damagedQty?: number;
    }>;
  }
): Promise<void> {
  try {
    let finalVariancePaisa = 0;
    const mfgDate = new Date().toISOString().slice(0, 10);

    // Pre-fetch active raw material batches for FEFO consumption & recall chain linkage
    const rawBatchSnaps = await Promise.all(
      run.rawMaterialsConsumed.map((m) =>
        getDocs(
          query(
            collection(db, 'inventory_batches'),
            where('itemId', '==', m.itemId)
          )
        )
      )
    );
    const rawCandidateMap = new Map<string, InventoryBatch[]>();
    run.rawMaterialsConsumed.forEach((m, idx) => {
      rawCandidateMap.set(
        m.itemId,
        rawBatchSnaps[idx].docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryBatch, 'id'>) }))
      );
    });

    await runTransaction(db, async (tx) => {
      const runRef = doc(db, 'production_runs', run.id);
      const runSnap = await tx.get(runRef);
      if (!runSnap.exists()) throw new Error('Production run not found.');
      const currentRun = runSnap.data() as ProductionRun;
      if (currentRun.status === 'completed') throw new Error('Batch is already completed.');

      const prodRef = doc(db, 'products', run.productId);
      const prodSnap = await tx.get(prodRef);
      if (!prodSnap.exists()) throw new Error('Finished product not found.');
      const product = prodSnap.data() as Product;

      const rawRefs = currentRun.rawMaterialsConsumed.map((m) =>
        doc(db, 'raw_materials', m.itemId)
      );
      const pkgRefs = currentRun.packagingConsumed.map((p) =>
        doc(db, 'packaging_materials', p.itemId)
      );
      const linkedOrdRef = currentRun.linkedOrderId
        ? doc(db, 'sales_orders', currentRun.linkedOrderId)
        : null;

      // Also pre-read raw batches to be FEFO-decremented inside this transaction
      const rawBatchDeductions: Array<{
        ref: ReturnType<typeof doc>;
        afterQty: number;
        batchNumber: string;
        itemId: string;
      }> = [];

      currentRun.rawMaterialsConsumed.forEach((line) => {
        const override = params.rawMaterialsConsumed.find((c) => c.itemId === line.itemId);
        const actualQty = roundQty(override ? override.actualQty : line.actualQty);
        const candidates = rawCandidateMap.get(line.itemId) || [];
        if (candidates.length > 0) {
          const fefo = allocateBatchesFEFO(candidates, actualQty, mfgDate);
          fefo.allocations.forEach((alloc) => {
            rawBatchDeductions.push({
              ref: doc(db, 'inventory_batches', alloc.batchId),
              afterQty: alloc.remainingAfter,
              batchNumber: alloc.batchNumber,
              itemId: line.itemId,
            });
          });
        }
      });

      const [rawSnaps, pkgSnaps, linkedOrdSnap, ...batchSnaps] = await Promise.all([
        Promise.all(rawRefs.map((r) => tx.get(r))),
        Promise.all(pkgRefs.map((r) => tx.get(r))),
        linkedOrdRef ? tx.get(linkedOrdRef) : Promise.resolve(null),
        ...rawBatchDeductions.map((d) => tx.get(d.ref)),
      ]);

      let actualMaterialCostPaisa = 0;
      const consumedRawBatchRefs: string[] = [];

      const updatedRawLines = currentRun.rawMaterialsConsumed.map((line, idx) => {
        const snap = rawSnaps[idx];
        if (!snap.exists()) throw new Error(`Raw material ${line.name} not found.`);
        const rm = snap.data() as RawMaterial;
        const override = params.rawMaterialsConsumed.find((c) => c.itemId === line.itemId);
        const actualQty = roundQty(override ? override.actualQty : line.actualQty);
        const avail = evaluateStockAvailability(actualQty, rm.currentStock);
        if (!avail.sufficient) {
          throw new Error(
            `Insufficient raw material "${rm.name}": available ${avail.availableQty} ${rm.unit}, required ${avail.requestedQty} ${rm.unit} (shortage: ${avail.shortageQty} ${rm.unit}).`
          );
        }
        const afterQty = roundQty(rm.currentStock - actualQty);
        const lineCostPaisa = Math.round(actualQty * rm.costPerUnitPaisa);
        actualMaterialCostPaisa += lineCostPaisa;

        const linkedLot = rawBatchDeductions.find((d) => d.itemId === line.itemId)?.batchNumber;
        if (linkedLot && !consumedRawBatchRefs.includes(linkedLot)) {
          consumedRawBatchRefs.push(linkedLot);
        }

        tx.update(rawRefs[idx], {
          currentStock: afterQty,
          updatedAt: serverTimestamp(),
        });

        tx.set(
          doc(db, 'stock_movements', makeDocId('mov')),
          stripUndefined({
            itemType: 'raw_material',
            itemId: line.itemId,
            itemCode: line.code,
            itemName: line.name,
            movementType: 'PRODUCTION_CONSUME',
            unit: line.unit,
            beforeQty: rm.currentStock,
            changeQty: -actualQty,
            afterQty,
            unitCostPaisa: rm.costPerUnitPaisa,
            totalValuePaisa: lineCostPaisa,
            refType: 'PRODUCTION_RUN',
            refId: run.id,
            refNumber: run.batchNumber,
            batchNumber: linkedLot,
            actorUid: actor.uid,
            actorName: actor.displayName,
            createdAt: serverTimestamp(),
          })
        );

        return stripUndefined({
          ...line,
          actualQty,
          unitCostPaisa: rm.costPerUnitPaisa,
          totalCostPaisa: lineCostPaisa,
          batchNumber: linkedLot,
        });
      });

      rawBatchDeductions.forEach((deduction, idx) => {
        if (batchSnaps[idx]?.exists()) {
          tx.update(deduction.ref, {
            remainingQty: deduction.afterQty,
            updatedAt: serverTimestamp(),
          });
        }
      });

      const updatedPkgLines = currentRun.packagingConsumed.map((line, idx) => {
        const snap = pkgSnaps[idx];
        if (!snap.exists()) throw new Error(`Packaging item ${line.name} not found.`);
        const pkg = snap.data() as PackagingMaterial;
        const override = params.packagingConsumed.find((c) => c.itemId === line.itemId);

        let goodQty = roundQty(line.actualQty);
        let damagedQty = 0;
        let actualQty = roundQty(line.actualQty);

        if (override) {
          if (override.goodQty !== undefined || override.damagedQty !== undefined) {
            goodQty = roundQty(override.goodQty ?? 0);
            damagedQty = roundQty(override.damagedQty ?? 0);
            actualQty = roundQty(
              override.actualQty !== undefined ? override.actualQty : goodQty + damagedQty
            );
          } else if (override.actualQty !== undefined) {
            actualQty = roundQty(override.actualQty);
            goodQty = actualQty;
            damagedQty = 0;
          }
        }

        const avail = evaluateStockAvailability(actualQty, pkg.currentStock);
        if (!avail.sufficient) {
          throw new Error(
            `Insufficient packaging "${pkg.name}": available ${avail.availableQty} ${pkg.unit}, required ${avail.requestedQty} ${pkg.unit} (shortage: ${avail.shortageQty} ${pkg.unit}).`
          );
        }

        const afterGoodQty = roundQty(pkg.currentStock - goodQty);
        const afterQty = roundQty(pkg.currentStock - actualQty);
        const lineCostPaisa = Math.round(actualQty * pkg.costPerUnitPaisa);
        actualMaterialCostPaisa += lineCostPaisa;

        tx.update(pkgRefs[idx], {
          currentStock: afterQty,
          updatedAt: serverTimestamp(),
        });

        if (goodQty > 0) {
          tx.set(doc(db, 'stock_movements', makeDocId('mov')), {
            itemType: 'packaging',
            itemId: line.itemId,
            itemCode: line.code,
            itemName: line.name,
            movementType: 'PRODUCTION_CONSUME',
            unit: line.unit,
            beforeQty: pkg.currentStock,
            changeQty: -goodQty,
            afterQty: afterGoodQty,
            unitCostPaisa: pkg.costPerUnitPaisa,
            totalValuePaisa: Math.round(goodQty * pkg.costPerUnitPaisa),
            refType: 'PRODUCTION_RUN',
            refId: run.id,
            refNumber: run.batchNumber,
            actorUid: actor.uid,
            actorName: actor.displayName,
            createdAt: serverTimestamp(),
          });
        }

        if (damagedQty > 0) {
          tx.set(doc(db, 'stock_movements', makeDocId('mov')), {
            itemType: 'packaging',
            itemId: line.itemId,
            itemCode: line.code,
            itemName: line.name,
            movementType: 'PRODUCTION_WASTAGE',
            unit: line.unit,
            beforeQty: afterGoodQty,
            changeQty: -damagedQty,
            afterQty,
            unitCostPaisa: pkg.costPerUnitPaisa,
            totalValuePaisa: Math.round(damagedQty * pkg.costPerUnitPaisa),
            refType: 'PRODUCTION_RUN',
            refId: run.id,
            refNumber: run.batchNumber,
            actorUid: actor.uid,
            actorName: actor.displayName,
            createdAt: serverTimestamp(),
          });
        }

        return {
          ...line,
          actualQty,
          goodQty,
          damagedQty,
          unitCostPaisa: pkg.costPerUnitPaisa,
          totalCostPaisa: lineCostPaisa,
        };
      });

      const stdMaterialBatchPaisa =
        bom.rawMaterialItems.reduce(
          (sum, m) => sum + Math.round(m.qtyPerBatch * m.costPerUnitPaisa),
          0
        ) +
        bom.packagingItems.reduce(
          (sum, p) => sum + Math.round(p.qtyPerBatch * p.costPerUnitPaisa),
          0
        );

      const varianceCalc = calculateProductionVariance({
        plannedQty: currentRun.plannedQty,
        actualOutputQty: params.actualOutputQty,
        wastageQty: params.wastageQty,
        bomBatchYieldQty: bom.batchYieldQty,
        standardLaborCostPaisa: bom.standardLaborCostPaisa,
        standardOverheadPaisa: bom.standardOverheadPaisa,
        standardMaterialPerBatchPaisa: stdMaterialBatchPaisa,
        actualMaterialCostPaisa,
      });

      const actualTotalCostPaisa = varianceCalc.actualTotalCostPaisa;
      const variancePaisa = actualTotalCostPaisa - currentRun.standardCostPaisa;
      finalVariancePaisa = variancePaisa;

      const unitActualCostPaisa =
        varianceCalc.unitActualCostPaisa > 0
          ? varianceCalc.unitActualCostPaisa
          : product.standardCostPaisa;

      const shelfDays = product.shelfLifeDays || 90;
      const expiryDate = new Date(Date.now() + shelfDays * 86400000).toISOString().slice(0, 10);

      const newFgStock = roundQty(product.currentStock + params.actualOutputQty);
      tx.update(prodRef, {
        currentStock: newFgStock,
        standardCostPaisa: unitActualCostPaisa,
        updatedAt: serverTimestamp(),
      });

      if (params.actualOutputQty > 0) {
        tx.set(doc(db, 'inventory_batches', makeDocId('batch')), {
          itemType: 'finished_good',
          itemId: run.productId,
          itemCode: product.sku,
          itemName: product.name,
          batchNumber: run.batchNumber,
          lotCode: run.batchNumber,
          mfgDate,
          expiryDate,
          initialQty: roundQty(params.actualOutputQty),
          remainingQty: roundQty(params.actualOutputQty),
          unit: product.unit,
          unitCostPaisa: unitActualCostPaisa,
          qcStatus: 'pending',
          sourceType: 'production',
          sourceId: run.id,
          sourceRef: run.batchNumber,
          rawBatchRefs: consumedRawBatchRefs.slice(0, 20),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      tx.set(doc(db, 'stock_movements', makeDocId('mov')), {
        itemType: 'finished_good',
        itemId: run.productId,
        itemCode: product.sku,
        itemName: product.name,
        movementType: 'PRODUCTION_OUT',
        unit: product.unit,
        beforeQty: product.currentStock,
        changeQty: params.actualOutputQty,
        afterQty: newFgStock,
        unitCostPaisa: unitActualCostPaisa,
        totalValuePaisa: actualTotalCostPaisa,
        refType: 'PRODUCTION_RUN',
        refId: run.id,
        refNumber: run.batchNumber,
        batchNumber: run.batchNumber,
        actorUid: actor.uid,
        actorName: actor.displayName,
        createdAt: serverTimestamp(),
      });

      if (params.wastageQty > 0) {
        const wastageUnitCost =
          params.actualOutputQty + params.wastageQty > 0
            ? Math.round(actualTotalCostPaisa / (params.actualOutputQty + params.wastageQty))
            : 0;
        tx.set(doc(db, 'stock_movements', makeDocId('mov')), {
          itemType: 'finished_good',
          itemId: run.productId,
          itemCode: product.sku,
          itemName: product.name,
          movementType: 'PRODUCTION_WASTAGE',
          unit: product.unit,
          beforeQty: newFgStock,
          changeQty: 0,
          afterQty: newFgStock,
          unitCostPaisa: wastageUnitCost,
          totalValuePaisa: Math.round(params.wastageQty * wastageUnitCost),
          refType: 'PRODUCTION_RUN',
          refId: run.id,
          refNumber: run.batchNumber,
          batchNumber: run.batchNumber,
          actorUid: actor.uid,
          actorName: actor.displayName,
          createdAt: serverTimestamp(),
        });
      }

      tx.update(runRef, {
        actualOutputQty: roundQty(params.actualOutputQty),
        wastageQty: roundQty(params.wastageQty),
        wastageReason: params.wastageReason || '',
        rawMaterialsConsumed: updatedRawLines,
        packagingConsumed: updatedPkgLines,
        actualMaterialCostPaisa,
        actualTotalCostPaisa,
        variancePaisa,
        status: 'completed',
        wipStage: 'completed',
        mfgDate,
        expiryDate,
        qcStatus: 'pending',
        completedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });

      if (linkedOrdRef && linkedOrdSnap && linkedOrdSnap.exists()) {
        const ordStatus = (linkedOrdSnap.data() as SalesOrder).status;
        if (ordStatus === 'in_production') {
          tx.update(linkedOrdRef, {
            status: 'ready_for_dispatch',
            updatedAt: serverTimestamp(),
          });
        }
      }
    });

    await writeAuditLog(
      actor,
      'PRODUCTION_COMPLETED',
      'production_runs',
      run.id,
      `Completed batch ${run.batchNumber}: Output ${params.actualOutputQty}, Wastage ${params.wastageQty}, Variance ${finalVariancePaisa} paisa`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `production_runs/${run.id}`);
  }
}

/**
 * Records a Quality Control inspection for Raw Material (GRN) or Finished Good batch.
 * Atomically updates inventory_batches.qcStatus, linked production run, and deducts rejected units if rejected.
 */
export async function recordQcInspectionTransaction(
  actor: ActorMeta,
  params: {
    inspectionType: QcInspection['inspectionType'];
    batch: InventoryBatch;
    inspectedQty: number;
    passedQty: number;
    rejectedQty: number;
    status: QcInspection['status'];
    parameters: QcParameterCheck[];
    remarks: string;
  }
): Promise<string> {
  const qcId = makeDocId('qc');
  const qcNumber = makeDocNumber('QC');
  const todayIso = new Date().toISOString().slice(0, 10);

  try {
    await runTransaction(db, async (tx) => {
      const batchRef = doc(db, 'inventory_batches', params.batch.id);
      const batchSnap = await tx.get(batchRef);
      if (!batchSnap.exists()) throw new Error('Inventory batch not found.');
      const curBatch = batchSnap.data() as InventoryBatch;

      const itemCol =
        curBatch.itemType === 'raw_material'
          ? 'raw_materials'
          : curBatch.itemType === 'packaging'
          ? 'packaging_materials'
          : 'products';
      const itemRef = doc(db, itemCol, curBatch.itemId);
      const itemSnap = await tx.get(itemRef);

      const prodRunRef =
        curBatch.sourceType === 'production' && curBatch.sourceId
          ? doc(db, 'production_runs', curBatch.sourceId)
          : null;
      const prodRunSnap = prodRunRef ? await tx.get(prodRunRef) : null;

      let newBatchRemaining = curBatch.remainingQty;
      const rejectDelta = Math.min(curBatch.remainingQty, Math.max(0, roundQty(params.rejectedQty)));
      if (params.status === 'rejected') {
        newBatchRemaining = 0;
      } else if (rejectDelta > 0) {
        newBatchRemaining = roundQty(Math.max(0, curBatch.remainingQty - rejectDelta));
      }

      const qtyRemoved = roundQty(curBatch.remainingQty - newBatchRemaining);

      if (qtyRemoved > 0 && itemSnap.exists()) {
        const curItem = itemSnap.data() as {
          currentStock: number;
          code?: string;
          sku?: string;
          name: string;
          unit: string;
          costPerUnitPaisa?: number;
          standardCostPaisa?: number;
        };
        const afterItemStock = roundQty(Math.max(0, Number(curItem.currentStock || 0) - qtyRemoved));
        const unitCost = curItem.costPerUnitPaisa ?? curItem.standardCostPaisa ?? curBatch.unitCostPaisa;

        tx.update(itemRef, {
          currentStock: afterItemStock,
          updatedAt: serverTimestamp(),
        });

        tx.set(doc(db, 'stock_movements', makeDocId('mov')), {
          itemType: curBatch.itemType,
          itemId: curBatch.itemId,
          itemCode: curItem.code || curItem.sku || curBatch.itemCode,
          itemName: curItem.name,
          movementType: 'QC_REJECT',
          unit: curItem.unit,
          beforeQty: curItem.currentStock,
          changeQty: -qtyRemoved,
          afterQty: afterItemStock,
          unitCostPaisa: unitCost,
          totalValuePaisa: Math.round(qtyRemoved * unitCost),
          refType: 'QC_INSPECTION',
          refId: qcId,
          refNumber: qcNumber,
          batchNumber: curBatch.batchNumber,
          actorUid: actor.uid,
          actorName: actor.displayName,
          createdAt: serverTimestamp(),
        });
      }

      tx.update(batchRef, {
        remainingQty: newBatchRemaining,
        qcStatus: params.status,
        updatedAt: serverTimestamp(),
      });

      if (prodRunRef && prodRunSnap && prodRunSnap.exists()) {
        tx.update(prodRunRef, {
          qcStatus: params.status,
          updatedAt: serverTimestamp(),
        });
      }

      tx.set(
        doc(db, 'qc_inspections', qcId),
        stripUndefined({
          qcNumber,
          inspectionType: params.inspectionType,
          itemId: curBatch.itemId,
          itemCode: curBatch.itemCode,
          itemName: curBatch.itemName,
          batchId: params.batch.id,
          batchNumber: curBatch.batchNumber,
          inspectedQty: roundQty(params.inspectedQty),
          passedQty: roundQty(params.passedQty),
          rejectedQty: roundQty(params.rejectedQty),
          status: params.status,
          parameters: params.parameters,
          inspectorName: actor.displayName,
          remarks: params.remarks || '',
          inspectedDate: todayIso,
          refType: curBatch.sourceType,
          refId: curBatch.sourceId,
          createdAt: serverTimestamp(),
        })
      );
    });

    await writeAuditLog(
      actor,
      'QC_INSPECTION_RECORDED',
      'qc_inspections',
      qcId,
      `QC ${qcNumber} on Lot ${params.batch.batchNumber} (${params.batch.itemName}): ${params.status.toUpperCase()}`
    );
    return qcId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `qc_inspections/${qcId}`);
  }
}

/**
 * Creates a Sales Order using server-side integer-paisa GST calculation.
 */
export async function createSalesOrder(
  actor: ActorMeta,
  params: {
    customer: Customer;
    companyStateCode: string;
    orderNumber: string;
    orderDate: string;
    notes: string;
    items: Array<{
      productId: string;
      sku: string;
      name: string;
      hsnCode: string;
      unit: string;
      quantity: number;
      unitPricePaisa: number;
      gstBps: number;
    }>;
  }
): Promise<string> {
  const calculated = await callApi<{
    items: OrderLineItem[];
    subtotalPaisa: number;
    cgstPaisa: number;
    sgstPaisa: number;
    igstPaisa: number;
    totalTaxPaisa: number;
    totalAmountPaisa: number;
  }>('/api/finance/calculate-order', 'POST', {
    companyStateCode: params.companyStateCode,
    customerStateCode: params.customer.stateCode,
    items: params.items,
  });

  const id = makeDocId('ord');
  try {
    await setDoc(
      doc(db, 'sales_orders', id),
      stripUndefined({
        orderNumber: params.orderNumber,
        customerId: params.customer.id,
        customerName: params.customer.businessName,
        customerStateCode: params.customer.stateCode,
        salesmanUid: actor.uid,
        salesmanName: actor.displayName,
        items: calculated.items,
        subtotalPaisa: calculated.subtotalPaisa,
        cgstPaisa: calculated.cgstPaisa,
        sgstPaisa: calculated.sgstPaisa,
        igstPaisa: calculated.igstPaisa,
        totalTaxPaisa: calculated.totalTaxPaisa,
        totalAmountPaisa: calculated.totalAmountPaisa,
        status: 'pending',
        notes: params.notes || '',
        orderDate: params.orderDate,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      'ORDER_CREATED',
      'sales_orders',
      id,
      `Created order ${params.orderNumber} for ${params.customer.businessName} (${calculated.totalAmountPaisa} paisa)`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `sales_orders/${id}`);
  }
}

export async function updateSalesOrderStatus(
  actor: ActorMeta,
  orderId: string,
  status: SalesOrder['status'],
  extra?: { rejectionReason?: string; linkedProductionRunId?: string }
): Promise<void> {
  try {
    await updateDoc(
      doc(db, 'sales_orders', orderId),
      stripUndefined({
        status,
        rejectionReason: extra?.rejectionReason,
        linkedProductionRunId: extra?.linkedProductionRunId,
        updatedAt: serverTimestamp(),
      })
    );
    await writeAuditLog(
      actor,
      status === 'rejected' ? 'ORDER_REJECTED' : 'ORDER_STATUS_UPDATED',
      'sales_orders',
      orderId,
      `Order ${orderId} status changed to ${status}${extra?.rejectionReason ? `: ${extra.rejectionReason}` : ''}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `sales_orders/${orderId}`);
  }
}

/**
 * Transactionally converts a Sales Order into a GST Tax Invoice:
 * - Updates sales_orders.status = 'invoiced'
 * - Increments customer.outstandingPaisa
 * - Creates GST Invoice with server-verified CGST/SGST/IGST breakdown
 */
export async function generateGstInvoiceTransaction(
  actor: ActorMeta,
  order: SalesOrder,
  customer: Customer,
  companyStateCode: string,
  invoiceNumber: string
): Promise<string> {
  const invoiceId = makeDocId('inv');
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  // Re-verify tax calculation on server
  const verified = await callApi<{
    isInterState: boolean;
    items: OrderLineItem[];
    subtotalPaisa: number;
    cgstPaisa: number;
    sgstPaisa: number;
    igstPaisa: number;
    totalTaxPaisa: number;
    totalAmountPaisa: number;
  }>('/api/finance/calculate-order', 'POST', {
    companyStateCode,
    customerStateCode: customer.stateCode,
    items: order.items,
  });

  try {
    await runTransaction(db, async (tx) => {
      const ordRef = doc(db, 'sales_orders', order.id);
      const custRef = doc(db, 'customers', customer.id);
      const [ordSnap, custSnap] = await Promise.all([tx.get(ordRef), tx.get(custRef)]);

      if (!ordSnap.exists()) throw new Error('Sales order not found.');
      if (!custSnap.exists()) throw new Error('Customer not found.');
      const ordData = ordSnap.data() as SalesOrder;
      if (ordData.status === 'invoiced' || ordData.status === 'dispatched') {
        throw new Error('Order has already been invoiced.');
      }
      const custData = custSnap.data() as Customer;

      tx.set(doc(db, 'invoices', invoiceId), {
        invoiceNumber,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: customer.id,
        customerName: customer.businessName,
        customerGstin: customer.gstin || '',
        customerStateCode: customer.stateCode,
        companyStateCode,
        isInterState: verified.isInterState,
        items: verified.items,
        subtotalPaisa: verified.subtotalPaisa,
        cgstPaisa: verified.cgstPaisa,
        sgstPaisa: verified.sgstPaisa,
        igstPaisa: verified.igstPaisa,
        totalTaxPaisa: verified.totalTaxPaisa,
        totalAmountPaisa: verified.totalAmountPaisa,
        paidAmountPaisa: 0,
        balanceDuePaisa: verified.totalAmountPaisa,
        paymentStatus: 'unpaid',
        dispatchStatus: 'pending',
        invoiceDate: today,
        dueDate: due,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.update(ordRef, {
        status: 'invoiced',
        updatedAt: serverTimestamp(),
      });

      tx.update(custRef, {
        outstandingPaisa: custData.outstandingPaisa + verified.totalAmountPaisa,
        updatedAt: serverTimestamp(),
      });
    });

    await writeAuditLog(
      actor,
      'INVOICE_GENERATED',
      'invoices',
      invoiceId,
      `Generated GST Invoice ${invoiceNumber} for Order ${order.orderNumber} (${verified.totalAmountPaisa} paisa)`
    );
    return invoiceId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `invoices/${invoiceId}`);
  }
}

/**
 * Transactionally dispatches an Invoice:
 * - Validates and deducts finished goods stock for every item
 * - Writes DISPATCH_OUT entries to stock_movements
 * - Creates dispatch record and updates invoice + sales order statuses
 */
export async function createDispatchTransaction(
  actor: ActorMeta,
  invoice: GstInvoice,
  params: {
    dispatchNumber: string;
    transporterName: string;
    vehicleNumber: string;
    lrNumber: string;
  }
): Promise<string> {
  const dispatchId = makeDocId('dsp');
  const todayIso = new Date().toISOString().slice(0, 10);

  try {
    // Pre-fetch candidate finished_good batches for FEFO allocation
    const fgBatchSnaps = await Promise.all(
      invoice.items.map((item) =>
        getDocs(
          query(
            collection(db, 'inventory_batches'),
            where('itemId', '==', item.productId)
          )
        )
      )
    );
    const fgBatchMap = new Map<string, InventoryBatch[]>();
    invoice.items.forEach((item, idx) => {
      fgBatchMap.set(
        item.productId,
        fgBatchSnaps[idx].docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<InventoryBatch, 'id'>),
        }))
      );
    });

    await runTransaction(db, async (tx) => {
      const invRef = doc(db, 'invoices', invoice.id);
      const ordRef = doc(db, 'sales_orders', invoice.orderId);
      const prodRefs = invoice.items.map((item) => doc(db, 'products', item.productId));

      // Compute FEFO batch plan before reading batch docs in tx
      const itemFefoPlans = invoice.items.map((item) => {
        const candidates = fgBatchMap.get(item.productId) || [];
        return {
          productId: item.productId,
          plan: allocateBatchesFEFO(candidates, item.quantity, todayIso),
        };
      });
      const flatBatchAllocations = itemFefoPlans.flatMap((entry) =>
        entry.plan.allocations.map((alloc) => ({
          ...alloc,
          productId: entry.productId,
          ref: doc(db, 'inventory_batches', alloc.batchId),
        }))
      );

      const [invSnap, ordSnap, prodSnaps, batchSnaps] = await Promise.all([
        tx.get(invRef),
        tx.get(ordRef),
        Promise.all(prodRefs.map((r) => tx.get(r))),
        Promise.all(flatBatchAllocations.map((a) => tx.get(a.ref))),
      ]);

      if (!invSnap.exists()) throw new Error('Invoice not found.');
      const invData = invSnap.data() as GstInvoice;
      if (invData.dispatchStatus === 'dispatched') {
        throw new Error('Invoice has already been dispatched.');
      }

      const dispatchedItems = invoice.items.map((item, idx) => {
        const pSnap = prodSnaps[idx];
        if (!pSnap.exists()) throw new Error(`Product ${item.name} not found.`);
        const prod = pSnap.data() as Product;
        const avail = evaluateStockAvailability(item.quantity, prod.currentStock);
        if (!avail.sufficient) {
          throw new Error(
            `Insufficient stock for "${prod.name}": available ${avail.availableQty} ${prod.unit}, requested ${avail.requestedQty} ${prod.unit}, shortage ${avail.shortageQty} ${prod.unit}.`
          );
        }
        const afterQty = roundQty(prod.currentStock - item.quantity);

        tx.update(prodRefs[idx], {
          currentStock: afterQty,
          updatedAt: serverTimestamp(),
        });

        const fefoForItem = itemFefoPlans[idx].plan.allocations;
        const primaryBatch = fefoForItem[0]?.batchNumber;

        tx.set(
          doc(db, 'stock_movements', makeDocId('mov')),
          stripUndefined({
            itemType: 'finished_good',
            itemId: item.productId,
            itemCode: item.sku,
            itemName: item.name,
            movementType: 'DISPATCH_OUT',
            unit: item.unit,
            beforeQty: prod.currentStock,
            changeQty: -item.quantity,
            afterQty,
            unitCostPaisa: prod.standardCostPaisa,
            totalValuePaisa: Math.round(item.quantity * prod.standardCostPaisa),
            refType: 'DISPATCH',
            refId: dispatchId,
            refNumber: params.dispatchNumber,
            batchNumber: primaryBatch,
            actorUid: actor.uid,
            actorName: actor.displayName,
            createdAt: serverTimestamp(),
          })
        );

        return stripUndefined({
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          batchAllocations:
            fefoForItem.length > 0
              ? fefoForItem.map((a) => ({
                  batchId: a.batchId,
                  batchNumber: a.batchNumber,
                  quantity: a.quantity,
                  expiryDate: a.expiryDate,
                }))
              : undefined,
        });
      });

      // Apply FEFO batch remainingQty decrements
      flatBatchAllocations.forEach((alloc, idx) => {
        if (batchSnaps[idx]?.exists()) {
          tx.update(alloc.ref, {
            remainingQty: alloc.remainingAfter,
            updatedAt: serverTimestamp(),
          });
        }
      });

      tx.set(doc(db, 'dispatches', dispatchId), {
        dispatchNumber: params.dispatchNumber,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        orderId: invoice.orderId,
        orderNumber: invoice.orderNumber,
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        transporterName: params.transporterName,
        vehicleNumber: params.vehicleNumber || '',
        lrNumber: params.lrNumber || '',
        dispatchedItems,
        status: 'dispatched',
        dispatchedBy: actor.uid,
        dispatchedAt: new Date().toISOString(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.update(invRef, {
        dispatchStatus: 'dispatched',
        updatedAt: serverTimestamp(),
      });

      if (ordSnap.exists()) {
        tx.update(
          ordRef,
          stripUndefined({
            status: 'dispatched',
            allocatedBatches:
              flatBatchAllocations.length > 0
                ? flatBatchAllocations.map((a) => ({
                    batchId: a.batchId,
                    batchNumber: a.batchNumber,
                    productId: a.productId,
                    quantity: a.quantity,
                    expiryDate: a.expiryDate,
                  }))
                : undefined,
            updatedAt: serverTimestamp(),
          })
        );
      }
    });

    await writeAuditLog(
      actor,
      'DISPATCH_CREATED',
      'dispatches',
      dispatchId,
      `Dispatched ${invoice.invoiceNumber} via ${params.transporterName} (${params.dispatchNumber})`
    );
    return dispatchId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `dispatches/${dispatchId}`);
  }
}

export async function markDispatchDelivered(
  actor: ActorMeta,
  dispatchId: string
): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const dspRef = doc(db, 'dispatches', dispatchId);
      const dspSnap = await tx.get(dspRef);
      if (!dspSnap.exists()) throw new Error('Dispatch record not found.');
      const dsp = dspSnap.data() as Dispatch;
      const ordRef = doc(db, 'sales_orders', dsp.orderId);
      const ordSnap = await tx.get(ordRef);

      tx.update(dspRef, {
        status: 'delivered',
        deliveredAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });

      if (ordSnap.exists()) {
        tx.update(ordRef, {
          status: 'delivered',
          updatedAt: serverTimestamp(),
        });
      }
    });
    await writeAuditLog(
      actor,
      'DISPATCH_DELIVERED',
      'dispatches',
      dispatchId,
      `Marked dispatch ${dispatchId} & linked order as delivered`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `dispatches/${dispatchId}`);
  }
}

/**
 * Transactionally records a Customer Payment against a GST Invoice:
 * - Validates payment amount <= invoice.balanceDuePaisa
 * - Updates invoice paidAmountPaisa, balanceDuePaisa, paymentStatus
 * - Decrements customer.outstandingPaisa
 * - Creates immutable payment receipt
 */
export async function recordPaymentTransaction(
  actor: ActorMeta,
  invoice: GstInvoice,
  params: {
    receiptNumber: string;
    amountPaisa: number;
    paymentMode: Payment['paymentMode'];
    referenceNumber: string;
    paymentDate: string;
    notes: string;
  }
): Promise<string> {
  const paymentId = makeDocId('pay');
  try {
    await runTransaction(db, async (tx) => {
      const invRef = doc(db, 'invoices', invoice.id);
      const custRef = doc(db, 'customers', invoice.customerId);
      const [invSnap, custSnap] = await Promise.all([tx.get(invRef), tx.get(custRef)]);

      if (!invSnap.exists()) throw new Error('Invoice not found.');
      if (!custSnap.exists()) throw new Error('Customer not found.');

      const inv = invSnap.data() as GstInvoice;
      const cust = custSnap.data() as Customer;

      const paymentCalc = applyPaymentToInvoice(
        inv.balanceDuePaisa,
        inv.paidAmountPaisa,
        params.amountPaisa
      );
      const newPaid = paymentCalc.newPaidPaisa;
      const newDue = paymentCalc.newBalanceDuePaisa;
      const newStatus = paymentCalc.paymentStatus;
      const newCustOutstanding = Math.max(0, cust.outstandingPaisa - params.amountPaisa);

      tx.set(doc(db, 'payments', paymentId), {
        receiptNumber: params.receiptNumber,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        amountPaisa: params.amountPaisa,
        paymentMode: params.paymentMode,
        referenceNumber: params.referenceNumber || '',
        paymentDate: params.paymentDate,
        notes: params.notes || '',
        recordedBy: actor.uid,
        createdAt: serverTimestamp(),
      });

      tx.update(invRef, {
        paidAmountPaisa: newPaid,
        balanceDuePaisa: newDue,
        paymentStatus: newStatus,
        updatedAt: serverTimestamp(),
      });

      tx.update(custRef, {
        outstandingPaisa: newCustOutstanding,
        updatedAt: serverTimestamp(),
      });
    });

    await writeAuditLog(
      actor,
      'PAYMENT_RECORDED',
      'payments',
      paymentId,
      `Recorded ${params.paymentMode} payment ${params.receiptNumber} of ${params.amountPaisa} paisa against ${invoice.invoiceNumber}`
    );
    return paymentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `payments/${paymentId}`);
  }
}

// ============================================================================
// Initial South Indian Packaged Food Manufacturing Workspace Seeder
// ============================================================================

export async function seedSouthIndianFoodWorkspace(actor: ActorMeta): Promise<void> {
  // Batch 1: Settings, Products, Raw Materials, Packaging Materials, Customers
  const b1 = writeBatch(db);

  b1.set(doc(db, 'settings', 'company'), {
    companyName: 'Kaveri Heritage Foods',
    legalName: 'Kaveri Heritage Foods Pvt. Ltd.',
    gstin: '33AABCK4821M1Z5',
    stateCode: '33',
    stateName: 'Tamil Nadu',
    address: 'Plot 42, SIDCO Industrial Estate, Kurichi, Coimbatore - 641021, Tamil Nadu',
    phone: '+91 422 267 8410',
    email: 'accounts@kaveriheritagefoods.in',
    invoicePrefix: 'KHF-INV',
    orderPrefix: 'KHF-ORD',
    batchPrefix: 'KHF-BCH',
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });

  const products = [
    {
      id: 'prod_idli_batter',
      sku: 'KHF-BAT-01',
      name: 'Fresh Stone-Ground Idli & Dosa Batter',
      category: 'Fresh Batters',
      hsnCode: '21069099',
      unit: 'Pouch',
      packSize: '1 kg',
      gstBps: 500,
      sellingPricePaisa: 7500,
      standardCostPaisa: 4400,
      currentStock: 420,
      reorderLevel: 150,
      description: 'Traditional 3:1 Salem Ponni Rice & Guntur Black Urad Gota stone-ground batter with natural 8-hour fermentation and zero preservatives.',
      imageUrl: PRODUCT_STUDIO_IMAGES.idliBatter,
      shelfLifeDays: 14,
      storageTemp: 'Chilled 2°C – 6°C',
      weightGrams: 1000,
      fssaiLicense: 'FSSAI 12422003001841',
      allergens: 'None',
      status: 'active',
    },
    {
      id: 'prod_sambar_masala',
      sku: 'KHF-MAS-02',
      name: 'Coimbatore Traditional Sambar Masala',
      category: 'Spice Blends',
      hsnCode: '09109100',
      unit: 'Box',
      packSize: '200 g',
      gstBps: 500,
      sellingPricePaisa: 9500,
      standardCostPaisa: 5200,
      currentStock: 680,
      reorderLevel: 200,
      description: 'Slow-roasted coriander, Guntur chillies, fenugreek, toor dal, and curry leaves ground in cool-chilled spice mills.',
      imageUrl: PRODUCT_STUDIO_IMAGES.sambarMasala,
      shelfLifeDays: 270,
      storageTemp: 'Cool & Dry < 25°C',
      weightGrams: 200,
      fssaiLicense: 'FSSAI 12422003001841',
      allergens: 'May contain mustard traces',
      status: 'active',
    },
    {
      id: 'prod_millet_pongal',
      sku: 'KHF-MIX-03',
      name: 'Ragi & Foxtail Millet Pongal Mix',
      category: 'Ready-to-Cook Mixes',
      hsnCode: '19049000',
      unit: 'Pouch',
      packSize: '500 g',
      gstBps: 1200,
      sellingPricePaisa: 14000,
      standardCostPaisa: 7900,
      currentStock: 110, // intentionally below reorderLevel for low-stock alert
      reorderLevel: 150,
      description: 'Dharmapuri foxtail millet, roasted moong dal, whole Tellicherry black pepper, and jeera ready in 12 minutes.',
      imageUrl: PRODUCT_STUDIO_IMAGES.milletPongal,
      shelfLifeDays: 180,
      storageTemp: 'Ambient Dry Storage',
      weightGrams: 500,
      fssaiLicense: 'FSSAI 12422003001841',
      allergens: 'Cashew & Ghee flavoring',
      status: 'active',
    },
    {
      id: 'prod_filter_coffee',
      sku: 'KHF-COF-04',
      name: 'Nilgiri Roasted Filter Coffee Decoction',
      category: 'Beverages',
      hsnCode: '21011190',
      unit: 'Bottle',
      packSize: '250 ml',
      gstBps: 1800,
      sellingPricePaisa: 18500,
      standardCostPaisa: 9800,
      currentStock: 310,
      reorderLevel: 100,
      description: 'Slow-drip brass filter extract using 80% Chikmagalur Arabica medium-dark roast and 20% chicory.',
      imageUrl: PRODUCT_STUDIO_IMAGES.filterCoffee,
      shelfLifeDays: 90,
      storageTemp: 'Refrigerate after opening',
      weightGrams: 250,
      fssaiLicense: 'FSSAI 12422003001841',
      allergens: 'None',
      status: 'active',
    },
    {
      id: 'prod_banana_chips',
      sku: 'KHF-SNK-05',
      name: 'Kerala Nendran Coconut Oil Banana Chips',
      category: 'Savory Snacks',
      hsnCode: '20081990',
      unit: 'Pack',
      packSize: '250 g',
      gstBps: 1200,
      sellingPricePaisa: 12500,
      standardCostPaisa: 6800,
      currentStock: 260,
      reorderLevel: 120,
      description: 'Hand-sliced green Nendran bananas kettle-fried in cold-pressed pure coconut oil with Wayanad sea salt & turmeric.',
      imageUrl: PRODUCT_STUDIO_IMAGES.bananaChips,
      shelfLifeDays: 120,
      storageTemp: 'Airtight Ambient',
      weightGrams: 250,
      fssaiLicense: 'FSSAI 12422003001841',
      allergens: 'Processed in facility handling peanuts',
      status: 'active',
    },
    {
      id: 'prod_kai_murukku',
      sku: 'KHF-MRK-06',
      name: 'Artisanal Hand-Twisted Kai Murukku',
      category: 'Savory Snacks',
      hsnCode: '21069099',
      unit: 'Packet',
      packSize: '200 g',
      gstBps: 500,
      sellingPricePaisa: 5000,
      standardCostPaisa: 3100,
      currentStock: 340,
      reorderLevel: 120,
      description: 'Crisp spiral Murukku crafted with Salem rice flour, roasted urad flour, white sesame, cumin, and groundnut oil.',
      imageUrl: PRODUCT_STUDIO_IMAGES.murukku,
      shelfLifeDays: 90,
      storageTemp: 'Cool & Dry < 25°C',
      weightGrams: 200,
      fssaiLicense: 'FSSAI 12422003001841',
      allergens: 'Contains sesame seeds',
      status: 'active',
    },
  ];

  products.forEach((p) =>
    b1.set(doc(db, 'products', p.id), {
      ...p,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  const rawMaterials = [
    {
      id: 'rm_ponni_rice',
      code: 'RM-RICE-01',
      name: 'Salem Parboiled Ponni Rice',
      category: 'Grains & Pulses',
      unit: 'kg',
      currentStock: 1250,
      reorderLevel: 400,
      costPerUnitPaisa: 5800,
      supplierName: 'Cauvery Agro Mills, Erode',
      status: 'active',
    },
    {
      id: 'rm_urad_dal',
      code: 'RM-DAL-02',
      name: 'Guntur Whole Black Urad Gota',
      category: 'Grains & Pulses',
      unit: 'kg',
      currentStock: 185, // low stock alert
      reorderLevel: 250,
      costPerUnitPaisa: 13200,
      supplierName: 'Sri Lakshmi Pulses, Madurai',
      status: 'active',
    },
    {
      id: 'rm_coriander',
      code: 'RM-SPC-03',
      name: 'Whole Coriander Seeds (Dhania)',
      category: 'Whole Spices',
      unit: 'kg',
      currentStock: 340,
      reorderLevel: 100,
      costPerUnitPaisa: 16500,
      supplierName: 'Pollachi Spice Traders',
      status: 'active',
    },
    {
      id: 'rm_guntur_chilli',
      code: 'RM-SPC-04',
      name: 'Guntur Sannam Red Chillies',
      category: 'Whole Spices',
      unit: 'kg',
      currentStock: 72, // low stock alert
      reorderLevel: 100,
      costPerUnitPaisa: 24000,
      supplierName: 'Deccan Chilli Exports',
      status: 'active',
    },
    {
      id: 'rm_foxtail_millet',
      code: 'RM-MIL-05',
      name: 'Thinai (Foxtail) & Ragi Grain Blend',
      category: 'Millets',
      unit: 'kg',
      currentStock: 520,
      reorderLevel: 150,
      costPerUnitPaisa: 8400,
      supplierName: 'Dharmapuri Millet FPO',
      status: 'active',
    },
    {
      id: 'rm_coffee_beans',
      code: 'RM-COF-06',
      name: 'Chikmagalur Arabica & Chicory Blend',
      category: 'Beverage Inputs',
      unit: 'kg',
      currentStock: 210,
      reorderLevel: 80,
      costPerUnitPaisa: 41000,
      supplierName: 'Nilgiri Estate Roasters',
      status: 'active',
    },
  ];

  rawMaterials.forEach((rm) =>
    b1.set(doc(db, 'raw_materials', rm.id), {
      ...rm,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  const packaging = [
    {
      id: 'pkg_batter_pouch',
      code: 'PKG-PCH-01',
      name: 'Food-Grade Standup Pouch (1 kg)',
      materialType: 'Flexible Pouch',
      unit: 'pcs',
      currentStock: 3200,
      reorderLevel: 1000,
      costPerUnitPaisa: 450,
      supplierName: 'Sivakasi PolyPack Industries',
      status: 'active',
    },
    {
      id: 'pkg_masala_carton',
      code: 'PKG-CRT-02',
      name: 'Printed Duplex Masala Carton (200 g)',
      materialType: 'Printed Carton',
      unit: 'pcs',
      currentStock: 680, // low stock alert
      reorderLevel: 1000,
      costPerUnitPaisa: 520,
      supplierName: 'Coimbatore Offset Prints',
      status: 'active',
    },
    {
      id: 'pkg_glass_bottle',
      code: 'PKG-BTL-03',
      name: 'Amber Glass Bottle with Cap (250 ml)',
      materialType: 'Glass Bottle',
      unit: 'pcs',
      currentStock: 1450,
      reorderLevel: 500,
      costPerUnitPaisa: 1450,
      supplierName: 'Southern Glass Containers',
      status: 'active',
    },
  ];

  packaging.forEach((pkg) =>
    b1.set(doc(db, 'packaging_materials', pkg.id), {
      ...pkg,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  const customers = [
    {
      id: 'cust_anna_mart',
      code: 'CUST-TN-01',
      businessName: 'Annanagar Nilgiris Supermart',
      contactName: 'Karthik Sundaram',
      phone: '+91 98401 22410',
      email: 'procurement@annagrocers.in',
      gstin: '33AAACA8821D1Z9',
      stateCode: '33',
      stateName: 'Tamil Nadu',
      city: 'Chennai',
      address: '2nd Avenue, Anna Nagar, Chennai - 600040',
      creditLimitPaisa: 25000000,
      outstandingPaisa: 1857500,
      status: 'active',
      createdBy: actor.uid,
    },
    {
      id: 'cust_malgudi_dist',
      code: 'CUST-KA-02',
      businessName: 'Malgudi Fine Foods Distributors',
      contactName: 'Raghavendra Rao',
      phone: '+91 99002 74120',
      email: 'orders@malgudifoods.co.in',
      gstin: '29AABCM4410K1Z2',
      stateCode: '29',
      stateName: 'Karnataka',
      city: 'Bengaluru',
      address: 'APMC Yard, Yeshwanthpur, Bengaluru - 560022',
      creditLimitPaisa: 40000000,
      outstandingPaisa: 8732000,
      status: 'active',
      createdBy: actor.uid,
    },
    {
      id: 'cust_kochi_fresh',
      code: 'CUST-KL-03',
      businessName: 'Malabar Coastal Provisions LLP',
      contactName: 'Meera Menon',
      phone: '+91 94471 55209',
      email: 'accounts@malabarprovisions.in',
      gstin: '32AAEFM7721B1Z8',
      stateCode: '32',
      stateName: 'Kerala',
      city: 'Kochi',
      address: 'MG Road, Ernakulam, Kochi - 682016',
      creditLimitPaisa: 20000000,
      outstandingPaisa: 0,
      status: 'active',
      createdBy: actor.uid,
    },
    {
      id: 'cust_madurai_bazaar',
      code: 'CUST-TN-04',
      businessName: 'Meenakshi Wholesale Grocers',
      contactName: 'Senthil Nathan',
      phone: '+91 97890 31102',
      email: 'purchase@meenakshigrocers.in',
      gstin: '33AABFM1920P1Z4',
      stateCode: '33',
      stateName: 'Tamil Nadu',
      city: 'Madurai',
      address: 'West Masi Street, Madurai - 625001',
      creditLimitPaisa: 15000000,
      outstandingPaisa: 0,
      status: 'active',
      createdBy: actor.uid,
    },
  ];

  customers.forEach((c) =>
    b1.set(doc(db, 'customers', c.id), {
      ...c,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  await b1.commit();

  // Batch 2: BOMs, Purchases, Sales Orders
  const b2 = writeBatch(db);

  b2.set(doc(db, 'boms', 'bom_idli_batter'), {
    productId: 'prod_idli_batter',
    productSku: 'KHF-BAT-01',
    productName: 'Fresh Stone-Ground Idli & Dosa Batter',
    batchYieldQty: 100,
    batchUnit: 'Pouch',
    standardLaborCostPaisa: 85000,
    standardOverheadPaisa: 45000,
    rawMaterialItems: [
      {
        itemId: 'rm_ponni_rice',
        code: 'RM-RICE-01',
        name: 'Salem Parboiled Ponni Rice',
        unit: 'kg',
        qtyPerBatch: 36,
        costPerUnitPaisa: 5800,
      },
      {
        itemId: 'rm_urad_dal',
        code: 'RM-DAL-02',
        name: 'Guntur Whole Black Urad Gota',
        unit: 'kg',
        qtyPerBatch: 12,
        costPerUnitPaisa: 13200,
      },
    ],
    packagingItems: [
      {
        itemId: 'pkg_batter_pouch',
        code: 'PKG-PCH-01',
        name: 'Food-Grade Standup Pouch (1 kg)',
        unit: 'pcs',
        qtyPerBatch: 100,
        costPerUnitPaisa: 450,
      },
    ],
    notes: 'Traditional wet-grinding 3:1 rice-to-urad ratio with 8-hour fermentation.',
    updatedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  b2.set(doc(db, 'boms', 'bom_sambar_masala'), {
    productId: 'prod_sambar_masala',
    productSku: 'KHF-MAS-02',
    productName: 'Coimbatore Traditional Sambar Masala',
    batchYieldQty: 200,
    batchUnit: 'Box',
    standardLaborCostPaisa: 110000,
    standardOverheadPaisa: 65000,
    rawMaterialItems: [
      {
        itemId: 'rm_coriander',
        code: 'RM-SPC-03',
        name: 'Whole Coriander Seeds (Dhania)',
        unit: 'kg',
        qtyPerBatch: 22,
        costPerUnitPaisa: 16500,
      },
      {
        itemId: 'rm_guntur_chilli',
        code: 'RM-SPC-04',
        name: 'Guntur Sannam Red Chillies',
        unit: 'kg',
        qtyPerBatch: 14,
        costPerUnitPaisa: 24000,
      },
    ],
    packagingItems: [
      {
        itemId: 'pkg_masala_carton',
        code: 'PKG-CRT-02',
        name: 'Printed Duplex Masala Carton (200 g)',
        unit: 'pcs',
        qtyPerBatch: 200,
        costPerUnitPaisa: 520,
      },
    ],
    notes: 'Slow-roasted spice blend at 115°C and micro-pulverized.',
    updatedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  b2.set(doc(db, 'boms', 'bom_filter_coffee'), {
    productId: 'prod_filter_coffee',
    productSku: 'KHF-COF-04',
    productName: 'Nilgiri Roasted Filter Coffee Decoction',
    batchYieldQty: 100,
    batchUnit: 'Bottle',
    standardLaborCostPaisa: 95000,
    standardOverheadPaisa: 55000,
    rawMaterialItems: [
      {
        itemId: 'rm_coffee_beans',
        code: 'RM-COF-06',
        name: 'Chikmagalur Arabica & Chicory Blend',
        unit: 'kg',
        qtyPerBatch: 16,
        costPerUnitPaisa: 41000,
      },
    ],
    packagingItems: [
      {
        itemId: 'pkg_glass_bottle',
        code: 'PKG-BTL-03',
        name: 'Amber Glass Bottle with Cap (250 ml)',
        unit: 'pcs',
        qtyPerBatch: 100,
        costPerUnitPaisa: 1450,
      },
    ],
    notes: '80:20 Arabica-Chicory slow drip extraction.',
    updatedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  b2.set(doc(db, 'purchases', 'po_seed_01'), {
    purchaseNumber: 'PO-2611-101',
    supplierName: 'Cauvery Agro Mills, Erode',
    supplierGstin: '33AAACC1209M1Z1',
    invoiceRef: 'CAM/26-27/441',
    itemCategory: 'raw_material',
    items: [
      {
        itemId: 'rm_ponni_rice',
        code: 'RM-RICE-01',
        name: 'Salem Parboiled Ponni Rice',
        unit: 'kg',
        quantity: 500,
        unitCostPaisa: 5800,
        gstBps: 500,
        lineTotalPaisa: 2900000,
      },
    ],
    subtotalPaisa: 2900000,
    totalTaxPaisa: 145000,
    totalAmountPaisa: 3045000,
    status: 'received',
    receivedBy: actor.uid,
    receivedAt: '2026-11-12T10:30:00.000Z',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const todayStr = new Date().toISOString().slice(0, 10);

  b2.set(doc(db, 'sales_orders', 'ord_seed_01'), {
    orderNumber: 'KHF-ORD-2611-101',
    customerId: 'cust_anna_mart',
    customerName: 'Annanagar Nilgiris Supermart',
    customerStateCode: '33',
    salesmanUid: actor.uid,
    salesmanName: actor.displayName,
    items: [
      {
        productId: 'prod_idli_batter',
        sku: 'KHF-BAT-01',
        name: 'Fresh Stone-Ground Idli & Dosa Batter',
        hsnCode: '21069099',
        unit: 'Pouch',
        quantity: 300,
        unitPricePaisa: 7500,
        gstBps: 500,
        lineSubtotalPaisa: 2250000,
        cgstPaisa: 56250,
        sgstPaisa: 56250,
        igstPaisa: 0,
        lineTaxPaisa: 112500,
        lineTotalPaisa: 2362500,
      },
      {
        productId: 'prod_sambar_masala',
        sku: 'KHF-MAS-02',
        name: 'Coimbatore Traditional Sambar Masala',
        hsnCode: '09109100',
        unit: 'Box',
        quantity: 200,
        unitPricePaisa: 9500,
        gstBps: 500,
        lineSubtotalPaisa: 1900000,
        cgstPaisa: 47500,
        sgstPaisa: 47500,
        igstPaisa: 0,
        lineTaxPaisa: 95000,
        lineTotalPaisa: 1995000,
      },
    ],
    subtotalPaisa: 4150000,
    cgstPaisa: 103750,
    sgstPaisa: 103750,
    igstPaisa: 0,
    totalTaxPaisa: 207500,
    totalAmountPaisa: 4357500,
    status: 'invoiced',
    notes: 'Morning refrigerated van delivery slot.',
    orderDate: '2026-11-14',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  b2.set(doc(db, 'sales_orders', 'ord_seed_02'), {
    orderNumber: 'KHF-ORD-2611-102',
    customerId: 'cust_malgudi_dist',
    customerName: 'Malgudi Fine Foods Distributors',
    customerStateCode: '29',
    salesmanUid: actor.uid,
    salesmanName: actor.displayName,
    items: [
      {
        productId: 'prod_filter_coffee',
        sku: 'KHF-COF-04',
        name: 'Nilgiri Roasted Filter Coffee Decoction',
        hsnCode: '21011190',
        unit: 'Bottle',
        quantity: 400,
        unitPricePaisa: 18500,
        gstBps: 1800,
        lineSubtotalPaisa: 7400000,
        cgstPaisa: 0,
        sgstPaisa: 0,
        igstPaisa: 1332000,
        lineTaxPaisa: 1332000,
        lineTotalPaisa: 8732000,
      },
    ],
    subtotalPaisa: 7400000,
    cgstPaisa: 0,
    sgstPaisa: 0,
    igstPaisa: 1332000,
    totalTaxPaisa: 1332000,
    totalAmountPaisa: 8732000,
    status: 'invoiced',
    notes: 'Inter-state Bengaluru hub restock.',
    orderDate: '2026-11-18',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  b2.set(doc(db, 'sales_orders', 'ord_seed_03'), {
    orderNumber: 'KHF-ORD-2611-103',
    customerId: 'cust_kochi_fresh',
    customerName: 'Malabar Coastal Provisions LLP',
    customerStateCode: '32',
    salesmanUid: actor.uid,
    salesmanName: actor.displayName,
    items: [
      {
        productId: 'prod_banana_chips',
        sku: 'KHF-SNK-05',
        name: 'Kerala Nendran Coconut Oil Banana Chips',
        hsnCode: '20081990',
        unit: 'Pack',
        quantity: 250,
        unitPricePaisa: 12500,
        gstBps: 1200,
        lineSubtotalPaisa: 3125000,
        cgstPaisa: 0,
        sgstPaisa: 0,
        igstPaisa: 375000,
        lineTaxPaisa: 375000,
        lineTotalPaisa: 3500000,
      },
    ],
    subtotalPaisa: 3125000,
    cgstPaisa: 0,
    sgstPaisa: 0,
    igstPaisa: 375000,
    totalTaxPaisa: 375000,
    totalAmountPaisa: 3500000,
    status: 'confirmed',
    notes: 'Ready for billing.',
    orderDate: todayStr,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await b2.commit();

  // Batch 3: Production Runs & Invoices
  const b3 = writeBatch(db);

  b3.set(doc(db, 'production_runs', 'run_seed_01'), {
    batchNumber: 'KHF-BCH-2611-01',
    productId: 'prod_idli_batter',
    productSku: 'KHF-BAT-01',
    productName: 'Fresh Stone-Ground Idli & Dosa Batter',
    bomId: 'bom_idli_batter',
    plannedQty: 300,
    actualOutputQty: 292,
    wastageQty: 8,
    wastageReason: 'Grinder hopper residue & 2 pouch seal rejects',
    rawMaterialsConsumed: [
      {
        itemId: 'rm_ponni_rice',
        code: 'RM-RICE-01',
        name: 'Salem Parboiled Ponni Rice',
        unit: 'kg',
        plannedQty: 108,
        actualQty: 110,
        unitCostPaisa: 5800,
        totalCostPaisa: 638000,
      },
      {
        itemId: 'rm_urad_dal',
        code: 'RM-DAL-02',
        name: 'Guntur Whole Black Urad Gota',
        unit: 'kg',
        plannedQty: 36,
        actualQty: 36,
        unitCostPaisa: 13200,
        totalCostPaisa: 475200,
      },
    ],
    packagingConsumed: [
      {
        itemId: 'pkg_batter_pouch',
        code: 'PKG-PCH-01',
        name: 'Food-Grade Standup Pouch (1 kg)',
        unit: 'pcs',
        plannedQty: 300,
        actualQty: 302,
        unitCostPaisa: 450,
        totalCostPaisa: 135900,
      },
    ],
    standardCostPaisa: 1626600,
    actualMaterialCostPaisa: 1249100,
    laborOverheadPaisa: 390000,
    actualTotalCostPaisa: 1639100,
    variancePaisa: 12500,
    status: 'completed',
    supervisorUid: actor.uid,
    supervisorName: actor.displayName,
    startedAt: '2026-11-10T06:00:00.000Z',
    completedAt: '2026-11-10T15:30:00.000Z',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  b3.set(doc(db, 'production_runs', 'run_seed_02'), {
    batchNumber: 'KHF-BCH-2611-02',
    productId: 'prod_sambar_masala',
    productSku: 'KHF-MAS-02',
    productName: 'Coimbatore Traditional Sambar Masala',
    bomId: 'bom_sambar_masala',
    plannedQty: 400,
    actualOutputQty: 396,
    wastageQty: 4,
    wastageReason: 'Roasting moisture loss',
    rawMaterialsConsumed: [
      {
        itemId: 'rm_coriander',
        code: 'RM-SPC-03',
        name: 'Whole Coriander Seeds (Dhania)',
        unit: 'kg',
        plannedQty: 44,
        actualQty: 43,
        unitCostPaisa: 16500,
        totalCostPaisa: 709500,
      },
      {
        itemId: 'rm_guntur_chilli',
        code: 'RM-SPC-04',
        name: 'Guntur Sannam Red Chillies',
        unit: 'kg',
        plannedQty: 28,
        actualQty: 28,
        unitCostPaisa: 24000,
        totalCostPaisa: 672000,
      },
    ],
    packagingConsumed: [
      {
        itemId: 'pkg_masala_carton',
        code: 'PKG-CRT-02',
        name: 'Printed Duplex Masala Carton (200 g)',
        unit: 'pcs',
        plannedQty: 400,
        actualQty: 400,
        unitCostPaisa: 520,
        totalCostPaisa: 208000,
      },
    ],
    standardCostPaisa: 1956000,
    actualMaterialCostPaisa: 1589500,
    laborOverheadPaisa: 350000,
    actualTotalCostPaisa: 1939500,
    variancePaisa: -16500,
    status: 'completed',
    supervisorUid: actor.uid,
    supervisorName: actor.displayName,
    startedAt: '2026-11-15T07:00:00.000Z',
    completedAt: '2026-11-15T14:00:00.000Z',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  b3.set(doc(db, 'invoices', 'inv_seed_01'), {
    invoiceNumber: 'KHF-INV-2611-001',
    orderId: 'ord_seed_01',
    orderNumber: 'KHF-ORD-2611-101',
    customerId: 'cust_anna_mart',
    customerName: 'Annanagar Nilgiris Supermart',
    customerGstin: '33AAACA8821D1Z9',
    customerStateCode: '33',
    companyStateCode: '33',
    isInterState: false,
    items: [
      {
        productId: 'prod_idli_batter',
        sku: 'KHF-BAT-01',
        name: 'Fresh Stone-Ground Idli & Dosa Batter',
        hsnCode: '21069099',
        unit: 'Pouch',
        quantity: 300,
        unitPricePaisa: 7500,
        gstBps: 500,
        lineSubtotalPaisa: 2250000,
        cgstPaisa: 56250,
        sgstPaisa: 56250,
        igstPaisa: 0,
        lineTaxPaisa: 112500,
        lineTotalPaisa: 2362500,
      },
      {
        productId: 'prod_sambar_masala',
        sku: 'KHF-MAS-02',
        name: 'Coimbatore Traditional Sambar Masala',
        hsnCode: '09109100',
        unit: 'Box',
        quantity: 200,
        unitPricePaisa: 9500,
        gstBps: 500,
        lineSubtotalPaisa: 1900000,
        cgstPaisa: 47500,
        sgstPaisa: 47500,
        igstPaisa: 0,
        lineTaxPaisa: 95000,
        lineTotalPaisa: 1995000,
      },
    ],
    subtotalPaisa: 4150000,
    cgstPaisa: 103750,
    sgstPaisa: 103750,
    igstPaisa: 0,
    totalTaxPaisa: 207500,
    totalAmountPaisa: 4357500,
    paidAmountPaisa: 2500000,
    balanceDuePaisa: 1857500,
    paymentStatus: 'partial',
    dispatchStatus: 'dispatched',
    invoiceDate: '2026-11-14',
    dueDate: '2026-11-29',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  b3.set(doc(db, 'invoices', 'inv_seed_02'), {
    invoiceNumber: 'KHF-INV-2611-002',
    orderId: 'ord_seed_02',
    orderNumber: 'KHF-ORD-2611-102',
    customerId: 'cust_malgudi_dist',
    customerName: 'Malgudi Fine Foods Distributors',
    customerGstin: '29AABCM4410K1Z2',
    customerStateCode: '29',
    companyStateCode: '33',
    isInterState: true,
    items: [
      {
        productId: 'prod_filter_coffee',
        sku: 'KHF-COF-04',
        name: 'Nilgiri Roasted Filter Coffee Decoction',
        hsnCode: '21011190',
        unit: 'Bottle',
        quantity: 400,
        unitPricePaisa: 18500,
        gstBps: 1800,
        lineSubtotalPaisa: 7400000,
        cgstPaisa: 0,
        sgstPaisa: 0,
        igstPaisa: 1332000,
        lineTaxPaisa: 1332000,
        lineTotalPaisa: 8732000,
      },
    ],
    subtotalPaisa: 7400000,
    cgstPaisa: 0,
    sgstPaisa: 0,
    igstPaisa: 1332000,
    totalTaxPaisa: 1332000,
    totalAmountPaisa: 8732000,
    paidAmountPaisa: 0,
    balanceDuePaisa: 8732000,
    paymentStatus: 'unpaid',
    dispatchStatus: 'pending',
    invoiceDate: '2026-11-18',
    dueDate: '2026-12-03',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await b3.commit();

  // Batch 4: Dispatches, Payments, Stock Movements, Audit Logs
  const b4 = writeBatch(db);

  b4.set(doc(db, 'dispatches', 'dsp_seed_01'), {
    dispatchNumber: 'DSP-2611-001',
    invoiceId: 'inv_seed_01',
    invoiceNumber: 'KHF-INV-2611-001',
    orderId: 'ord_seed_01',
    orderNumber: 'KHF-ORD-2611-101',
    customerId: 'cust_anna_mart',
    customerName: 'Annanagar Nilgiris Supermart',
    transporterName: 'Southern Cold-Chain Logistics',
    vehicleNumber: 'TN-37-CL-4821',
    lrNumber: 'LR-88341',
    dispatchedItems: [
      {
        productId: 'prod_idli_batter',
        sku: 'KHF-BAT-01',
        name: 'Fresh Stone-Ground Idli & Dosa Batter',
        unit: 'Pouch',
        quantity: 300,
      },
      {
        productId: 'prod_sambar_masala',
        sku: 'KHF-MAS-02',
        name: 'Coimbatore Traditional Sambar Masala',
        unit: 'Box',
        quantity: 200,
      },
    ],
    status: 'delivered',
    dispatchedBy: actor.uid,
    dispatchedAt: '2026-11-14T16:00:00.000Z',
    deliveredAt: '2026-11-15T08:15:00.000Z',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  b4.set(doc(db, 'payments', 'pay_seed_01'), {
    receiptNumber: 'RCPT-2611-001',
    invoiceId: 'inv_seed_01',
    invoiceNumber: 'KHF-INV-2611-001',
    customerId: 'cust_anna_mart',
    customerName: 'Annanagar Nilgiris Supermart',
    amountPaisa: 2500000,
    paymentMode: 'NEFT',
    referenceNumber: 'UTR261115998124',
    paymentDate: '2026-11-16',
    notes: 'Part settlement for Nov batch',
    recordedBy: actor.uid,
    createdAt: serverTimestamp(),
  });

  b4.set(doc(db, 'stock_movements', 'mov_seed_01'), {
    itemType: 'raw_material',
    itemId: 'rm_ponni_rice',
    itemCode: 'RM-RICE-01',
    itemName: 'Salem Parboiled Ponni Rice',
    movementType: 'PURCHASE_IN',
    unit: 'kg',
    beforeQty: 860,
    changeQty: 500,
    afterQty: 1360,
    unitCostPaisa: 5800,
    totalValuePaisa: 2900000,
    refType: 'PURCHASE',
    refId: 'po_seed_01',
    refNumber: 'PO-2611-101',
    actorUid: actor.uid,
    actorName: actor.displayName,
    createdAt: serverTimestamp(),
  });

  b4.set(doc(db, 'stock_movements', 'mov_seed_02'), {
    itemType: 'raw_material',
    itemId: 'rm_ponni_rice',
    itemCode: 'RM-RICE-01',
    itemName: 'Salem Parboiled Ponni Rice',
    movementType: 'PRODUCTION_CONSUME',
    unit: 'kg',
    beforeQty: 1360,
    changeQty: -110,
    afterQty: 1250,
    unitCostPaisa: 5800,
    totalValuePaisa: 638000,
    refType: 'PRODUCTION_RUN',
    refId: 'run_seed_01',
    refNumber: 'KHF-BCH-2611-01',
    actorUid: actor.uid,
    actorName: actor.displayName,
    createdAt: serverTimestamp(),
  });

  b4.set(doc(db, 'stock_movements', 'mov_seed_03'), {
    itemType: 'finished_good',
    itemId: 'prod_idli_batter',
    itemCode: 'KHF-BAT-01',
    itemName: 'Fresh Stone-Ground Idli & Dosa Batter',
    movementType: 'PRODUCTION_OUT',
    unit: 'Pouch',
    beforeQty: 428,
    changeQty: 292,
    afterQty: 720,
    unitCostPaisa: 4400,
    totalValuePaisa: 1284800,
    refType: 'PRODUCTION_RUN',
    refId: 'run_seed_01',
    refNumber: 'KHF-BCH-2611-01',
    actorUid: actor.uid,
    actorName: actor.displayName,
    createdAt: serverTimestamp(),
  });

  b4.set(doc(db, 'stock_movements', 'mov_seed_04'), {
    itemType: 'finished_good',
    itemId: 'prod_idli_batter',
    itemCode: 'KHF-BAT-01',
    itemName: 'Fresh Stone-Ground Idli & Dosa Batter',
    movementType: 'DISPATCH_OUT',
    unit: 'Pouch',
    beforeQty: 720,
    changeQty: -300,
    afterQty: 420,
    unitCostPaisa: 4400,
    totalValuePaisa: 1320000,
    refType: 'DISPATCH',
    refId: 'dsp_seed_01',
    refNumber: 'DSP-2611-001',
    actorUid: actor.uid,
    actorName: actor.displayName,
    createdAt: serverTimestamp(),
  });

  b4.set(doc(db, 'audit_logs', 'aud_seed_01'), {
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'WORKSPACE_INITIALIZED',
    entityType: 'settings',
    entityId: 'company',
    summary: 'Initialized Kaveri Heritage Foods South Indian packaged food ERP dataset',
    createdAt: serverTimestamp(),
  });

  await b4.commit();

  // Batch 5: Suppliers, Inventory Batches (FEFO + Near-Expiry), Quality Control Inspections, Sample Purchase Request
  const b5 = writeBatch(db);
  const plus5Days = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const plus11Days = new Date(Date.now() + 11 * 86400000).toISOString().slice(0, 10);
  const plus120Days = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
  const plus210Days = new Date(Date.now() + 210 * 86400000).toISOString().slice(0, 10);
  const minus4Days = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);

  const seedSuppliers = [
    {
      id: 'sup_cauvery_agro',
      code: 'SUP-TN-01',
      name: 'Cauvery Agro Mills, Erode',
      contactPerson: 'Muthuvel Pandian',
      phone: '+91 98427 11800',
      email: 'dispatch@cauveryagromills.in',
      gstin: '33AAACC1209M1Z1',
      stateCode: '33',
      stateName: 'Tamil Nadu',
      address: 'Perundurai Road, Erode - 638011',
      category: 'Grains & Pulses',
      leadTimeDays: 2,
      status: 'active',
    },
    {
      id: 'sup_pollachi_spices',
      code: 'SUP-TN-02',
      name: 'Pollachi Spice Traders',
      contactPerson: 'Lakshmi Narayanan',
      phone: '+91 94431 20940',
      email: 'sales@pollachispices.in',
      gstin: '33AABFP8120K1Z4',
      stateCode: '33',
      stateName: 'Tamil Nadu',
      address: 'Market Yard, Pollachi - 642001',
      category: 'Whole Spices',
      leadTimeDays: 3,
      status: 'active',
    },
    {
      id: 'sup_sivakasi_polypack',
      code: 'SUP-TN-03',
      name: 'Sivakasi PolyPack Industries',
      contactPerson: 'Vijayaraghavan S',
      phone: '+91 98940 66210',
      email: 'orders@sivakasipolypack.com',
      gstin: '33AAACS3391D1Z9',
      stateCode: '33',
      stateName: 'Tamil Nadu',
      address: 'SIDCO Packaging Park, Sivakasi - 626123',
      category: 'Flexible Packaging',
      leadTimeDays: 5,
      status: 'active',
    },
  ];

  seedSuppliers.forEach((s) =>
    b5.set(doc(db, 'suppliers', s.id), {
      ...s,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  const seedBatches = [
    {
      id: 'batch_rm_rice_01',
      itemType: 'raw_material',
      itemId: 'rm_ponni_rice',
      itemCode: 'RM-RICE-01',
      itemName: 'Salem Parboiled Ponni Rice',
      batchNumber: 'LOT-RICE-2611A',
      lotCode: 'LOT-RICE-2611A',
      mfgDate: minus4Days,
      expiryDate: plus120Days,
      initialQty: 1360,
      remainingQty: 1250,
      unit: 'kg',
      unitCostPaisa: 5800,
      qcStatus: 'passed',
      sourceType: 'grn',
      sourceId: 'po_seed_01',
      sourceRef: 'PO-2611-101',
      supplierName: 'Cauvery Agro Mills, Erode',
    },
    {
      id: 'batch_rm_urad_01',
      itemType: 'raw_material',
      itemId: 'rm_urad_dal',
      itemCode: 'RM-DAL-02',
      itemName: 'Guntur Whole Black Urad Gota',
      batchNumber: 'LOT-URAD-2610C',
      lotCode: 'LOT-URAD-2610C',
      mfgDate: '2026-10-10',
      expiryDate: plus210Days,
      initialQty: 221,
      remainingQty: 185,
      unit: 'kg',
      unitCostPaisa: 13200,
      qcStatus: 'passed',
      sourceType: 'opening',
      supplierName: 'Sri Lakshmi Pulses, Madurai',
    },
    {
      id: 'batch_fg_batter_old',
      itemType: 'finished_good',
      itemId: 'prod_idli_batter',
      itemCode: 'KHF-BAT-01',
      itemName: 'Fresh Stone-Ground Idli & Dosa Batter',
      batchNumber: 'KHF-BCH-2611-00',
      lotCode: 'KHF-BCH-2611-00',
      mfgDate: minus4Days,
      expiryDate: plus5Days, // Near-expiry FEFO priority lot!
      initialQty: 180,
      remainingQty: 128,
      unit: 'Pouch',
      unitCostPaisa: 4400,
      qcStatus: 'passed',
      sourceType: 'production',
      rawBatchRefs: ['LOT-RICE-2611A', 'LOT-URAD-2610C'],
    },
    {
      id: 'batch_fg_batter_new',
      itemType: 'finished_good',
      itemId: 'prod_idli_batter',
      itemCode: 'KHF-BAT-01',
      itemName: 'Fresh Stone-Ground Idli & Dosa Batter',
      batchNumber: 'KHF-BCH-2611-01',
      lotCode: 'KHF-BCH-2611-01',
      mfgDate: todayStr,
      expiryDate: plus11Days,
      initialQty: 292,
      remainingQty: 292,
      unit: 'Pouch',
      unitCostPaisa: 4400,
      qcStatus: 'passed',
      sourceType: 'production',
      sourceId: 'run_seed_01',
      sourceRef: 'KHF-BCH-2611-01',
      rawBatchRefs: ['LOT-RICE-2611A', 'LOT-URAD-2610C'],
    },
    {
      id: 'batch_fg_masala_01',
      itemType: 'finished_good',
      itemId: 'prod_sambar_masala',
      itemCode: 'KHF-MAS-02',
      itemName: 'Coimbatore Traditional Sambar Masala',
      batchNumber: 'KHF-BCH-2611-02',
      lotCode: 'KHF-BCH-2611-02',
      mfgDate: minus4Days,
      expiryDate: plus210Days,
      initialQty: 396,
      remainingQty: 396,
      unit: 'Box',
      unitCostPaisa: 5200,
      qcStatus: 'passed',
      sourceType: 'production',
      sourceId: 'run_seed_02',
      sourceRef: 'KHF-BCH-2611-02',
      rawBatchRefs: ['LOT-COR-2611'],
    },
  ];

  seedBatches.forEach((b) =>
    b5.set(doc(db, 'inventory_batches', b.id), {
      ...b,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  b5.set(doc(db, 'qc_inspections', 'qc_seed_01'), {
    qcNumber: 'QC-2611-001',
    inspectionType: 'raw_material',
    itemId: 'rm_ponni_rice',
    itemCode: 'RM-RICE-01',
    itemName: 'Salem Parboiled Ponni Rice',
    batchId: 'batch_rm_rice_01',
    batchNumber: 'LOT-RICE-2611A',
    inspectedQty: 500,
    passedQty: 500,
    rejectedQty: 0,
    status: 'passed',
    parameters: [
      { name: 'Moisture Content (< 13%)', result: '11.8%', passed: true },
      { name: 'Broken Grain % (< 2%)', result: '0.9%', passed: true },
      { name: 'Foreign Matter', result: 'Nil', passed: true },
    ],
    inspectorName: actor.displayName,
    remarks: 'Cleared for stone-grinding batter line.',
    inspectedDate: todayStr,
    refType: 'grn',
    refId: 'po_seed_01',
    createdAt: serverTimestamp(),
  });

  b5.set(doc(db, 'qc_inspections', 'qc_seed_02'), {
    qcNumber: 'QC-2611-002',
    inspectionType: 'finished_good',
    itemId: 'prod_idli_batter',
    itemCode: 'KHF-BAT-01',
    itemName: 'Fresh Stone-Ground Idli & Dosa Batter',
    batchId: 'batch_fg_batter_new',
    batchNumber: 'KHF-BCH-2611-01',
    inspectedQty: 292,
    passedQty: 292,
    rejectedQty: 0,
    status: 'passed',
    parameters: [
      { name: 'Fermentation pH (4.3 - 4.8)', result: '4.52', passed: true },
      { name: 'Pouch Vacuum Seal Test', result: 'Passed', passed: true },
      { name: 'Cold-Chain Temp', result: '4.1°C', passed: true },
    ],
    inspectorName: actor.displayName,
    remarks: 'Released for FEFO dispatch.',
    inspectedDate: todayStr,
    refType: 'production',
    refId: 'run_seed_01',
    createdAt: serverTimestamp(),
  });

  b5.set(doc(db, 'purchase_requests', 'pr_seed_01'), {
    prNumber: 'PR-2611-001',
    sourceType: 'low_stock',
    itemCategory: 'raw_material',
    itemId: 'rm_urad_dal',
    itemCode: 'RM-DAL-02',
    itemName: 'Guntur Whole Black Urad Gota',
    unit: 'kg',
    requestedQty: 300,
    estimatedUnitCostPaisa: 13200,
    status: 'pending',
    requestedBy: actor.displayName,
    notes: 'Stock (185 kg) below 250 kg reorder point.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await b5.commit();
}

// ============================================================================
// Mandatory Benchmark Scenario Execution (Real Sequential Firestore Transactions)
// ============================================================================

async function upsertMasterDoc(
  collectionName: string,
  docId: string,
  createPayload: Record<string, unknown>,
  updatePayload: Record<string, unknown>
): Promise<void> {
  const ref = doc(db, collectionName, docId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, {
      ...updatePayload,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, {
      ...createPayload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export interface BenchmarkRunSummary {
  purchaseId: string;
  productionRunId: string;
  retailerAOrderId: string;
  retailerAInvoiceId: string;
  retailerADispatchId: string;
  retailerAPaymentId: string;
  distributorBOrderId: string;
}

/**
 * Executes the exact mandatory Murukku 200g benchmark scenario end-to-end
 * using real sequential Firestore operations and ACID transactions:
 * 1. Opening stock masters (Flour 100kg, Oil 30L, Spice 5kg, Pouches 500, Cartons 30, Murukku 50 pkts)
 * 2. Purchase 60kg flour @ ₹45/kg -> receivePurchaseTransaction (Flour -> 160kg)
 * 3. Production run (Planned 200, Actual 188, Flour 40kg, Oil 10.5L, Spice 1.2kg, Pouches 188+6 damaged, Cartons 9, Labor ₹1200 + Gas/Power ₹600)
 * 4. Retailer A order (150 pkts @ ₹50, 5% GST = 2.5% CGST + 2.5% SGST -> ₹7,875), Invoice, Dispatch (FG -> 88 pkts), Payment ₹4,000 (Outstanding ₹3,875)
 * 5. Distributor B order (Requested 120 pkts -> flagged Insufficient Stock / Shortage: 32 packets)
 */
export async function runMurukkuBenchmarkWorkspace(
  actor: ActorMeta
): Promise<BenchmarkRunSummary> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const suffix = Date.now().toString(36).toUpperCase().slice(-5);

  // 0. Ensure Company Settings stateCode = 33 (Tamil Nadu)
  const settingsRef = doc(db, 'settings', 'company');
  const settingsSnap = await getDoc(settingsRef);
  const companyPayload = {
    companyName: 'Kaveri Heritage Foods',
    legalName: 'Kaveri Heritage Foods Pvt. Ltd.',
    gstin: '33AABCK4821M1Z5',
    stateCode: '33',
    stateName: 'Tamil Nadu',
    address: 'Plot 42, SIDCO Industrial Estate, Kurichi, Coimbatore - 641021, Tamil Nadu',
    phone: '+91 422 267 8410',
    email: 'accounts@kaveriheritagefoods.in',
    invoicePrefix: 'KHF-INV',
    orderPrefix: 'KHF-ORD',
    batchPrefix: 'KHF-BCH',
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  };
  if (settingsSnap.exists()) {
    await updateDoc(settingsRef, companyPayload);
  } else {
    await setDoc(settingsRef, companyPayload);
  }

  // 1. Opening Stock Masters (Parent documents committed before dependent BOMs & Orders)
  await Promise.all([
    upsertMasterDoc(
      'raw_materials',
      'rm_bm_flour',
      {
        code: 'RM-BM-FLR',
        name: 'Rice & Urad Murukku Flour',
        category: 'Grains & Flours',
        unit: 'kg',
        currentStock: 100,
        reorderLevel: 50,
        costPerUnitPaisa: 4500,
        supplierName: 'Cauvery Agro Mills, Erode',
        status: 'active',
      },
      {
        name: 'Rice & Urad Murukku Flour',
        category: 'Grains & Flours',
        unit: 'kg',
        currentStock: 100,
        reorderLevel: 50,
        costPerUnitPaisa: 4500,
        supplierName: 'Cauvery Agro Mills, Erode',
        status: 'active',
      }
    ),
    upsertMasterDoc(
      'raw_materials',
      'rm_bm_oil',
      {
        code: 'RM-BM-OIL',
        name: 'Cooking Oil (Groundnut Blend)',
        category: 'Edible Oils',
        unit: 'litres',
        currentStock: 30,
        reorderLevel: 10,
        costPerUnitPaisa: 16000,
        supplierName: 'Pollachi Cold-Press Oils',
        status: 'active',
      },
      {
        name: 'Cooking Oil (Groundnut Blend)',
        category: 'Edible Oils',
        unit: 'litres',
        currentStock: 30,
        reorderLevel: 10,
        costPerUnitPaisa: 16000,
        supplierName: 'Pollachi Cold-Press Oils',
        status: 'active',
      }
    ),
    upsertMasterDoc(
      'raw_materials',
      'rm_bm_spice',
      {
        code: 'RM-BM-SPC',
        name: 'Murukku Spice Mix (Cumin & Sesame)',
        category: 'Spice Blends',
        unit: 'kg',
        currentStock: 5,
        reorderLevel: 2,
        costPerUnitPaisa: 35000,
        supplierName: 'Erode Spice Roasters',
        status: 'active',
      },
      {
        name: 'Murukku Spice Mix (Cumin & Sesame)',
        category: 'Spice Blends',
        unit: 'kg',
        currentStock: 5,
        reorderLevel: 2,
        costPerUnitPaisa: 35000,
        supplierName: 'Erode Spice Roasters',
        status: 'active',
      }
    ),
    upsertMasterDoc(
      'packaging_materials',
      'pkg_bm_pouch',
      {
        code: 'PKG-BM-PCH',
        name: 'Murukku Laminated Pouches (200g)',
        materialType: 'Flexible Pouch',
        unit: 'pcs',
        currentStock: 500,
        reorderLevel: 150,
        costPerUnitPaisa: 300,
        supplierName: 'Sivakasi PolyPack Industries',
        status: 'active',
      },
      {
        name: 'Murukku Laminated Pouches (200g)',
        materialType: 'Flexible Pouch',
        unit: 'pcs',
        currentStock: 500,
        reorderLevel: 150,
        costPerUnitPaisa: 300,
        supplierName: 'Sivakasi PolyPack Industries',
        status: 'active',
      }
    ),
    upsertMasterDoc(
      'packaging_materials',
      'pkg_bm_carton',
      {
        code: 'PKG-BM-CRT',
        name: 'Corrugated Shipping Cartons (20-pack)',
        materialType: 'Corrugated Carton',
        unit: 'pcs',
        currentStock: 30,
        reorderLevel: 10,
        costPerUnitPaisa: 2500,
        supplierName: 'Coimbatore Box Makers',
        status: 'active',
      },
      {
        name: 'Corrugated Shipping Cartons (20-pack)',
        materialType: 'Corrugated Carton',
        unit: 'pcs',
        currentStock: 30,
        reorderLevel: 10,
        costPerUnitPaisa: 2500,
        supplierName: 'Coimbatore Box Makers',
        status: 'active',
      }
    ),
    upsertMasterDoc(
      'products',
      'prod_bm_murukku',
      {
        sku: 'KHF-MRK-200',
        name: 'Finished Murukku 200g',
        category: 'Savory Snacks',
        hsnCode: '21069099',
        unit: 'Packet',
        packSize: '200 g',
        gstBps: 500,
        sellingPricePaisa: 5000,
        standardCostPaisa: 3200,
        currentStock: 50,
        reorderLevel: 100,
        status: 'active',
      },
      {
        name: 'Finished Murukku 200g',
        category: 'Savory Snacks',
        hsnCode: '21069099',
        unit: 'Packet',
        packSize: '200 g',
        gstBps: 500,
        sellingPricePaisa: 5000,
        standardCostPaisa: 3200,
        currentStock: 50,
        reorderLevel: 100,
        status: 'active',
      }
    ),
    upsertMasterDoc(
      'customers',
      'cust_bm_retailer_a',
      {
        code: 'CUST-BM-RETA',
        businessName: 'Retailer A',
        contactName: 'Aravind Krishnan',
        phone: '+91 98422 10101',
        email: 'retailera@tnfoods.in',
        gstin: '33AAACR1101A1Z2',
        stateCode: '33',
        stateName: 'Tamil Nadu',
        city: 'Coimbatore',
        address: 'RS Puram, Coimbatore - 641002',
        creditLimitPaisa: 10000000,
        outstandingPaisa: 0,
        status: 'active',
        createdBy: actor.uid,
      },
      {
        businessName: 'Retailer A',
        contactName: 'Aravind Krishnan',
        phone: '+91 98422 10101',
        email: 'retailera@tnfoods.in',
        gstin: '33AAACR1101A1Z2',
        stateCode: '33',
        stateName: 'Tamil Nadu',
        city: 'Coimbatore',
        address: 'RS Puram, Coimbatore - 641002',
        creditLimitPaisa: 10000000,
        outstandingPaisa: 0,
        status: 'active',
      }
    ),
    upsertMasterDoc(
      'customers',
      'cust_bm_distributor_b',
      {
        code: 'CUST-BM-DISTB',
        businessName: 'Distributor B',
        contactName: 'Bala Murugan',
        phone: '+91 98422 20202',
        email: 'distb@tnfoods.in',
        gstin: '33AAACD2202B1Z8',
        stateCode: '33',
        stateName: 'Tamil Nadu',
        city: 'Salem',
        address: 'Five Roads, Salem - 636004',
        creditLimitPaisa: 15000000,
        outstandingPaisa: 0,
        status: 'active',
        createdBy: actor.uid,
      },
      {
        businessName: 'Distributor B',
        contactName: 'Bala Murugan',
        phone: '+91 98422 20202',
        email: 'distb@tnfoods.in',
        gstin: '33AAACD2202B1Z8',
        stateCode: '33',
        stateName: 'Tamil Nadu',
        city: 'Salem',
        address: 'Five Roads, Salem - 636004',
        creditLimitPaisa: 15000000,
        outstandingPaisa: 0,
        status: 'active',
      }
    ),
  ]);

  // 2. Define BOM for Finished Murukku 200g (200 packets standard batch)
  const bomData: Omit<Bom, 'id'> = {
    productId: 'prod_bm_murukku',
    productSku: 'KHF-MRK-200',
    productName: 'Finished Murukku 200g',
    batchYieldQty: 200,
    batchUnit: 'Packet',
    standardLaborCostPaisa: 120000, // ₹1,200 Labour
    standardOverheadPaisa: 60000,   // ₹600 Gas & Power
    rawMaterialItems: [
      {
        itemId: 'rm_bm_flour',
        code: 'RM-BM-FLR',
        name: 'Rice & Urad Murukku Flour',
        unit: 'kg',
        qtyPerBatch: 40,
        costPerUnitPaisa: 4500,
      },
      {
        itemId: 'rm_bm_oil',
        code: 'RM-BM-OIL',
        name: 'Cooking Oil (Groundnut Blend)',
        unit: 'litres',
        qtyPerBatch: 10, // Std 10L vs Actual 10.5L => +5% oil consumption variance
        costPerUnitPaisa: 16000,
      },
      {
        itemId: 'rm_bm_spice',
        code: 'RM-BM-SPC',
        name: 'Murukku Spice Mix (Cumin & Sesame)',
        unit: 'kg',
        qtyPerBatch: 1.2,
        costPerUnitPaisa: 35000,
      },
    ],
    packagingItems: [
      {
        itemId: 'pkg_bm_pouch',
        code: 'PKG-BM-PCH',
        name: 'Murukku Laminated Pouches (200g)',
        unit: 'pcs',
        qtyPerBatch: 200,
        costPerUnitPaisa: 300,
      },
      {
        itemId: 'pkg_bm_carton',
        code: 'PKG-BM-CRT',
        name: 'Corrugated Shipping Cartons (20-pack)',
        unit: 'pcs',
        qtyPerBatch: 10,
        costPerUnitPaisa: 2500,
      },
    ],
    notes: 'Benchmark Murukku 200g BOM (200 packets standard, ₹1,200 labor + ₹600 gas & power).',
    updatedBy: actor.uid,
  };

  await upsertMasterDoc('boms', 'bom_bm_murukku', bomData, {
    batchYieldQty: bomData.batchYieldQty,
    batchUnit: bomData.batchUnit,
    standardLaborCostPaisa: bomData.standardLaborCostPaisa,
    standardOverheadPaisa: bomData.standardOverheadPaisa,
    rawMaterialItems: bomData.rawMaterialItems,
    packagingItems: bomData.packagingItems,
    notes: bomData.notes,
    updatedBy: actor.uid,
  });

  // 3. Purchase: 60 kg flour at ₹45/kg -> Receive Transactionally (Flour: 100 + 60 = 160 kg)
  const purchaseId = await createPurchaseOrder(actor, {
    purchaseNumber: `PO-BM-${suffix}`,
    supplierName: 'Cauvery Agro Mills, Erode',
    supplierGstin: '33AAACC1209M1Z1',
    invoiceRef: `CAM-BM-${suffix}`,
    itemCategory: 'raw_material',
    items: [
      {
        itemId: 'rm_bm_flour',
        code: 'RM-BM-FLR',
        name: 'Rice & Urad Murukku Flour',
        unit: 'kg',
        quantity: 60,
        unitCostPaisa: 4500,
        gstBps: 0,
        lineTotalPaisa: 270000,
      },
    ],
    subtotalPaisa: 270000,
    totalTaxPaisa: 0,
    totalAmountPaisa: 270000,
  });

  await receivePurchaseTransaction(actor, purchaseId, `CAM-BM-${suffix}`);

  // 4. Production Run: Planned 200 packets, Actual 188 good packets, 40kg flour, 10.5L oil, 1.2kg spice, 188+6 pouches, 9 cartons
  const bomDoc: Bom = { id: 'bom_bm_murukku', ...bomData };
  const batchNumber = `BCH-BM-${suffix}`;
  const productionRunId = await createProductionRun(actor, bomDoc, 200, batchNumber);

  const runSnap = await getDoc(doc(db, 'production_runs', productionRunId));
  const createdRun = { id: productionRunId, ...(runSnap.data() as Omit<ProductionRun, 'id'>) };

  await completeProductionRunTransaction(actor, createdRun, bomDoc, {
    actualOutputQty: 188,
    wastageQty: 12,
    wastageReason: '12 packets yield shortfall & 6 damaged pouches during heat-sealing',
    rawMaterialsConsumed: [
      { itemId: 'rm_bm_flour', actualQty: 40 },
      { itemId: 'rm_bm_oil', actualQty: 10.5 },
      { itemId: 'rm_bm_spice', actualQty: 1.2 },
    ],
    packagingConsumed: [
      { itemId: 'pkg_bm_pouch', goodQty: 188, damagedQty: 6, actualQty: 194 },
      { itemId: 'pkg_bm_carton', goodQty: 9, damagedQty: 0, actualQty: 9 },
    ],
  });

  // 5. Sales: Retailer A orders 150 packets at ₹50 (5% GST = 2.5% CGST + 2.5% SGST -> ₹7,875)
  const retailerASnap = await getDoc(doc(db, 'customers', 'cust_bm_retailer_a'));
  const retailerA = {
    id: 'cust_bm_retailer_a',
    ...(retailerASnap.data() as Omit<Customer, 'id'>),
  };

  const retailerAOrderId = await createSalesOrder(actor, {
    customer: retailerA,
    companyStateCode: '33',
    orderNumber: `ORD-RETA-${suffix}`,
    orderDate: todayStr,
    notes: 'Benchmark Retailer A order (150 packets Murukku 200g)',
    items: [
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
    ],
  });

  const ordASnap = await getDoc(doc(db, 'sales_orders', retailerAOrderId));
  const orderA = { id: retailerAOrderId, ...(ordASnap.data() as Omit<SalesOrder, 'id'>) };

  const retailerAInvoiceId = await generateGstInvoiceTransaction(
    actor,
    orderA,
    retailerA,
    '33',
    `INV-RETA-${suffix}`
  );

  const invASnap = await getDoc(doc(db, 'invoices', retailerAInvoiceId));
  const invoiceA = { id: retailerAInvoiceId, ...(invASnap.data() as Omit<GstInvoice, 'id'>) };

  const retailerADispatchId = await createDispatchTransaction(actor, invoiceA, {
    dispatchNumber: `DSP-RETA-${suffix}`,
    transporterName: 'Kaveri Local Fleet',
    vehicleNumber: 'TN-37-BM-2026',
    lrNumber: `LR-${suffix}`,
  });

  // Payment received from Retailer A: ₹4,000 (400000 paisa) -> Outstanding ₹3,875 (387500 paisa)
  const retailerAPaymentId = await recordPaymentTransaction(actor, invoiceA, {
    receiptNumber: `RCPT-BM-${suffix}`,
    amountPaisa: 400000,
    paymentMode: 'NEFT',
    referenceNumber: `UTR-BM-${suffix}`,
    paymentDate: todayStr,
    notes: 'Part payment ₹4,000 received from Retailer A',
  });

  // 6. Distributor B: Requests 120 packets when only 88 packets remain -> Insufficient stock (Shortage: 32 packets)
  const distBSnap = await getDoc(doc(db, 'customers', 'cust_bm_distributor_b'));
  const distributorB = {
    id: 'cust_bm_distributor_b',
    ...(distBSnap.data() as Omit<Customer, 'id'>),
  };

  const distributorBOrderId = await createSalesOrder(actor, {
    customer: distributorB,
    companyStateCode: '33',
    orderNumber: `ORD-DISTB-${suffix}`,
    orderDate: todayStr,
    notes: 'Distributor B request (120 packets) - pending stock availability check',
    items: [
      {
        productId: 'prod_bm_murukku',
        sku: 'KHF-MRK-200',
        name: 'Finished Murukku 200g',
        hsnCode: '21069099',
        unit: 'Packet',
        quantity: 120,
        unitPricePaisa: 5000,
        gstBps: 500,
      },
    ],
  });

  await writeAuditLog(
    actor,
    'BENCHMARK_EXECUTED',
    'settings',
    'company',
    `Executed Murukku 200g benchmark transactions (Batch ${batchNumber})`
  );

  return {
    purchaseId,
    productionRunId,
    retailerAOrderId,
    retailerAInvoiceId,
    retailerADispatchId,
    retailerAPaymentId,
    distributorBOrderId,
  };
}

