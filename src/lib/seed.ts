// Generates 60 days of realistic history for a Bharat Gas distributor in
// Bangalore. Deterministic (fixed random seed) but anchored to "now" so the
// demo always ends today. It uses the same engine functions as the UI.

import {
  approveDelivery, changeState, computeStock, createLoadSheet, createPurchase, createSaleInvoice, custLoc, locQty,
  move, priceFor, reconcileTruck, recordPayment, rejectDelivery, submitDelivery, truckExpected, WH,
} from "./engine";
import { dayKey } from "./format";
import { customerBalances } from "./selectors";
import type { Customer, CylinderSize, DB, Driver, SizeQty, Truck } from "./types";

export const DB_VERSION = 5;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IST = (date: string, h: number, m = 0) =>
  new Date(`${date}T${String(h).padStart(2, "0")}:${String(Math.floor(m)).padStart(2, "0")}:00+05:30`).toISOString();

export const DEFAULT_SIZES: CylinderSize[] = [
  { id: "5", label: "5 kg", kg: 5, domesticPrice: 335, commercialPrice: 590, purchasePrice: 548, purchaseGst: 18, lowStockThreshold: 20, active: true },
  { id: "14.2", label: "14.2 kg", kg: 14.2, domesticPrice: 855, commercialPrice: null, purchasePrice: 806, purchaseGst: 5, lowStockThreshold: 60, active: true },
  { id: "19", label: "19 kg", kg: 19, domesticPrice: null, commercialPrice: 1750, purchasePrice: 1655, purchaseGst: 18, lowStockThreshold: 40, active: true },
  { id: "47.5", label: "47.5 kg", kg: 47.5, domesticPrice: null, commercialPrice: 4365, purchasePrice: 4130, purchaseGst: 18, lowStockThreshold: 15, active: true },
];

const AREAS: Record<string, { lat: number; lng: number; pin: string; state?: string }> = {
  Jayanagar: { lat: 12.925, lng: 77.5938, pin: "560041" },
  Indiranagar: { lat: 12.9719, lng: 77.6412, pin: "560038" },
  Whitefield: { lat: 12.9698, lng: 77.75, pin: "560066" },
  "HSR Layout": { lat: 12.9116, lng: 77.6474, pin: "560102" },
  Yelahanka: { lat: 13.1007, lng: 77.5963, pin: "560064" },
  Koramangala: { lat: 12.9352, lng: 77.6245, pin: "560034" },
  Malleshwaram: { lat: 13.0035, lng: 77.5709, pin: "560003" },
  Hebbal: { lat: 13.0358, lng: 77.597, pin: "560024" },
  Hosur: { lat: 12.7409, lng: 77.8253, pin: "635109", state: "Tamil Nadu" },
};
const AREA_LIST = Object.keys(AREAS);

type Cat = "Hotel" | "Restaurant" | "PG" | "Caterer" | "Industry" | "Household";
// [business, contact, category, area, payment mode, flag]
// flag: "E" returns fewer empties than delivered, "C" pays slowly (goes over credit limit)
const CUSTOMERS: [string, string, Cat, string, "credit" | "cod", ("E" | "C")?][] = [
  ["Hotel Mayura Residency", "Srinivas Murthy", "Hotel", "Jayanagar", "credit"],
  ["The Brindavan Grand", "Arvind Shenoy", "Hotel", "Indiranagar", "credit", "C"],
  ["Whitefield Comforts Inn", "Joseph Mathew", "Hotel", "Whitefield", "credit"],
  ["Hotel Sagar Comforts", "Umesh Kamath", "Hotel", "Koramangala", "credit"],
  ["Yelahanka Palace Residency", "Harish Gowda", "Hotel", "Yelahanka", "credit"],
  ["Hotel Chalukya Deluxe", "Ramesh Bhat", "Hotel", "Malleshwaram", "credit"],
  ["Udupi Sri Krishna Bhavan", "Gopal Upadhya", "Restaurant", "Jayanagar", "credit"],
  ["Nammoora Biryani House", "Syed Faizan", "Restaurant", "Koramangala", "credit", "E"],
  ["Tandoor Tales Kitchen", "Harpreet Singh", "Restaurant", "Indiranagar", "cod"],
  ["Andhra Spice Meals", "Srinivas Reddy", "Restaurant", "HSR Layout", "cod"],
  ["Coastal Catch Seafood", "Prashanth Poojary", "Restaurant", "Indiranagar", "credit", "C"],
  ["Dosa Point Darshini", "Mahesh Kumar", "Restaurant", "Malleshwaram", "cod"],
  ["Chai Chaska Cafe", "Neha Agarwal", "Restaurant", "Whitefield", "cod"],
  ["Malabar Parotta Centre", "Abdul Rasheed", "Restaurant", "Hebbal", "cod"],
  ["Green Leaf Veg Restaurant", "Vinay Rao", "Restaurant", "Yelahanka", "credit"],
  ["Punjabi Rasoi Dhaba", "Gurpreet Kaur", "Restaurant", "HSR Layout", "cod"],
  ["Sai Balaji Gents PG", "Nagaraj K", "PG", "Koramangala", "cod"],
  ["Sunshine Ladies PG", "Meena Iyer", "PG", "HSR Layout", "cod"],
  ["Comfort Stay Co-living", "Rohit Verma", "PG", "Whitefield", "credit", "E"],
  ["Sri Vinayaka PG for Men", "Chandrashekar M", "PG", "Hebbal", "cod"],
  ["Green Nest Women's Hostel", "Deepa Nair", "PG", "Jayanagar", "cod"],
  ["Annapoorna Caterers", "Venkatesh Iyengar", "Caterer", "Jayanagar", "credit"],
  ["Royal Feast Caterers", "Imran Pasha", "Caterer", "Yelahanka", "credit", "E"],
  ["Shubha Mangala Caterers", "Raghu Sharma", "Caterer", "Malleshwaram", "credit"],
  ["Corporate Bites Catering", "Sanjay Menon", "Caterer", "Whitefield", "credit", "C"],
  ["Precision Tools & Dies", "Kiran Kulkarni", "Industry", "Yelahanka", "credit"],
  ["Laxmi Heat Treatment Works", "Anand Patil", "Industry", "Hebbal", "credit", "E"],
  ["Southern Glass Crafts", "Thomas George", "Industry", "Whitefield", "credit"],
  ["Hosur Auto Components Pvt Ltd", "Senthil Kumar", "Industry", "Hosur", "credit"],
  ["Namma Bakery Units", "Ashok Shetty", "Industry", "Koramangala", "credit"],
  ["", "Lakshmi Narayan", "Household", "Jayanagar", "cod"],
  ["", "Priya Raghavan", "Household", "Indiranagar", "cod"],
  ["", "Suresh Babu", "Household", "Koramangala", "cod"],
  ["", "Kavitha Reddy", "Household", "Whitefield", "cod"],
  ["", "Manjula Devi", "Household", "Yelahanka", "cod"],
  ["", "Arjun Nair", "Household", "HSR Layout", "cod"],
  ["", "Farida Begum", "Household", "Hebbal", "cod"],
  ["", "Vijay Kumar S", "Household", "Malleshwaram", "cod"],
  ["", "Anitha Rao", "Household", "Indiranagar", "cod"],
  ["", "Rahul Deshpande", "Household", "Jayanagar", "cod"],
];

const DRIVERS = [
  "Ravi Kumar", "Manjunath Gowda", "Suresh Naik", "Mohammed Irfan", "Venkatesh Reddy", "Prakash Shetty",
  "Basavaraj Patil", "Anil Kumar", "Syed Imran", "Raghavendra Rao", "Naveen Kumar", "Kiran Hegde",
];
const TRUCK_MODELS: [string, number][] = [["Tata 407", 120], ["Ashok Leyland Dost", 80], ["Mahindra Bolero Pickup", 60], ["Tata Ace Gold", 45]];
const STREETS = ["1st Main Road", "4th Cross", "100 Feet Road", "8th Block", "2nd Stage", "Service Road", "Main Road", "5th Cross", "11th Main", "3rd Phase"];
const REJECT_REASONS = ["Stamp missing on acknowledgement", "Photo not clear, please retake", "Quantity on slip does not match entry", "Wrong customer selected"];

// Typical order per category: [size, min, max], and days between orders
const PATTERN: Record<Cat, { lines: [string, number, number][]; every: [number, number] }> = {
  Hotel: { lines: [["19", 4, 8], ["47.5", 1, 2]], every: [2, 3] },
  Restaurant: { lines: [["19", 2, 4]], every: [2, 4] },
  PG: { lines: [["19", 1, 2]], every: [3, 5] },
  Caterer: { lines: [["19", 3, 6], ["47.5", 0, 1], ["5", 0, 2]], every: [3, 4] },
  Industry: { lines: [["47.5", 2, 4], ["19", 1, 2]], every: [3, 4] },
  Household: { lines: [["14.2", 1, 1]], every: [18, 28] },
};

const DEPOSIT_PER_CYL: Record<string, number> = { "5": 1150, "14.2": 2200, "19": 3500, "47.5": 6000 };

export function buildSeed(nowMs = Date.now()): DB {
  const r = rng(20260925);
  const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const L = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const gstin = (code: string) =>
    `${code}${Array.from({ length: 5 }, () => pick(L.split(""))).join("")}${ri(1000, 9999)}${pick(L.split(""))}1Z${pick("0123456789ABCDEF".split(""))}`;

  const db: DB = {
    version: DB_VERSION,
    seededAt: new Date(nowMs).toISOString(),
    settings: {
      agencyName: "Anmol Gas Agency",
      agencyTagline: "Bharat Gas Distributor, Bangalore",
      agencyGstin: "29AAKFA4821M1Z6",
      agencyAddress: "No. 42, KIADB Industrial Area, Peenya 2nd Stage, Bengaluru 560058",
      homeState: "Karnataka",
      sizes: DEFAULT_SIZES.map((s) => ({ ...s })),
      pendingApprovalHours: 4,
      emptiesTolerance: 2,
      gpsMaxDistanceKm: 0.5,
      hsnCode: "2711",
    },
    users: [], drivers: [], trucks: [], customers: [],
    plants: [
      { id: "pl1", name: "Bharat Gas LPG Bottling Plant, Doddaballapur", gstin: "29ABCDE1234F1Z5", state: "Karnataka" },
      { id: "pl2", name: "Bharat Gas LPG Bottling Plant, Hosur", gstin: "33ABCDE1234F1Z9", state: "Tamil Nadu" },
    ],
    movements: [], loadSheets: [], deliveries: [], invoices: [], payments: [], reconciliations: [], syncLog: [],
    lastSyncedAt: null, counters: {},
  };

  // ---- people and trucks ----
  db.users.push({ id: "u-owner", name: "Anmol Mehta", role: "owner", phone: "98450 11223" });
  db.users.push({ id: "u-wh1", name: "Shivakumar B", role: "warehouse", phone: "98860 45120" });
  db.users.push({ id: "u-wh2", name: "Lakshmi Devi", role: "warehouse", phone: "99004 77812" });
  DRIVERS.forEach((name, i) => {
    const [model, capacity] = TRUCK_MODELS[i % TRUCK_MODELS.length];
    const t: Truck = { id: `t${i + 1}`, regNo: `KA-${pick(["01", "02", "03", "04", "05", "50", "51", "53"])}-${pick(L.split(""))}${pick(L.split(""))}-${ri(1000, 9999)}`, model, capacity };
    const d: Driver = { id: `dr${i + 1}`, name, phone: `9${ri(100000000, 999999999)}`.replace(/(\d{5})(\d{5})/, "$1 $2"), licenseNo: `KA${ri(10, 59)} ${ri(2008, 2020)}${ri(1000000, 9999999)}`, truckId: t.id };
    db.trucks.push(t);
    db.drivers.push(d);
    db.users.push({ id: `u-${d.id}`, name, role: "driver", phone: d.phone, driverId: d.id });
  });

  const flags: Record<string, "E" | "C" | undefined> = {};
  CUSTOMERS.forEach(([biz, contact, cat, area, mode, flag], i) => {
    const A = AREAS[area];
    const pattern = PATTERN[cat];
    const deposit: Record<string, number> = {};
    for (const [size, , max] of pattern.lines) deposit[size] = cat === "Household" ? ri(1, 2) : Math.max(1, max) * 2;
    const depositAmount = Object.entries(deposit).reduce((s, [k, q]) => s + q * DEPOSIT_PER_CYL[k], 0);
    const type = cat === "Household" ? "domestic" : "commercial";
    const limit = mode === "cod" ? 0 : cat === "Hotel" ? 150000 : cat === "Industry" ? 200000 : cat === "Caterer" ? 100000 : 60000;
    const c: Customer = {
      id: `c${i + 1}`, code: `AGA-C${String(i + 1).padStart(3, "0")}`, name: contact, businessName: biz, type, category: cat,
      gstin: type === "commercial" ? gstin(A.state === "Tamil Nadu" ? "33" : "29") : "",
      phone: `${pick(["98", "99", "97", "96", "90", "80", "63"])}${ri(100, 999)} ${ri(10000, 99999)}`,
      address: `${ri(1, 480)}, ${pick(STREETS)}, ${area}, ${A.state ? "Hosur" : "Bengaluru"} ${A.pin}`,
      area, state: A.state ?? "Karnataka",
      lat: +(A.lat + (r() - 0.5) * 0.02).toFixed(5), lng: +(A.lng + (r() - 0.5) * 0.02).toFixed(5),
      creditLimit: limit, depositCylinders: deposit, depositAmount, paymentMode: mode,
      openingOutstanding: mode === "credit" ? ri(8, 30) * 1000 : 0,
      openingEmpties: { ...deposit },
    };
    flags[c.id] = flag;
    db.customers.push(c);
    db.users.push({ id: `u-${c.id}`, name: contact, role: "customer", phone: c.phone, customerId: c.id });
  });

  // area -> trucks (first areas get two trucks)
  const areaTrucks: Record<string, string[]> = {};
  AREA_LIST.forEach((a, i) => { areaTrucks[a] = [`t${i + 1}`]; if (i + AREA_LIST.length < 12) areaTrucks[a].push(`t${i + 1 + AREA_LIST.length}`); });
  const driverOf = (truckId: string) => db.drivers.find((d) => d.truckId === truckId)!;

  // ---- opening stock (60 days ago) ----
  const DAYS = 60;
  const today = dayKey(new Date(nowMs));
  const dates = Array.from({ length: DAYS }, (_, i) => dayKey(new Date(nowMs - (DAYS - 1 - i) * 864e5)));
  const openTs = IST(dates[0], 6, 0);
  const opening: Record<string, [number, number, number, number]> = { "5": [60, 20, 2, 3], "14.2": [220, 80, 6, 10], "19": [240, 60, 4, 8], "47.5": [60, 15, 1, 2] };
  for (const [size, [f, e, d, t]] of Object.entries(opening)) {
    move(db, { ts: openTs, userId: "u-owner", from: "OPENING", to: WH, size, state: "full", qty: f, refType: "opening" });
    move(db, { ts: openTs, userId: "u-owner", from: "OPENING", to: WH, size, state: "empty", qty: e, refType: "opening" });
    move(db, { ts: openTs, userId: "u-owner", from: "OPENING", to: WH, size, state: "defective", qty: d, refType: "opening" });
    move(db, { ts: openTs, userId: "u-owner", from: "OPENING", to: WH, size, state: "testing", qty: t, refType: "opening" });
  }
  for (const c of db.customers) {
    for (const [size, q] of Object.entries(c.openingEmpties)) move(db, { ts: openTs, userId: "u-owner", from: "OPENING", to: custLoc(c.id), size, state: "empty", qty: q, refType: "opening" });
  }

  // ---- daily simulation ----
  const nextDue: Record<string, number> = {};
  db.customers.forEach((c) => { const p = PATTERN[c.category as Cat]; nextDue[c.id] = ri(0, p.every[1]); });
  const payDay: Record<string, number> = {};
  db.customers.forEach((c) => (payDay[c.id] = ri(0, 6)));
  const WH_TARGET: SizeQty = { "5": 60, "14.2": 200, "19": 230, "47.5": 55 };

  // Minutes since midnight IST, so today's activity always ends before "now".
  const nowMinIST = (() => {
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(nowMs)).split(":").map(Number);
    return (h % 24) * 60 + m;
  })();
  const todayStartMin = Math.max(2, Math.min(7 * 60 + 30, nowMinIST - 180));
  const tsMin = (date: string, minutes: number) => {
    const m = Math.max(1, date === today ? Math.min(minutes, nowMinIST - 1) : minutes);
    return IST(date, Math.floor(m / 60), m % 60);
  };

  let purchaseCount = 0;
  let yesterdayGpsDone = false;

  dates.forEach((date, di) => {
    const isToday = date === today;
    const isYesterday = di === DAYS - 2;
    const lastDays = DAYS - 1 - di; // 0 = today

    // Morning purchase from the plant every 2 days
    if (di % 2 === 0) {
      const stock = computeStock(db.movements);
      const full: SizeQty = {}, emptiesBack: SizeQty = {}, defectiveBack: SizeQty = {}, testingBack: SizeQty = {};
      for (const size of Object.keys(WH_TARGET)) {
        let need = WH_TARGET[size] - locQty(stock, WH, size, "full");
        if (size === "47.5" && lastDays <= 6) need -= 28; // plant allocation shortage -> low stock alert
        if (need > 0) full[size] = Math.ceil(need / 5) * 5;
        emptiesBack[size] = Math.max(0, locQty(stock, WH, size, "empty") - ri(5, 12));
        if (di % 6 === 0) {
          defectiveBack[size] = locQty(stock, WH, size, "defective");
          testingBack[size] = locQty(stock, WH, size, "testing");
        }
      }
      purchaseCount++;
      createPurchase(db, { date, ts: isToday ? tsMin(date, Math.max(1, todayStartMin - 60)) : IST(date, 6, 30), plantId: purchaseCount % 4 === 0 ? "pl2" : "pl1", full, emptiesBack, defectiveBack, testingBack, userId: pick(["u-wh1", "u-wh2"]), source: "seed" });
    }

    // Who needs gas today
    const plan: { c: Customer; full: SizeQty; truckId: string }[] = [];
    for (const c of db.customers) {
      const forced = isToday && ["c1", "c7", "c22", "c10", "c18"].includes(c.id);
      if (di < nextDue[c.id] && !forced) continue;
      const p = PATTERN[c.category as Cat];
      nextDue[c.id] = di + ri(p.every[0], p.every[1]);
      const full: SizeQty = {};
      for (const [size, min, max] of p.lines) { const q = ri(min, max); if (q > 0) full[size] = q; }
      if (!Object.keys(full).length) continue;
      const trucks = areaTrucks[c.area];
      let truckId = trucks[di % trucks.length];
      if (isToday && ["c1", "c7", "c22"].includes(c.id)) truckId = "t1";
      if (isToday && ["c10", "c18"].includes(c.id)) truckId = "t4";
      plan.push({ c, full, truckId });
    }

    // Load sheets
    const loadMin = isToday ? todayStartMin : 7 * 60 + ri(10, 40);
    const byTruck = new Map<string, typeof plan>();
    for (const p of plan) byTruck.set(p.truckId, [...(byTruck.get(p.truckId) ?? []), p]);
    const whNow = computeStock(db.movements);
    const avail: SizeQty = {};
    for (const sz of Object.keys(WH_TARGET)) avail[sz] = locQty(whNow, WH, sz, "full");
    for (const [truckId, items] of byTruck) {
      const lines: SizeQty = {};
      for (const it of items) for (const [s, q] of Object.entries(it.full)) lines[s] = (lines[s] ?? 0) + q;
      for (const s of Object.keys(lines)) lines[s] += ri(1, 3);
      if (isToday && truckId === "t1") { lines["14.2"] = (lines["14.2"] ?? 0) + 6; lines["19"] = (lines["19"] ?? 0) + 6; lines["5"] = (lines["5"] ?? 0) + 3; }
      for (const sz of Object.keys(lines)) {
        const need = items.reduce((n, it) => n + (it.full[sz] ?? 0), 0);
        lines[sz] = Math.max(Math.min(need, avail[sz]), Math.min(lines[sz], avail[sz]));
        avail[sz] -= lines[sz];
      }
      createLoadSheet(db, { date, ts: tsMin(date, loadMin + ri(0, 20)), truckId, driverId: driverOf(truckId).id, lines, userId: pick(["u-wh1", "u-wh2"]) });
    }

    // Deliveries
    const dayEnd = isToday ? nowMinIST - 10 : 17 * 60 + 45;
    const dayStart = isToday ? todayStartMin + 25 : 9 * 60;
    const span = Math.max(10, dayEnd - dayStart);
    for (const [truckId, items] of byTruck) {
      const drv = driverOf(truckId);
      items.forEach((it, k) => {
        const c = it.c;
        const minute = Math.min(dayEnd, dayStart + Math.floor(((k + r() * 0.8) / items.length) * span));
        const ts = tsMin(date, minute);
        const empty: SizeQty = {};
        for (const [s, q] of Object.entries(it.full)) {
          let back = q;
          if (flags[c.id] === "E" && r() < 0.45) back = Math.max(0, q - 1);
          empty[s] = back;
        }
        const gross = Object.entries(it.full).reduce((sum, [s, q]) => sum + q * priceFor(db, s, c.type), 0);
        const payment = c.paymentMode === "cod" ? { amount: gross, mode: (r() < 0.55 ? "cash" : "upi") as "cash" | "upi" } : null;
        let gps = { lat: +(c.lat + (r() - 0.5) * 0.0008).toFixed(6), lng: +(c.lng + (r() - 0.5) * 0.0008).toFixed(6), mocked: false };
        if (isYesterday && truckId !== "t6" && !yesterdayGpsDone) { gps = { lat: +(c.lat + 0.024).toFixed(6), lng: +(c.lng - 0.011).toFixed(6), mocked: false }; yesterdayGpsDone = true; }
        const photo = `ph:${ri(1, 6)}`;
        const reject = !isToday && r() < 0.035;
        const d = submitDelivery(db, { ts, truckId, driverId: drv.id, customerId: c.id, full: it.full, empty, payment, photo, gps, userId: `u-${drv.id}` });
        const reviewer = pick(["u-wh1", "u-wh2", "u-owner"]);
        const reviewTs = (h: number) => new Date(new Date(ts).getTime() + h * 36e5).toISOString();
        if (reject) {
          rejectDelivery(db, d.id, reviewer, pick(REJECT_REASONS), reviewTs(0.5));
          // driver re-submits a corrected entry
          const d2 = submitDelivery(db, { ts: reviewTs(0.8), truckId, driverId: drv.id, customerId: c.id, full: it.full, empty, payment, photo: `ph:${ri(1, 6)}`, gps, userId: `u-${drv.id}` });
          approveDelivery(db, d2.id, reviewer, reviewTs(1.5));
        } else if (isToday) {
          const ageH = (nowMs - new Date(ts).getTime()) / 36e5;
          if (ageH > 2.5) approveDelivery(db, d.id, reviewer, reviewTs(1));
        } else if (isYesterday && truckId === "t6" && k === items.length - 1) {
          // left pending overnight -> "approval overdue" alert
        } else {
          approveDelivery(db, d.id, reviewer, reviewTs(ri(1, 3)));
        }
      });
    }

    // Credit customers pay weekly
    if (!isToday) {
      const bal = customerBalances(db);
      for (const c of db.customers) {
        if (c.paymentMode !== "credit" || di % 7 !== payDay[c.id]) continue;
        const due = bal[c.id].outstanding;
        if (due <= 1000) continue;
        const share = flags[c.id] === "C" ? 0.25 + r() * 0.2 : 0.85 + r() * 0.15;
        const amount = Math.round((due * share) / 100) * 100;
        recordPayment(db, { customerId: c.id, date, ts: IST(date, 11, ri(0, 59)), amount, mode: r() < 0.6 ? "neft" : "cheque", ref: r() < 0.6 ? `UTR${ri(100000000, 999999999)}` : `CHQ ${ri(100000, 999999)}`, source: "seed" });
      }
    }

    // Warehouse checks: flag underweight / due-for-test cylinders
    if (!isToday) {
      const st = computeStock(db.movements);
      const size = pick(["14.2", "19", "19", "47.5", "5"]);
      if (r() < 0.6 && locQty(st, WH, size, "full") > 5) {
        changeState(db, { ts: IST(date, 18, 5), size, from: "full", to: "defective", qty: 1, userId: "u-wh1", note: "Underweight on weighing scale" });
      }
      const tsize = pick(["14.2", "19"]);
      const q = Math.min(ri(1, 3), locQty(st, WH, tsize, "empty"));
      if (r() < 0.5 && q > 0) changeState(db, { ts: IST(date, 18, 10), size: tsize, from: "empty", to: "testing", qty: q, userId: "u-wh2", note: "Test date due" });
    }

    // End of day returns
    const stock = computeStock(db.movements);
    for (const truckId of byTruck.keys()) {
      if (isToday && truckId !== "t4") continue; // other trucks are still on the road
      const expected = truckExpected(db, stock, truckId);
      const actual: Record<string, { full: number; empty: number }> = {};
      for (const [s, e] of Object.entries(expected)) actual[s] = { ...e };
      if (isToday) {
        // one truck came back short today
        actual["19"] = { full: Math.max(0, expected["19"].full - 1), empty: Math.max(0, expected["19"].empty - 1) };
      } else if (r() < 0.012) {
        const s = pick(Object.keys(actual).filter((k) => expected[k].full > 0));
        if (s) actual[s].full -= 1;
      }
      const ts = isToday ? tsMin(date, Math.max(todayStartMin + 30, nowMinIST - 20)) : tsMin(date, 18 * 60 + 30 + ri(0, 50));
      reconcileTruck(db, { date, ts, truckId, driverId: driverOf(truckId).id, actual, userId: pick(["u-wh1", "u-wh2"]) });
    }
  });

  // Earlier Tally sync (yesterday evening): a counter sale and a receipt
  const y = dates[DAYS - 2];
  const syncTs = IST(y, 20, 15);
  const cs = db.customers.find((c) => c.id === "c12")!;
  const tallySale = createSaleInvoice(db, { customerId: cs.id, date: y, ts: IST(y, 16, 40), full: { "19": 2 }, empty: { "19": 2 }, source: "tally" });
  move(db, { ts: IST(y, 16, 40), userId: "u-owner", from: WH, to: custLoc(cs.id), size: "19", state: "full", qty: 2, refType: "tally", refId: tallySale.id });
  move(db, { ts: IST(y, 16, 40), userId: "u-owner", from: custLoc(cs.id), to: WH, size: "19", state: "empty", qty: 2, refType: "tally", refId: tallySale.id });
  recordPayment(db, { customerId: cs.id, date: y, ts: IST(y, 16, 45), amount: tallySale.total, mode: "cash", source: "tally", ref: "Counter sale" });
  db.syncLog.push({ id: "sync1", ts: syncTs, vouchers: [
    { type: "Sales", no: tallySale.no, party: cs.businessName, amount: tallySale.total },
    { type: "Receipt", no: "RCT/0412", party: cs.businessName, amount: tallySale.total },
  ] });
  db.lastSyncedAt = syncTs;

  // Make the demo alert set deterministic: flagged customers end over their
  // limit, everyone else comfortably under it.
  const bal = customerBalances(db);
  for (const c of db.customers) {
    if (c.paymentMode !== "credit") continue;
    const due = bal[c.id].outstanding;
    if (flags[c.id] === "C") c.creditLimit = Math.max(5000, Math.floor((due * 0.75) / 5000) * 5000);
    else if (due > c.creditLimit * 0.9) c.creditLimit = Math.ceil((due * 1.4) / 10000) * 10000;
  }

  db.movements.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return db;
}

