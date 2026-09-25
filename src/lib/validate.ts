// Input rules shared by forms and the engine. Every save path checks these, so
// bad values are rejected with a clear message instead of corrupting the books.

import type { Customer, Settings } from "./types";
import { isValidMobile, normalizePhone } from "./auth";

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const STATE_CODE: Record<string, string> = { Karnataka: "29", "Tamil Nadu": "33" };
export const MAX_PAYMENT = 1_00_00_000; // ₹1 crore per entry
export const GST_RATES = [0, 5, 12, 18, 28];

export function checkGstin(gstin: string, state?: string): string | null {
  if (!gstin) return null;
  if (!GSTIN_RE.test(gstin)) return "GSTIN must be 15 characters, like 29ABCDE1234F1Z5.";
  const code = state ? STATE_CODE[state] : undefined;
  if (code && gstin.slice(0, 2) !== code) return `GSTIN should start with ${code} for ${state}.`;
  return null;
}

const WEAK_PINS = new Set(["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "0123", "4321", "9876", "1212", "1122"]);

export function settingsErrors(s: Settings, previous: Settings): string[] {
  const e: string[] = [];
  if (!s.agencyName.trim()) e.push("Agency name can't be empty.");
  if (s.agencyName.length > 80) e.push("Agency name is too long (80 characters max).");
  const g = checkGstin(s.agencyGstin, s.homeState);
  if (!s.agencyGstin || g) e.push(g ?? "Agency GSTIN is required.");
  const pin = s.ownerPin ?? "1234";
  if (!/^\d{4}$/.test(pin)) e.push("Owner PIN must be exactly 4 digits.");
  else if (pin !== (previous.ownerPin ?? "1234") && WEAK_PINS.has(pin)) e.push("Pick a less obvious owner PIN (no repeated or simple sequences).");
  if (!s.sizes.some((z) => z.active)) e.push("At least one cylinder size must be active.");
  const ids = new Set<string>();
  for (const z of s.sizes) {
    const name = z.label || "A size";
    if (!z.label.trim()) e.push("Every size needs a label.");
    if (!(z.kg > 0 && z.kg <= 500)) e.push(`${name}: weight must be between 0 and 500 kg.`);
    for (const [k, v] of [["Domestic price", z.domesticPrice], ["Commercial price", z.commercialPrice], ["Purchase price", z.purchasePrice]] as const) {
      if (v !== null && !(v >= 0 && v <= 1_00_000)) e.push(`${name}: ${k.toLowerCase()} must be between ₹0 and ₹1,00,000.`);
    }
    if (!GST_RATES.includes(z.purchaseGst)) e.push(`${name}: purchase GST must be one of ${GST_RATES.join(", ")}%.`);
    if (!(z.lowStockThreshold >= 0 && z.lowStockThreshold <= 10_000)) e.push(`${name}: low-stock level must be 0 to 10,000.`);
    if (ids.has(z.id)) e.push(`${name}: two sizes have the same weight.`);
    ids.add(z.id);
  }
  if (!(s.pendingApprovalHours >= 1 && s.pendingApprovalHours <= 72)) e.push("Approval overdue time must be 1 to 72 hours.");
  if (!(s.emptiesTolerance >= 0 && s.emptiesTolerance <= 100)) e.push("Allowed empties must be 0 to 100.");
  if (!(s.gpsMaxDistanceKm >= 0.05 && s.gpsMaxDistanceKm <= 50)) e.push("GPS limit must be 0.05 to 50 km.");
  return [...new Set(e)];
}

export function customerErrors(c: Customer, all: { id: string; phone: string; customerId?: string }[]): string[] {
  const e: string[] = [];
  if (!c.name.trim()) e.push("Contact name is required.");
  if (c.name.length > 80 || c.businessName.length > 80) e.push("Names can be at most 80 characters.");
  if (c.address.length > 200) e.push("Address can be at most 200 characters.");
  if (!isValidMobile(c.phone)) e.push("Phone must be a 10-digit Indian mobile number.");
  else if (all.some((u) => u.customerId !== c.id && normalizePhone(u.phone) === normalizePhone(c.phone))) {
    e.push("This phone number already belongs to another login. Each person needs their own number.");
  }
  const g = checkGstin(c.gstin, c.state);
  if (g) e.push(g);
  if (c.type === "commercial" && !c.gstin && c.creditLimit > 0) e.push("Credit customers who are commercial need a GSTIN.");
  if (!(c.creditLimit >= 0 && c.creditLimit <= 1_00_00_000)) e.push("Credit limit must be ₹0 to ₹1 crore.");
  if (!(c.depositAmount >= 0 && c.depositAmount <= 1_00_00_000)) e.push("Deposit amount must be ₹0 to ₹1 crore.");
  if (Object.values(c.depositCylinders).some((n) => !(n >= 0 && n <= 1000))) e.push("Deposit cylinders must be 0 to 1,000 per size.");
  return e;
}

export function paymentError(amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount above ₹0.";
  if (!Number.isInteger(amount)) return "Enter the amount in whole rupees.";
  if (amount > MAX_PAYMENT) return "That amount is above ₹1 crore. Split it or check the figure.";
  return null;
}
