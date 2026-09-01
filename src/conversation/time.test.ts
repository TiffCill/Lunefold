import { describe, expect, it } from 'vitest';
import { formatConversationTime } from './time';

describe('conversation time labels', () => {
  const now = new Date(2026, 7, 27, 17, 0).getTime();
  it('formats recent and calendar-relative local times', () => {
    expect(formatConversationTime(now - 20_000, now)).toBe('刚刚');
    expect(formatConversationTime(now - 12 * 60_000, now)).toBe('12 分钟前');
    expect(formatConversationTime(new Date(2026, 7, 27, 9, 5).getTime(), now)).toBe('09:05');
    expect(formatConversationTime(new Date(2026, 7, 26, 18, 20).getTime(), now)).toBe('昨天 18:20');
    expect(formatConversationTime(new Date(2026, 4, 3, 12).getTime(), now)).toBe('5月3日');
    expect(formatConversationTime(new Date(2025, 11, 31, 12).getTime(), now)).toBe('2025年12月31日');
  });
});
