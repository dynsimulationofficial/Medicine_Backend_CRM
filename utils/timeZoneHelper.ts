import { DateTime } from "luxon";

// Supported Country Timezones
export const TIMEZONES = {
  INDIA: "Asia/Kolkata",
  USA_EASTERN: "America/New_York",
  USA_CENTRAL: "America/Chicago",
  USA_PACIFIC: "America/Los_Angeles",
  UK: "Europe/London",
} as const;

export const DATE_FMT = "MM-dd-yyyy";
export const DATETIME_FMT = "MM-dd-yyyy hh:mm a";

/**
 * Get timezone string by country name
 */
export function getTimezoneForCountry(country?: string | null): string {
  if (!country) return TIMEZONES.INDIA;
  const c = country.trim().toLowerCase();
  if (c.includes("us") || c.includes("united states") || c.includes("america")) {
    return TIMEZONES.USA_EASTERN;
  }
  if (c.includes("uk") || c.includes("united kingdom") || c.includes("britain") || c.includes("england")) {
    return TIMEZONES.UK;
  }
  return TIMEZONES.INDIA; // Default to India IST
}

/**
 * Format date to a specific country's local time string
 */
export function formatToCountryDateTime(
  dateInput: any,
  countryOrZone: string = TIMEZONES.INDIA
): string | null {
  if (!dateInput) return null;
  const zone = countryOrZone.includes("/") ? countryOrZone : getTimezoneForCountry(countryOrZone);
  return DateTime.fromJSDate(new Date(dateInput), { zone: "utc" })
    .setZone(zone)
    .toFormat(DATETIME_FMT);
}

/**
 * Format date to a specific country's local date string
 */
export function formatToCountryDate(
  dateInput: any,
  countryOrZone: string = TIMEZONES.INDIA
): string | null {
  if (!dateInput) return null;
  const zone = countryOrZone.includes("/") ? countryOrZone : getTimezoneForCountry(countryOrZone);
  return DateTime.fromJSDate(new Date(dateInput), { zone: "utc" })
    .setZone(zone)
    .toFormat(DATE_FMT);
}

/**
 * Calculate remaining minutes from now until a UTC due date in target timezone
 */
export function getRemainingMinutes(dueUtc: Date, countryOrZone: string = TIMEZONES.INDIA): number {
  const zone = countryOrZone.includes("/") ? countryOrZone : getTimezoneForCountry(countryOrZone);
  return Math.max(
    0,
    Math.ceil(
      DateTime.fromJSDate(dueUtc, { zone: "utc" })
        .setZone(zone)
        .diff(DateTime.now().setZone(zone), "minutes").minutes
    )
  );
}

/**
 * Get current start and end of day in target timezone converted to UTC ISO
 */
export function getStartEndToday(countryOrZone: string = TIMEZONES.INDIA) {
  const zone = countryOrZone.includes("/") ? countryOrZone : getTimezoneForCountry(countryOrZone);
  const nowInZone = DateTime.now().setZone(zone);
  return {
    nowInZone,
    todayStartUTC: nowInZone.startOf("day").toUTC().toISO({ suppressMilliseconds: true })!,
    todayEndUTC: nowInZone.endOf("day").toUTC().toISO({ suppressMilliseconds: true })!,
    nowUtcISO: nowInZone.toUTC().toISO({ suppressMilliseconds: true })!,
  };
}
