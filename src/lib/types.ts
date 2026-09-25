// Core data model for the Anmol Gas Agency demo.
// Everything is plain JSON so the whole database can live in localStorage.

export type Role = "owner" | "warehouse" | "driver" | "customer";

export type CylState = "full" | "empty" | "defective" | "testing";
export const CYL_STATES: CylState[] = ["full", "empty", "defective", "testing"];
export const STATE_LABEL: Record<CylState, string> = {
  full: "Full",
  empty: "Empty",
  defective: "Defective / Underweight",
  testing: "Due for Testing",
};

export type CustomerType = "domestic" | "commercial";

export interface CylinderSize {
  id: string; // e.g. "14.2"
  label: string; // e.g. "14.2 kg"
  kg: number;
  domesticPrice: number | null; // GST inclusive price per refill, null = not sold to domestic
  commercialPrice: number | null;
  purchasePrice: number; // GST inclusive price paid to the plant
  purchaseGst: number; // 5 or 18
  lowStockThreshold: number; // full cylinders at warehouse
  active: boolean;
}

export interface Settings {
  agencyName: string;
  agencyTagline: string;
  agencyGstin: string;
  agencyAddress: string;
  homeState: string; // Karnataka
  sizes: CylinderSize[];
  pendingApprovalHours: number;
  emptiesTolerance: number; // allowed cylinders above security deposit
  gpsMaxDistanceKm: number;
  hsnCode: string;
  ownerPin?: string; // demo lock for the owner login page
}

export interface User {
  id: string;
  name: string;
  role: Role;
  phone: string;
  driverId?: string;
  customerId?: string;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  licenseNo: string;
  truckId: string;
}

export interface Truck {
  id: string;
  regNo: string;
  model: string;
  capacity: number;
}

export interface Customer {
  id: string;
  code: string;
  name: string; // contact person
  businessName: string;
  type: CustomerType;
  category: string; // Hotel, Restaurant, PG, Caterer, Industry, Household
  gstin: string;
  phone: string;
  address: string;
  area: string;
  state: string;
  lat: number;
  lng: number;
  creditLimit: number;
  depositCylinders: Record<string, number>; // per size
  depositAmount: number;
  paymentMode: "credit" | "cod";
  openingOutstanding: number;
  openingEmpties: Record<string, number>; // cylinders held at start of history
}

// Location keys: "WH", "PLANT", "TRUCK:<id>", "CUST:<id>", "OPENING", "ADJ"
export type LocationKey = string;

export interface Movement {
  id: string;
  ts: string; // ISO
  userId: string;
  from: LocationKey;
  to: LocationKey;
  size: string;
  state: CylState; // state leaving "from"
  toState?: CylState; // state arriving at "to" (defaults to state)
  qty: number;
  refType: "opening" | "purchase" | "load" | "delivery" | "reversal" | "return" | "tally" | "adjust";
  refId?: string;
  note?: string;
}

export type SizeQty = Record<string, number>;

export interface LoadSheet {
  id: string;
  no: string;
  date: string; // YYYY-MM-DD
  ts: string;
  truckId: string;
  driverId: string;
  lines: SizeQty; // full cylinders loaded
  createdBy: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  mocked: boolean;
}

export type DeliveryStatus = "pending" | "approved" | "rejected";

export interface Delivery {
  id: string;
  no: string;
  date: string;
  ts: string;
  truckId: string;
  driverId: string;
  customerId: string;
  full: SizeQty;
  empty: SizeQty;
  payment: { amount: number; mode: "cash" | "upi" } | null;
  photo: string; // "ph:<n>" placeholder or data URL
  gps: GeoPoint;
  status: DeliveryStatus;
  rejectReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  invoiceId?: string;
}

export interface InvoiceLine {
  size: string;
  qty: number;
  emptiesReturned: number; // sale: empties taken back; purchase: empties sent to plant
  rate: number; // GST inclusive per cylinder
  gstRate: number;
}

export interface Invoice {
  id: string;
  no: string;
  kind: "sale" | "purchase";
  date: string;
  ts: string;
  partyId: string; // customer id, or plant id
  partyName: string;
  partyGstin: string;
  placeOfSupply: string;
  interstate: boolean;
  lines: InvoiceLine[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  source: "app" | "tally" | "seed";
  deliveryId?: string;
}

export interface Payment {
  id: string;
  customerId: string;
  date: string;
  ts: string;
  amount: number;
  mode: "cash" | "upi" | "cheque" | "neft";
  ref?: string;
  deliveryId?: string;
  source: "app" | "tally" | "seed";
}

export interface Reconciliation {
  id: string;
  date: string;
  ts: string;
  truckId: string;
  driverId: string;
  expected: Record<string, { full: number; empty: number }>;
  actual: Record<string, { full: number; empty: number }>;
  mismatch: boolean;
  by: string;
}

export interface Plant {
  id: string;
  name: string;
  gstin: string;
  state: string;
}

export interface SyncLogEntry {
  id: string;
  ts: string;
  vouchers: { type: "Sales" | "Purchase" | "Receipt"; no: string; party: string; amount: number }[];
}

export type AuditAction =
  | "login" | "login_failed" | "logout" | "view_as"
  | "delivery_submitted" | "delivery_approved" | "delivery_rejected"
  | "load_sheet" | "reconciliation" | "purchase" | "payment" | "stock_state_change"
  | "customer_added" | "customer_edited" | "settings_changed" | "tally_sync" | "demo_reset";

export interface AuditEntry {
  id: string;
  ts: string;
  userId: string; // who did it ("anonymous" for failed logins)
  action: AuditAction;
  detail: string;
}

export interface DB {
  version: number;
  seededAt: string;
  settings: Settings;
  users: User[];
  drivers: Driver[];
  trucks: Truck[];
  customers: Customer[];
  plants: Plant[];
  movements: Movement[];
  loadSheets: LoadSheet[];
  deliveries: Delivery[];
  invoices: Invoice[];
  payments: Payment[];
  reconciliations: Reconciliation[];
  syncLog: SyncLogEntry[];
  lastSyncedAt: string | null;
  counters: Record<string, number>;
  audit?: AuditEntry[]; // newest last, capped (see engine.logAudit)
}
