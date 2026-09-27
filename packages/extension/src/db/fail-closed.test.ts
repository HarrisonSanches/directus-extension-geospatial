import { DatabaseSync } from 'node:sqlite';
import { ForbiddenError, isDirectusError } from '@directus/errors';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { failClosed } from './fail-closed.js';

// A real SQLite, the one inside Node, closed before the query, the way a database that went down answers.
const closedDatabase = () => {
	const database = new DatabaseSync(':memory:');

	database.close();

	return () => Promise.resolve(database.prepare('select 1').all());
};

// A real logger, which writes each entry as JSON into the list.
const recordingLogger = () => {
	const entries: Record<string, unknown>[] = [];
	const logger = pino(
		{ base: null, timestamp: false },
		{ write: (line: string) => entries.push(JSON.parse(line) as Record<string, unknown>) },
	);

	return { entries, logger };
};

describe('leitura do banco que falha fechado', () => {
	it('com o banco de pé, devolve o que a leitura devolveu', async () => {
		const database = new DatabaseSync(':memory:');
		const { logger } = recordingLogger();

		expect(await failClosed(() => Promise.resolve(database.prepare('select 1 as one').all()), logger)).toEqual([
			{ one: 1 },
		]);
	});

	it('com o banco fora, lança o erro próprio, com o status 503 e a mensagem sem a causa', async () => {
		const { logger } = recordingLogger();
		const error: unknown = await failClosed(closedDatabase(), logger).catch((reason: unknown) => reason);

		expect(isDirectusError(error, 'GEOSPATIAL_DATABASE_UNAVAILABLE')).toBe(true);
		expect(error).toMatchObject({ status: 503, message: 'The database did not answer. Try again later.' });
	});

	it('com o banco fora, registra a causa no log, para o admin', async () => {
		const { entries, logger } = recordingLogger();

		await failClosed(closedDatabase(), logger).catch(() => undefined);

		expect(entries).toMatchObject([
			{ level: 50, msg: 'The database did not answer', err: { message: 'database is not open' } },
		]);
	});

	it('um erro do Directus passa como veio, porque já sai no formato dele', async () => {
		const { entries, logger } = recordingLogger();
		const forbidden = new ForbiddenError();

		await expect(failClosed(() => Promise.reject(forbidden), logger)).rejects.toBe(forbidden);
		expect(entries).toEqual([]);
	});
});
