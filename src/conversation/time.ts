const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const clock = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

export function formatConversationTime(timestamp: number, nowTimestamp = Date.now()): string {
  const now = new Date(nowTimestamp);
  const value = new Date(timestamp);
  const difference = Math.max(0, nowTimestamp - timestamp);
  if (difference < 60_000) return '刚刚';
  if (difference < 60 * 60_000) return `${Math.floor(difference / 60_000)} 分钟前`;
  if (sameDay(value, now)) return clock(value);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(value, yesterday)) return `昨天 ${clock(value)}`;
  if (value.getFullYear() === now.getFullYear()) return `${value.getMonth() + 1}月${value.getDate()}日`;
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`;
}
