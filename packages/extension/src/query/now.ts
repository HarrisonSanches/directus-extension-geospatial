import { addDays, addHours, addMilliseconds, addMinutes, addMonths, addSeconds, addWeeks, addYears } from 'date-fns';

const minute = 60 * 1000;

// The units of an adjustment, by the names the adjustDate of Directus takes, each with the function of date-fns that
// Directus moves the date by. Directus subtracts with the same function and the amount negated, which is what each sub
// function of date-fns does (V-182).
const units: [string[], (date: Date, amount: number) => Date][] = [
	[['milliseconds', 'millisecond', 'msecs', 'msec', 'ms'], addMilliseconds],
	[['seconds', 'second', 'secs', 'sec', 's'], addSeconds],
	[['minutes', 'minute', 'mins', 'min', 'm'], addMinutes],
	[['hours', 'hour', 'hrs', 'hr', 'h'], addHours],
	[['days', 'day', 'd'], addDays],
	[['weeks', 'week', 'w'], addWeeks],
	[['months', 'month', 'mth', 'mo'], addMonths],
	[['years', 'year', 'yrs', 'yr', 'y'], addYears],
];

const adderOf = new Map(units.flatMap(([names, add]) => names.map((name) => [name, add] as const)));

// The instant a $NOW stands for, as the parseNow of Directus reads it, from the minute of the registration in place of
// the clock: the adjustment between the parentheses, in the syntax of ms, with days when it names no unit, or none,
// when Directus cannot read it (V-182).
const instantOf = (value: string, base: Date): Date => {
	const between = value.includes(')') ? /\(([^()]+)\)/.exec(value)?.[1] : undefined;
	const sign = between?.startsWith('-') === true ? -1 : 1;
	const unsigned = between !== undefined && /^[-+]/.test(between) ? between.slice(1) : between;
	const [, amount, unit = 'days'] = /^(-?(?:\d+)?\.?\d+) *([a-z]+)?$/i.exec(unsigned ?? '') ?? [];
	const add = adderOf.get(unit.toLowerCase());

	return amount === undefined || add === undefined ? base : add(base, sign * Number.parseFloat(amount));
};

// The filter of a registered query with each $NOW resolved once, at the registration, to its minute, so the map, the
// list and the summary answer the same window, and two registrations in the same minute get the same id (D-031, V-55).
// Directus reads any value that starts with $NOW as one, and compares a date in ISO 8601 as it compares the instant of a
// $NOW (V-182). The other variables stay, for whoever asks each part.
export const pinnedNow = (filter: Record<string, unknown>, registeredAt: number): Record<string, unknown> => {
	const base = new Date(Math.floor(registeredAt / minute) * minute);

	const pinned = (inner: unknown): unknown => {
		if (typeof inner === 'string') {
			return inner.startsWith('$NOW') ? instantOf(inner, base).toISOString() : inner;
		}

		if (Array.isArray(inner)) {
			return inner.map(pinned);
		}

		return typeof inner === 'object' && inner !== null
			? Object.fromEntries(Object.entries(inner).map(([key, entry]) => [key, pinned(entry)]))
			: inner;
	};

	return Object.fromEntries(Object.entries(filter).map(([key, entry]) => [key, pinned(entry)]));
};
