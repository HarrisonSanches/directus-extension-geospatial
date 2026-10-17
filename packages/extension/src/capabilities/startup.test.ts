import { DatabaseSync } from 'node:sqlite';
import knex from 'knex';
import { afterAll, describe, expect, it } from 'vitest';
import type { Query } from '../db/versions.js';
import { detectOnStartup } from './startup.js';

// Knex creates the client without a driver or a connection: the detection reads the database by its query.
const database = knex({ client: 'sqlite3', useNullAsDefault: true });

afterAll(() => database.destroy());

// A real SQLite, the one inside Node, without SpatiaLite, as the official image of Directus brings it (V-104). Each
// statement the detection sends goes to sent, and while down is true, the database does not answer.
const sqlite = () => {
	const connection = new DatabaseSync(':memory:');
	const sent: string[] = [];
	const state = { down: false };
	const query: Query = (sql) => {
		sent.push(sql);

		return state.down
			? Promise.reject(new Error('SQLITE_CANTOPEN: unable to open database file'))
			: Promise.resolve(connection.prepare(sql).all());
	};

	return { query, sent, state };
};

const startWith = (query: Query) => {
	const logs: [string, ...unknown[]][] = [];
	const detected = detectOnStartup({
		database,
		logger: {
			info: (...args: unknown[]) => logs.push(['info', ...args]),
			error: (...args: unknown[]) => logs.push(['error', ...args]),
		},
		query,
	});

	return { detected, logs };
};

const expected = { client: 'sqlite', databaseVersion: process.versions.sqlite, spatialVersion: null };

describe('a detecção do banco ao subir', () => {
	it('detecta ao subir, antes de qualquer pedido, e o log diz o que achou', async () => {
		const { query, sent } = sqlite();
		const { logs } = startWith(query);

		await expect.poll(() => logs).toEqual([['info', expected, 'Detected the database of Directus']]);
		expect(sent).not.toEqual([]);
	});

	it('detecta uma vez para o processo, e cada leitura recebe o mesmo', async () => {
		const { query, sent } = sqlite();
		const { detected } = startWith(query);

		expect(await detected()).toEqual(expected);

		const once = [...sent];

		expect(await detected()).toEqual(expected);
		expect(sent).toEqual(once);
	});

	it('com o banco fora, a leitura falha fechada, a causa vai só para o log, e a próxima detecta de novo', async () => {
		const { query, state } = sqlite();

		state.down = true;

		const { detected, logs } = startWith(query);

		await expect
			.poll(() => logs)
			.toContainEqual([
				'error',
				new Error('SQLITE_CANTOPEN: unable to open database file'),
				'The database did not answer',
			]);
		await expect(detected()).rejects.toMatchObject({
			code: 'GEOSPATIAL_DATABASE_UNAVAILABLE',
			message: 'The database did not answer. Try again later.',
		});

		state.down = false;

		expect(await detected()).toEqual(expected);
	});
});
