import type { Invoice, InvoiceLine } from "./types";

export const round2 = (n: number) => Math.round(n * 100) / 100;

// Rates are GST inclusive. Within the home state the tax is split CGST + SGST
// (half each); across states it is IGST.
export function computeTotals(lines: InvoiceLine[], interstate: boolean) {
  let taxable = 0, cgst = 0, sgst = 0, igst = 0, total = 0;
  for (const l of lines) {
    const gross = l.qty * l.rate;
    const base = gross / (1 + l.gstRate / 100);
    const tax = gross - base;
    taxable += base;
    total += gross;
    if (interstate) igst += tax;
    else { cgst += tax / 2; sgst += tax / 2; }
  }
  return { taxable: round2(taxable), cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst), total: round2(total) };
}

export function lineBreakup(l: InvoiceLine, interstate: boolean) {
  const gross = l.qty * l.rate;
  const base = gross / (1 + l.gstRate / 100);
  const tax = gross - base;
  return {
    unitBase: round2(l.rate / (1 + l.gstRate / 100)),
    taxable: round2(base),
    cgst: interstate ? 0 : round2(tax / 2),
    sgst: interstate ? 0 : round2(tax / 2),
    igst: interstate ? round2(tax) : 0,
    total: round2(gross),
  };
}

export const invoiceTax = (i: Invoice) => i.cgst + i.sgst + i.igst;
