export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Timestamps from the gateway are UTC: either "YYYY-MM-DD HH:MM:SS" (no zone) or ISO with a trailing Z.
// Show them in the viewer's local time.
export function fmtDate(value: string | null): string {
  if (!value) return "never";
  const iso = value.endsWith("Z") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export const fmtDuration = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
