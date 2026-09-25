// Indian formatting helpers (lakh / crore grouping, Rs symbol, IST dates).

const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (n: number) => inr0.format(Math.round(n));
export const rupees = (n: number, decimals = false) =>
  `₹${decimals ? inr2.format(n) : inr0.format(Math.round(n))}`;

// Short form for cards: ₹12.4 L, ₹1.2 Cr
export function rupeesShort(n: number) {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  return `${sign}₹${inr0.format(Math.round(a))}`;
}

const TZ = "Asia/Kolkata";
export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
export const fmtDateShort = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: TZ });
export const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ });
export const fmtDateTime = (d: string | Date) => `${fmtDate(d)}, ${fmtTime(d)}`;

// YYYY-MM-DD in IST
export function dayKey(d: Date | string = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
  return parts;
}
export const monthKey = (d: Date | string) => dayKey(d).slice(0, 7);
export const fmtMonth = (m: string) =>
  new Date(`${m}-01T00:00:00+05:30`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: TZ });

export function hoursSince(iso: string, now = Date.now()) {
  return (now - new Date(iso).getTime()) / 36e5;
}

export function timeAgo(iso: string, now = Date.now()) {
  const h = hoursSince(iso, now);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 24) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

// Haversine distance in km
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const custName = (c: { businessName: string; name: string }) => c.businessName || c.name;
