import { ChatError } from "../chat/types.js";
import type { ParsedAutomation } from "./types.js";

function validTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new ChatError("INVALID_TIMEZONE", "Choose a valid timezone.");
  }
}

function parts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((item) => item.type !== "literal")
      .map((item) => [item.type, Number(item.value)]),
  );
  return values as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

function zonedUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const observed = parts(new Date(guess), timeZone);
    const represented = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    guess += Date.UTC(year, month - 1, day, hour, minute, 0, 0) - represented;
  }
  return new Date(guess);
}

export function nextDailyWake(from: Date, hour: number, minute: number, timeZone: string): Date {
  validTimeZone(timeZone);
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  )
    throw new ChatError("INVALID_SCHEDULE", "Choose a valid daily time.");
  const local = parts(from, timeZone);
  let candidate = zonedUtc(local.year, local.month, local.day, hour, minute, timeZone);
  if (candidate.getTime() <= from.getTime()) {
    const noon = new Date(Date.UTC(local.year, local.month - 1, local.day, 12));
    noon.setUTCDate(noon.getUTCDate() + 1);
    const next = parts(noon, timeZone);
    candidate = zonedUtc(next.year, next.month, next.day, hour, minute, timeZone);
  }
  return candidate;
}

export function nextAutomationWake(
  trigger: Record<string, unknown>,
  from = new Date(),
): string | null {
  if (trigger.kind !== "schedule") return null;
  if (trigger.cadence === "interval") {
    const minutes = Number(trigger.everyMinutes);
    if (!Number.isSafeInteger(minutes) || minutes < 5 || minutes > 43_200)
      throw new ChatError("INVALID_SCHEDULE", "Intervals must be between 5 minutes and 30 days.");
    return new Date(from.getTime() + minutes * 60_000).toISOString();
  }
  if (trigger.cadence === "daily") {
    return nextDailyWake(
      from,
      Number(trigger.hour),
      Number(trigger.minute),
      String(trigger.timeZone),
    ).toISOString();
  }
  return null;
}

export function parseAutomationText(
  instruction: string,
  timeZone = "UTC",
  now = new Date(),
): ParsedAutomation {
  const text = instruction.trim();
  if (!text || text.length > 4000)
    throw new ChatError("INVALID_AUTOMATION", "Describe the automation in one clear instruction.");
  const zone = validTimeZone(timeZone);
  const lower = text.toLowerCase();
  const interval =
    /(?:every|alle|jede[nr]?)\s+(\d{1,3})\s*(minutes?|minuten?|hours?|stunden?)/u.exec(lower);
  if (interval) {
    const amount = Number(interval[1]);
    const everyMinutes = /hour|stund/u.test(interval[2] ?? "") ? amount * 60 : amount;
    if (everyMinutes < 5)
      throw new ChatError("INVALID_SCHEDULE", "Background intervals start at five minutes.");
    const trigger = { kind: "schedule", cadence: "interval", everyMinutes, timeZone: zone };
    return {
      name: text.slice(0, 120),
      triggerType: "schedule",
      trigger,
      nextWakeupAt: nextAutomationWake(trigger, now),
      display: `Every ${everyMinutes} min`,
    };
  }

  const daily =
    /(?:every day|daily|jeden tag|jeden morgen|jeden abend)(?:[^0-9]{0,20}(?:at|um)\s*)?(\d{1,2})?(?::(\d{2}))?/u.exec(
      lower,
    );
  if (daily) {
    const fallbackHour = /morgen/u.test(lower) ? 8 : /abend/u.test(lower) ? 19 : 8;
    const hour = daily[1] === undefined ? fallbackHour : Number(daily[1]);
    const minute = daily[2] === undefined ? 0 : Number(daily[2]);
    const trigger = { kind: "schedule", cadence: "daily", hour, minute, timeZone: zone };
    return {
      name: text.slice(0, 120),
      triggerType: "schedule",
      trigger,
      nextWakeupAt: nextAutomationWake(trigger, now),
      display: `Every day · ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    };
  }

  if (/\b(?:when|wenn)\b/u.test(lower)) {
    const source = /github|pull request|\bpr\b|\bci\b/u.test(lower)
      ? "github"
      : /vercel|deploy/u.test(lower)
        ? "deployment"
        : "generic";
    return {
      name: text.slice(0, 120),
      triggerType: /fertig|complete|finished/u.test(lower) ? "dependency" : "condition",
      trigger: { kind: "event", source, expression: text },
      nextWakeupAt: null,
      display: source === "generic" ? "When condition becomes true" : `On ${source} event`,
    };
  }

  throw new ChatError(
    "AUTOMATION_AMBIGUOUS",
    "Include a schedule like “jeden Morgen um 8” or a condition beginning with “wenn”.",
  );
}
