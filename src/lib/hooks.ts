"use client";

import * as React from "react";
import { custName } from "./format";
import { useStore } from "./store";
import type { DB } from "./types";

export function locLabel(db: DB, key: string) {
  if (key === "WH") return "Main Warehouse";
  if (key === "PLANT") return "Bharat Gas Plant";
  if (key === "OPENING") return "Opening balance";
  if (key === "LOSS") return "Shortage / excess";
  if (key.startsWith("TRUCK:")) return db.trucks.find((t) => t.id === key.slice(6))?.regNo ?? key;
  if (key.startsWith("CUST:")) { const c = db.customers.find((x) => x.id === key.slice(5)); return c ? custName(c) : key; }
  return key;
}

export function useSizes() {
  const { db } = useStore();
  return React.useMemo(() => db.settings.sizes.filter((s) => s.active), [db.settings.sizes]);
}

// The person actually using the app (owner stays the author even in "view as").
export function useActorId() {
  const { realUser } = useStore();
  return realUser?.id ?? "system";
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function two(n: number) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`; }
function three(n: number) { return `${n >= 100 ? ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " : "") : ""}${n % 100 ? two(n % 100) : ""}`; }

// Indian system: crore, lakh, thousand
export function amountInWords(amount: number) {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const parts: string[] = [];
  const crore = Math.floor(rupees / 1e7), lakh = Math.floor((rupees % 1e7) / 1e5), thousand = Math.floor((rupees % 1e5) / 1e3), rest = rupees % 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  const words = parts.join(" ") || "Zero";
  return `Rupees ${words}${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}
