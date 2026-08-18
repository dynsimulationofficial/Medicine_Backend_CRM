// src/utils/timeCA.ts -> Backwards compatibility alias pointing to timeZoneHelper.ts
import { DateTime } from "luxon";
import {
  TIMEZONES,
  DATE_FMT,
  DATETIME_FMT,
  formatToCountryDateTime,
  formatToCountryDate,
  getRemainingMinutes,
  getStartEndToday,
} from "./timeZoneHelper";

export { TIMEZONES, DATE_FMT, DATETIME_FMT };

// Default timezone set to India (IST)
export const ZONE = TIMEZONES.INDIA;

export function toCAString(d: any, countryOrZone?: string): string | null {
  return formatToCountryDateTime(d, countryOrZone || ZONE);
}

export function toCADate(d: any, countryOrZone?: string): string | null {
  return formatToCountryDate(d, countryOrZone || ZONE);
}

export function parseInCA(text?: string | null, countryOrZone?: string): DateTime | null {
  if (!text) return null;
  const zone = countryOrZone || ZONE;
  const INPUT_FORMATS = [
    "MM-dd-yyyy h:mma",
    "MM-dd-yyyy hh:mma",
    "MM-dd-yyyy h:mm a",
    "MM-dd-yyyy hh:mm a",
    "MM-dd-yyyy HH:mm",
    "yyyy-MM-dd HH:mm",
    "yyyy-MM-dd'T'HH:mm",
    "MM-dd-yyyy",
    "yyyy-MM-dd",
  ];
  for (const f of INPUT_FORMATS) {
    const dt = DateTime.fromFormat(text, f, { zone });
    if (dt.isValid) return dt;
  }
  const iso = DateTime.fromISO(text, { zone });
  return iso.isValid ? iso : null;
}

export function remainingMinutesCA(dueUtc: Date, countryOrZone?: string): number {
  return getRemainingMinutes(dueUtc, countryOrZone || ZONE);
}

export function startEndTodayCA(countryOrZone?: string) {
  return getStartEndToday(countryOrZone || ZONE);
}
