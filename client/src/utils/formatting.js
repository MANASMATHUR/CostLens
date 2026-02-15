export const fmt = (n) => {
  const value = Number(n);
  if (!Number.isFinite(value)) return "$0";
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value}`;
};

export const fmtRange = (low, high) => `${fmt(low)}–${fmt(high)}`;

export const toNum = (n, fallback = 0) => {
  const value = Number(n);
  return Number.isFinite(value) ? value : fallback;
};

export const toText = (value, fallback = "Unknown") => {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
};
