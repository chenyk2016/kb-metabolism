export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

export function agoText(iso: string | null | undefined): string {
  const d = daysSince(iso);
  if (d === null) return "—";
  if (d <= 0) return "今天";
  if (d === 1) return "昨天";
  return `${d} 天前`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 生命体征：0（死寂）→ 1（新鲜）。取所有存活信号里最新的一个对衰减窗口归一。 */
export function vitality(
  decayDays: number,
  ...isoDates: Array<string | null | undefined>
): number {
  const days = isoDates
    .map((d) => daysSince(d))
    .filter((d): d is number => d !== null);
  if (days.length === 0) return 0;
  const freshest = Math.min(...days);
  return Math.max(0, Math.min(1, 1 - freshest / decayDays));
}
