/**
 * Core Domain Types, Portal Modes & Role-Based Access Control Matrix for FactoryFlow ERP
 * (Order-to-Audit ERP for South Indian Packaged Food Manufacturing).
 * All monetary amounts are stored strictly as integer paisa (1 INR = 100 paisa).
 */

export type PortalMode = 'landing' | 'workspace';

export type UserRole =
  | 'owner'
  | 'admin'
  | 'salesman'
  | 'production_supervisor'
  | 'accountant';

export type ErpModuleId =
  | 'dashboard'
  | 'sales_orders'
  | 'customers'
  | 'products'
  | 'inventory'
  | 'gst_invoices'
  | 'dispatch'
  | 'raw_materials'
  | 'packaging'
  | 'bom'
  | 'production'
  | 'quality_control'
  | 'costing'
  | 'purchases'
  | 'payments'
  | 'stock_ledger'
  | 'ai_insights'
  | 'reports'
  | 'users'
  | 'settings';

export interface DemoSessionContext {
  mode: 'demo' | 'authenticated';
  portal: 'workspace';
  role: UserRole;
  sessionToken?: string;
}

export interface UserProfile {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: 'active' | 'inactive';
  phone?: string;
  department?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CompanySetting {
  id: string;
  companyName: string;
  legalName: string;
  gstin: string;
  stateCode: string;
  stateName: string;
  address?: string;
  phone?: string;
  email?: string;
  invoicePrefix?: string;
  orderPrefix?: string;
  batchPrefix?: string;
  updatedBy?: string;
  updatedAt?: unknown;
}

export interface Customer {
  id: string;
  code: string;
  businessName: string;
  contactName: string;
  phone: string;
  email?: string;
  gstin?: string;
  stateCode: string;
  stateName: string;
  city: string;
  address?: string;
  creditLimitPaisa: number;
  outstandingPaisa: number;
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  hsnCode: string;
  unit: string;
  packSize: string;
  gstBps: number; // e.g., 500 = 5%, 1200 = 12%, 1800 = 18%
  sellingPricePaisa: number;
  standardCostPaisa: number;
  currentStock: number;
  reorderLevel: number;
  description?: string;
  imageUrl?: string;
  shelfLifeDays?: number;
  storageTemp?: string;
  weightGrams?: number;
  fssaiLicense?: string;
  allergens?: string;
  status: 'active' | 'inactive';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RawMaterial {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  reorderLevel: number;
  costPerUnitPaisa: number;
  supplierName?: string;
  shelfLifeDays?: number;
  status: 'active' | 'inactive';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PackagingMaterial {
  id: string;
  code: string;
  name: string;
  materialType: string;
  unit: string;
  currentStock: number;
  reorderLevel: number;
  costPerUnitPaisa: number;
  supplierName?: string;
  status: 'active' | 'inactive';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email?: string;
  gstin?: string;
  stateCode: string;
  stateName: string;
  address?: string;
  category: string;
  leadTimeDays: number;
  status: 'active' | 'inactive';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BomIngredientItem {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  qtyPerBatch: number;
  costPerUnitPaisa: number;
}

export interface Bom {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  batchYieldQty: number;
  batchUnit: string;
  standardLaborCostPaisa: number;
  standardOverheadPaisa: number;
  rawMaterialItems: BomIngredientItem[];
  packagingItems: BomIngredientItem[];
  notes?: string;
  updatedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PurchaseRequest {
  id: string;
  prNumber: string;
  sourceType: 'manual' | 'order_shortage' | 'low_stock';
  linkedOrderId?: string;
  linkedOrderNumber?: string;
  itemCategory: 'raw_material' | 'packaging';
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  requestedQty: number;
  estimatedUnitCostPaisa: number;
  status: 'pending' | 'approved' | 'converted_to_po' | 'rejected';
  linkedPoId?: string;
  requestedBy: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PurchaseLineItem {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unitCostPaisa: number;
  gstBps: number;
  lineTotalPaisa: number;
}

export interface Purchase {
  id: string;
  purchaseNumber: string;
  supplierId?: string;
  supplierName: string;
  supplierGstin?: string;
  invoiceRef?: string;
  grnNumber?: string;
  batchNumber?: string;
  mfgDate?: string;
  expiryDate?: string;
  linkedPrId?: string;
  itemCategory: 'raw_material' | 'packaging';
  items: PurchaseLineItem[];
  subtotalPaisa: number;
  totalTaxPaisa: number;
  totalAmountPaisa: number;
  status: 'ordered' | 'received';
  receivedBy?: string;
  receivedAt?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ConsumedMaterialLine {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  plannedQty: number;
  actualQty: number;
  goodQty?: number;
  damagedQty?: number;
  unitCostPaisa: number;
  totalCostPaisa: number;
  batchNumber?: string;
}

export type WipStage = 'mixing' | 'cooking' | 'cooling' | 'packaging' | 'qc_pending' | 'completed';

export interface ProductionRun {
  id: string;
  batchNumber: string;
  productId: string;
  productSku: string;
  productName: string;
  bomId: string;
  plannedQty: number;
  actualOutputQty: number;
  wastageQty: number;
  wastageReason?: string;
  rawMaterialsConsumed: ConsumedMaterialLine[];
  packagingConsumed: ConsumedMaterialLine[];
  standardCostPaisa: number;
  actualMaterialCostPaisa: number;
  laborOverheadPaisa: number;
  actualTotalCostPaisa: number;
  variancePaisa: number;
  status: 'planned' | 'in_progress' | 'completed';
  wipStage?: WipStage;
  mfgDate?: string;
  expiryDate?: string;
  qcStatus?: 'pending' | 'passed' | 'hold' | 'rejected';
  linkedOrderId?: string;
  linkedOrderNumber?: string;
  supervisorUid: string;
  supervisorName?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InventoryBatch {
  id: string;
  itemType: 'raw_material' | 'packaging' | 'finished_good';
  itemId: string;
  itemCode: string;
  itemName: string;
  batchNumber: string;
  lotCode: string;
  mfgDate: string;
  expiryDate: string;
  initialQty: number;
  remainingQty: number;
  unit: string;
  unitCostPaisa: number;
  qcStatus: 'pending' | 'passed' | 'hold' | 'rejected';
  sourceType: 'opening' | 'grn' | 'production';
  sourceId?: string;
  sourceRef?: string;
  supplierName?: string;
  rawBatchRefs?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface QcParameterCheck {
  name: string;
  result: string;
  passed: boolean;
}

export interface QcInspection {
  id: string;
  qcNumber: string;
  inspectionType: 'raw_material' | 'finished_good';
  itemId: string;
  itemCode: string;
  itemName: string;
  batchId?: string;
  batchNumber: string;
  inspectedQty: number;
  passedQty: number;
  rejectedQty: number;
  status: 'passed' | 'hold' | 'rejected';
  parameters: QcParameterCheck[];
  inspectorName: string;
  remarks?: string;
  inspectedDate: string;
  refType?: string;
  refId?: string;
  createdAt?: unknown;
}

export interface OrderLineItem {
  productId: string;
  sku: string;
  name: string;
  hsnCode: string;
  unit: string;
  quantity: number;
  unitPricePaisa: number;
  gstBps: number;
  lineSubtotalPaisa: number;
  cgstPaisa: number;
  sgstPaisa: number;
  igstPaisa: number;
  lineTaxPaisa: number;
  lineTotalPaisa: number;
}

export type SalesOrderStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'approved'
  | 'confirmed'
  | 'in_production'
  | 'ready_for_dispatch'
  | 'invoiced'
  | 'dispatched'
  | 'delivered'
  | 'rejected'
  | 'cancelled';

export interface SalesOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerStateCode: string;
  salesmanUid: string;
  salesmanName: string;
  source?: 'merchant' | 'buyer_portal';
  deliveryAddress?: string;
  contactPhone?: string;
  items: OrderLineItem[];
  subtotalPaisa: number;
  cgstPaisa: number;
  sgstPaisa: number;
  igstPaisa: number;
  totalTaxPaisa: number;
  totalAmountPaisa: number;
  status: SalesOrderStatus;
  rejectionReason?: string;
  linkedProductionRunId?: string;
  allocatedBatches?: Array<{
    batchId: string;
    batchNumber: string;
    productId: string;
    quantity: number;
    expiryDate: string;
  }>;
  notes?: string;
  orderDate: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GstInvoice {
  id: string;
  invoiceNumber: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerGstin?: string;
  customerStateCode: string;
  companyStateCode: string;
  isInterState: boolean;
  items: OrderLineItem[];
  subtotalPaisa: number;
  cgstPaisa: number;
  sgstPaisa: number;
  igstPaisa: number;
  totalTaxPaisa: number;
  totalAmountPaisa: number;
  paidAmountPaisa: number;
  balanceDuePaisa: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  dispatchStatus: 'pending' | 'dispatched';
  invoiceDate: string;
  dueDate: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Dispatch {
  id: string;
  dispatchNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  transporterName: string;
  vehicleNumber?: string;
  lrNumber?: string;
  dispatchedItems: Array<{
    productId: string;
    sku: string;
    name: string;
    unit: string;
    quantity: number;
    batchAllocations?: Array<{
      batchId: string;
      batchNumber: string;
      quantity: number;
      expiryDate: string;
    }>;
  }>;
  status: 'packed' | 'dispatched' | 'delivered';
  dispatchedBy: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Payment {
  id: string;
  receiptNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amountPaisa: number;
  paymentMode: 'NEFT' | 'RTGS' | 'UPI' | 'Cheque' | 'Cash';
  referenceNumber?: string;
  paymentDate: string;
  notes?: string;
  recordedBy: string;
  createdAt?: unknown;
}

export interface StockMovement {
  id: string;
  itemType: 'raw_material' | 'packaging' | 'finished_good';
  itemId: string;
  itemCode: string;
  itemName: string;
  movementType:
    | 'PURCHASE_IN'
    | 'PRODUCTION_CONSUME'
    | 'PRODUCTION_OUT'
    | 'PRODUCTION_WASTAGE'
    | 'DISPATCH_OUT'
    | 'QC_REJECT'
    | 'ADJUSTMENT';
  unit: string;
  beforeQty: number;
  changeQty: number;
  afterQty: number;
  unitCostPaisa: number;
  totalValuePaisa: number;
  refType: string;
  refId: string;
  refNumber: string;
  batchNumber?: string;
  actorUid: string;
  actorName?: string;
  createdAt?: unknown;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: UserRole | 'buyer';
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt?: unknown;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Executive Officer',
  production_supervisor: 'Merchant',
  salesman: 'Salesman',
  accountant: 'Auditor',
};

export interface PortalDefinition {
  role: UserRole;
  portalTitle: string;
  subtitle: string;
  scopeSummary: string;
  defaultModule: ErpModuleId;
  capabilities: string[];
}

export const PORTAL_DEFINITIONS: PortalDefinition[] = [
  {
    role: 'owner',
    portalTitle: 'Owner Portal',
    subtitle: 'Enterprise governance, plant oversight & full ERP control',
    scopeSummary: 'Full Access · 20 Modules',
    defaultModule: 'dashboard',
    capabilities: [
      'Real-time revenue, stock valuation & production variance dashboard',
      'User role authorization, GST settings & benchmark audit runs',
      'End-to-end approvals across orders, procurement, costing & AI insights',
    ],
  },
  {
    role: 'admin',
    portalTitle: 'Executive Officer Portal',
    subtitle: 'Commercial operations, order approvals, GST billing & receivables',
    scopeSummary: 'Commercial & Ops · 15 Modules',
    defaultModule: 'dashboard',
    capabilities: [
      'Approve sales orders, verify finished/BOM stock & raise GST invoices',
      'Manage customer accounts, dispatch FEFO batches & payment collections',
      'Executive operational analytics, procurement oversight & audit reports',
    ],
  },
  {
    role: 'production_supervisor',
    portalTitle: 'Merchant Portal',
    subtitle: 'Shop-floor manufacturing, BOM planning, QC & batch inventory',
    scopeSummary: 'Plant & Inventory · 14 Modules',
    defaultModule: 'production',
    capabilities: [
      'Manage raw materials, packaging stock, BOM recipes & WIP production stages',
      'Run Quality Control inspections, FEFO batch lots & costing variance',
      'Coordinate procurement GRNs, dispatch fulfillment & stock ledger entries',
    ],
  },
  {
    role: 'salesman',
    portalTitle: 'Salesman Portal',
    subtitle: 'Field sales order entry, customer accounts & live SKU pricing',
    scopeSummary: 'Field Sales · 4 Modules',
    defaultModule: 'sales_orders',
    capabilities: [
      'Book intra-state & inter-state GST sales orders for distributors',
      'Manage B2B customer contacts, GSTIN details & credit limits',
      'Check live finished-goods availability & track own sales history',
    ],
  },
  {
    role: 'accountant',
    portalTitle: 'Auditor Portal',
    subtitle: 'Read-only GST compliance, stock reconciliation & audit ledger',
    scopeSummary: 'Read-Only Compliance · 19 Modules',
    defaultModule: 'reports',
    capabilities: [
      'Inspect GST tax registers, customer receivables & payment receipts',
      'Audit traceable stock movements, batch FEFO logs & costing variance',
      'Export PDF & Excel monthly compliance and audit trail reports',
    ],
  },
];

export const ROLE_ALLOWED_MODULES: Record<UserRole, ErpModuleId[]> = {
  owner: [
    'dashboard',
    'sales_orders',
    'customers',
    'products',
    'inventory',
    'gst_invoices',
    'dispatch',
    'raw_materials',
    'packaging',
    'bom',
    'production',
    'quality_control',
    'costing',
    'purchases',
    'payments',
    'stock_ledger',
    'ai_insights',
    'reports',
    'users',
    'settings',
  ],
  admin: [
    'dashboard',
    'sales_orders',
    'customers',
    'products',
    'inventory',
    'gst_invoices',
    'dispatch',
    'purchases',
    'payments',
    'raw_materials',
    'packaging',
    'quality_control',
    'stock_ledger',
    'ai_insights',
    'reports',
  ],
  salesman: ['dashboard', 'sales_orders', 'customers', 'products'],
  production_supervisor: [
    'dashboard',
    'inventory',
    'raw_materials',
    'packaging',
    'bom',
    'production',
    'quality_control',
    'costing',
    'purchases',
    'products',
    'dispatch',
    'stock_ledger',
    'ai_insights',
    'reports',
  ],
  accountant: [
    'dashboard',
    'sales_orders',
    'customers',
    'products',
    'inventory',
    'gst_invoices',
    'dispatch',
    'raw_materials',
    'packaging',
    'bom',
    'production',
    'quality_control',
    'costing',
    'purchases',
    'payments',
    'stock_ledger',
    'ai_insights',
    'reports',
    'settings',
  ],
};

export const INDIAN_STATES: Array<{ code: string; name: string }> = [
  { code: '33', name: 'Tamil Nadu' },
  { code: '29', name: 'Karnataka' },
  { code: '32', name: 'Kerala' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '34', name: 'Puducherry' },
  { code: '27', name: 'Maharashtra' },
  { code: '07', name: 'Delhi' },
  { code: '24', name: 'Gujarat' },
];
