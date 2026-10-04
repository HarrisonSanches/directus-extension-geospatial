import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Geo } from 'directus-geospatial-contract';
import type { Key } from '../db/adapter.js';
import { InvalidInputError } from '../errors.js';
import { canonicalOf } from './id.js';

// The list a cursor belongs to: the collection, the operation and the order of the page.
export interface List {
	collection: string;
	geo: Geo;
	sort: string[];
}

// How a cursor is laid out: its version, the nonce of AES-GCM, the values sealed, and the tag that authenticates them.
const version = 1;
const nonce = 12;
const tag = 16;

const associatedOf = (list: List) => Buffer.from(canonicalOf(list));

const isKey = (value: unknown): value is Key =>
	value === null || typeof value === 'string' || typeof value === 'number';

// The cursor of the page after an item: the values of the order of that item, in JSON, sealed by AES-256-GCM with the
// key of the cursors (key.ts), and the list as the associated data, which the tag authenticates without carrying it
// (D-054). Nobody reads what it holds, as the value of a field the page sorts by, which a URL would take to the logs,
// nor changes it, nor takes it to another list.
export const cursorOf = (key: Buffer, list: List, values: Key[]): string => {
	const iv = randomBytes(nonce);
	const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(associatedOf(list));
	const sealed = Buffer.concat([cipher.update(JSON.stringify(values)), cipher.final()]);

	return Buffer.concat([Buffer.from([version]), iv, sealed, cipher.getAuthTag()]).toString('base64url');
};

// The values of the order of the last item of the page before, out of its cursor. A cursor changed, of another list or
// of another installation is refused before anything reaches the database.
export const afterOf = (key: Buffer, list: List, cursor: string): Key[] => {
	const bytes = Buffer.from(cursor, 'base64url');
	const refused = new InvalidInputError({ reason: 'The cursor is not one this list gave' });

	if (bytes.length < 1 + nonce + tag || bytes[0] !== version) {
		throw refused;
	}

	let values: unknown;

	try {
		const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 1 + nonce)).setAAD(associatedOf(list));

		decipher.setAuthTag(bytes.subarray(bytes.length - tag));
		values = JSON.parse(
			Buffer.concat([decipher.update(bytes.subarray(1 + nonce, bytes.length - tag)), decipher.final()]).toString(),
		);
	} catch {
		throw refused;
	}

	if (!Array.isArray(values) || !values.every(isKey)) {
		throw refused;
	}

	return values;
};
