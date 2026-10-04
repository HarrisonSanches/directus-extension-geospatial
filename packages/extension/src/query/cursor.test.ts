import { createCipheriv, randomBytes } from 'node:crypto';
import { fc, test } from '@fast-check/vitest';
import type { Radius } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import type { Key } from '../db/adapter.js';
import { afterOf, cursorOf, type List } from './cursor.js';
import { canonicalOf } from './id.js';
import { keyOf } from './key.js';

const key = keyOf('a secret of Directus', 'cursor');
const geo: Radius = { operation: 'radius', center: [-46.7, -23.65], distance: 1000 };
const list: List = { collection: 'occurrences', geo, sort: ['-status'] };

// A read of a cursor that fails with the error of input, before anything reaches the database.
const expectRefused = (read: () => unknown) => {
	expect(read).toThrow(
		expect.objectContaining({
			code: 'GEOSPATIAL_INVALID_INPUT',
			status: 400,
			extensions: { reason: 'The cursor is not one this list gave' },
		}),
	);
};

// A cursor in the format of cursor.ts, sealed with the right key for the list, around any text: what only a bug of the
// extension itself would hand over.
const sealedAround = (text: string) => {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(canonicalOf(list)));
	const sealed = Buffer.concat([cipher.update(text), cipher.final()]);

	return Buffer.concat([Buffer.from([1]), iv, sealed, cipher.getAuthTag()]).toString('base64url');
};

// The values of the order an item can have: a text, as Postgres writes it, a number or an empty value. JSON writes -0
// as 0, and no key of an order is -0.
const keys = fc.array(
	fc.oneof(
		fc.string({ unit: 'binary' }),
		fc.double({ noNaN: true, noDefaultInfinity: true }).filter((value) => !Object.is(value, -0)),
		fc.constant(null),
	),
	{ maxLength: 6 },
);

describe('o cursor', () => {
	it('devolve os valores da ordem do último item, como saíram, em base64url', () => {
		const values: Key[] = ['closed', null, 12.5, '2026-09-01 10:00:00.123456+00', 42];
		const cursor = cursorOf(key, list, values);

		expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(afterOf(key, list, cursor)).toEqual(values);
	});

	it('é cifrado: ninguém lê o valor de dentro, e o mesmo valor dá outro cursor a cada vez', () => {
		const cursor = cursorOf(key, list, ['ABC1D23']);

		expect(Buffer.from(cursor, 'base64url').toString('latin1')).not.toContain('ABC1D23');
		expect(cursorOf(key, list, ['ABC1D23'])).not.toBe(cursor);
	});

	it.each([
		['de outra coleção', { ...list, collection: 'hooked_occurrences' }],
		['de outro raio', { ...list, geo: { ...geo, distance: 2000 } }],
		['de outra ordem', { ...list, sort: ['status'] }],
		['da ordem natural', { ...list, sort: [] }],
	])('um cursor %s volta com o erro de entrada', (_, other) => {
		expectRefused(() => afterOf(key, other, cursorOf(key, list, ['open', 1])));
	});

	it('um cursor de outra instalação, com outro SECRET, volta com o erro de entrada', () => {
		expectRefused(() => afterOf(keyOf('another secret', 'cursor'), list, cursorOf(key, list, [1])));
	});

	it.each([
		['vazio', ''],
		['curto demais', 'AQID'],
		['que não é base64url', 'not a cursor at all, with spaces and more than enough characters'],
		['de outra versão', Buffer.from([2, ...randomBytes(40)]).toString('base64url')],
		['sem o fim', cursorOf(key, list, [1]).slice(0, -4)],
	])('um cursor %s volta com o erro de entrada', (_, cursor) => {
		expectRefused(() => afterOf(key, list, cursor));
	});

	it.each([
		['um objeto', '{"status":"open"}'],
		['uma lista com um objeto', '[{"status":"open"}]'],
		['um texto que não é JSON', 'open'],
	])('mesmo selado com a chave, um cursor com %s dentro volta com o erro de entrada', (_, text) => {
		expectRefused(() => afterOf(key, list, sealedAround(text)));
	});

	test.prop([keys])('devolve qualquer lista de valores como ela entrou', (values) => {
		expect(afterOf(key, list, cursorOf(key, list, values))).toEqual(values);
	});

	test.prop([keys, fc.nat(), fc.integer({ min: 1, max: 255 })])(
		'um cursor com qualquer byte mudado volta com o erro de entrada',
		(values, at, change) => {
			const bytes = Buffer.from(cursorOf(key, list, values), 'base64url');
			const position = at % bytes.length;

			bytes[position] = (bytes[position] ?? 0) ^ change;

			expectRefused(() => afterOf(key, list, bytes.toString('base64url')));
		},
	);
});
