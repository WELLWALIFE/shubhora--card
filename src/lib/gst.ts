// GST state codes (first two digits of a GSTIN) and rupees in words, for invoices.
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland",
  "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
  "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (x: number) => (x < 20 ? ONES[x] : `${TENS[Math.floor(x / 10)]}${x % 10 ? ` ${ONES[x % 10]}` : ""}`);
const three = (x: number) => [x >= 100 ? `${ONES[Math.floor(x / 100)]} Hundred` : "", two(x % 100)].filter(Boolean).join(" ");

/** 354000 paise → "Rupees Three Thousand Five Hundred Forty Only" (Indian grouping: crore, lakh, thousand). */
export function rupeesInWords(paise: number): string {
  let r = Math.floor(paise / 100); const p = paise % 100;
  if (r === 0 && p === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(r / 1e7); r %= 1e7;
  const lakh = Math.floor(r / 1e5); r %= 1e5;
  const thousand = Math.floor(r / 1e3); r %= 1e3;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (r) parts.push(three(r));
  return `Rupees ${parts.join(" ") || "Zero"}${p ? ` and ${two(p)} Paise` : ""} Only`;
}

/** How an invoice's GST splits: same state (or unknown buyer state, B2C) → CGST + SGST; other state → IGST. */
export function gstSplit(gstPaise: number, companyState: string, buyerGstin?: string | null) {
  const buyer = String(buyerGstin ?? "").slice(0, 2);
  const pos = buyer || companyState;
  const intra = !!companyState && (!buyer || buyer === companyState);
  const cgst = intra ? Math.floor(gstPaise / 2) : 0;
  return { pos, intra, cgst, sgst: intra ? gstPaise - cgst : 0, igst: intra ? 0 : gstPaise };
}
