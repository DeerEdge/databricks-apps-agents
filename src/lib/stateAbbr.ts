// Short labels for crowded chart axes. Indian state/UT names are long, so on in-chart axes we show
// the standard 2-letter code (full name stays available on hover via the chart's tick <title>).
// Districts/cities have no standard code, so we truncate them instead.

import { normalizeState } from "./meddesert";

// Full state/UT name (normalized) → standard code.
const STATE_CODES: Record<string, string> = {
  "ANDHRA PRADESH": "AP", "ARUNACHAL PRADESH": "AR", "ASSAM": "AS", "BIHAR": "BR",
  "CHHATTISGARH": "CG", "GOA": "GA", "GUJARAT": "GJ", "HARYANA": "HR",
  "HIMACHAL PRADESH": "HP", "JHARKHAND": "JH", "KARNATAKA": "KA", "KERALA": "KL",
  "MADHYA PRADESH": "MP", "MAHARASHTRA": "MH", "MANIPUR": "MN", "MEGHALAYA": "ML",
  "MIZORAM": "MZ", "NAGALAND": "NL", "ODISHA": "OD", "ORISSA": "OD", "PUNJAB": "PB",
  "RAJASTHAN": "RJ", "SIKKIM": "SK", "TAMIL NADU": "TN", "TELANGANA": "TS",
  "TRIPURA": "TR", "UTTAR PRADESH": "UP", "UTTARAKHAND": "UK", "UTTARANCHAL": "UK",
  "WEST BENGAL": "WB",
  // Union territories
  "ANDAMAN AND NICOBAR ISLANDS": "AN", "CHANDIGARH": "CH",
  "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "DN", "DELHI": "DL", "NCT OF DELHI": "DL",
  "JAMMU AND KASHMIR": "JK", "LADAKH": "LA", "LAKSHADWEEP": "LD", "PUDUCHERRY": "PY",
};

/**
 * Abbreviate a chart-axis label. Known states/UTs return their 2-letter code; other labels
 * (districts, cities) longer than `max` are truncated with an ellipsis. The full label is meant
 * to stay reachable on hover, so this only governs what is displayed inline.
 */
export function abbreviateLabel(label: string, max = 12): string {
  const full = String(label ?? "").trim();
  if (!full) return "";
  const code = STATE_CODES[normalizeState(full)];
  if (code) return code;
  return full.length > max ? `${full.slice(0, max - 1).trimEnd()}…` : full;
}
