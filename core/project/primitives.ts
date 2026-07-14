import type { EntityId, ISO8601Timestamp } from "./schema";

const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function isEntityId(value: unknown): value is EntityId {
  return typeof value === "string" && value.trim().length > 0;
}

export function isISO8601Timestamp(value: unknown): value is ISO8601Timestamp {
  const match = typeof value === "string" ? ISO_TIMESTAMP.exec(value) : null;
  if (!match || !Number.isFinite(Date.parse(value as string))) return false;

  const [, year, month, day, hour, minute, second, timezone] = match;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const daysInMonth =
    monthNumber >= 1 && monthNumber <= 12
      ? new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate()
      : 0;
  const timezoneValid =
    timezone === "Z" ||
    (() => {
      const [offsetHour, offsetMinute] = timezone.slice(1).split(":").map(Number);
      return offsetHour <= 14 && offsetMinute <= 59 && (offsetHour < 14 || offsetMinute === 0);
    })();

  return (
    dayNumber >= 1 &&
    dayNumber <= daysInMonth &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    timezoneValid
  );
}
