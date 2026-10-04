import { createHmac } from 'node:crypto';
import type { RegisteredQuery } from 'directus-geospatial-contract';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

// The order of the UTF-16 code units, which < compares, and not the order of a language, which localeCompare follows.
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : Number(a > b));

// A JSON value in its canonical form, by the JSON Canonicalization Scheme (RFC 8785): the keys of each object in the
// order of their UTF-16 code units, no whitespace, and the numbers and the strings as JSON.stringify writes them. The
// same value gives the same text, with its keys in any order.
export const canonicalOf = (value: unknown): string => {
	if (Array.isArray(value)) {
		return `[${value.map(canonicalOf).join(',')}]`;
	}

	if (isRecord(value)) {
		const entries = Object.keys(value)
			.sort(byCodeUnits)
			.map((name) => `${JSON.stringify(name)}:${canonicalOf(value[name])}`);

		return `{${entries.join(',')}}`;
	}

	return JSON.stringify(value);
};

// The id of a registered query: the HMAC-SHA-256 of its question in the canonical form, cut to 128 bits, in base64url,
// with the key of the ids (key.ts, D-004, D-053). The same question gets the same id, and only an installation that holds the key tells the id of a
// question, so nobody learns by the id whether someone registered a question they guess.
export const idOf = (key: Buffer, question: RegisteredQuery): string =>
	createHmac('sha256', key).update(canonicalOf(question)).digest().subarray(0, 16).toString('base64url');
