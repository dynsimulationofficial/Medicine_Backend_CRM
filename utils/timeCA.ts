// src/utils/timeCA.ts
import { DateTime } from "luxon";

export const ZONE = "America/Toronto";
export const DATE_FMT = "MM-dd-yyyy";
export const DATETIME_FMT = "MM-dd-yyyy hh:mm a";

export function toCAString(d: any): string | null {
    if (!d) return null;
    return DateTime.fromJSDate(new Date(d), { zone: "utc" })
        .setZone(ZONE)
        .toFormat(DATETIME_FMT);
}
export function toCADate(d: any): string | null {
    if (!d) return null;
    return DateTime.fromJSDate(new Date(d), { zone: "utc" })
        .setZone(ZONE)
        .toFormat(DATE_FMT);
}
export function parseInCA(text?: string | null): DateTime | null {
    if (!text) return null;
    const INPUT_FORMATS = [
        "MM-dd-yyyy h:mma",
        "MM-dd-yyyy hh:mma",
        "MM-dd-yyyy h:mm a",
        "MM-dd-yyyy hh:mm a",
        "MM-dd-yyyy HH:mm",
        "yyyy-MM-dd HH:mm",
        "yyyy-MM-dd'T'HH:mm",
    ];
    for (const f of INPUT_FORMATS) {
        const dt = DateTime.fromFormat(text, f, { zone: ZONE });
        if (dt.isValid) return dt;
    }
    const iso = DateTime.fromISO(text, { zone: ZONE });
    return iso.isValid ? iso : null;
}
export function remainingMinutesCA(dueUtc: Date): number {
    return Math.max(
        0,
        Math.ceil(
            DateTime.fromJSDate(dueUtc, { zone: "utc" })
                .setZone(ZONE)
                .diff(DateTime.now().setZone(ZONE), "minutes").minutes
        )
    );
}
export function startEndTodayCA() {
    const nowCA = DateTime.now().setZone(ZONE);
    return {
        nowCA,
        todayStartUTC: nowCA.startOf("day").toUTC().toISO({ suppressMilliseconds: true })!,
        todayEndUTC: nowCA.endOf("day").toUTC().toISO({ suppressMilliseconds: true })!,
        nowUtcISO: nowCA.toUTC().toISO({ suppressMilliseconds: true })!,
    };
}
