import { InvalidQueryError } from '@directus/errors';
import type { Query } from '@directus/types';
import type { RegisteredQuery } from 'directus-geospatial-contract';
import { describe, expect, it, vi } from 'vitest';
import { idOf } from './id.js';
import { keyOf } from './key.js';
import { pageOfPart, questionOf, register } from './register.js';
import { memoryRegistry } from './registry.js';

const question: RegisteredQuery = {
	collection: 'occurrences',
	geo: { operation: 'radius', center: [-46.7, -23.65], distance: 1000 },
	query: { filter: { occurred_at: { _lte: '$NOW' } }, search: 'car' },
};

const key = keyOf('a secret of Directus', 'registered query id');

// A registration on a clock the test moves, with the query read as Directus reads it.
const registrationAt = (now: number) => {
	const registry = memoryRegistry({ retention: 24 * 60 * 60 * 1000, bytes: 1024 * 1024, now: () => now });
	const read = vi.fn((raw: Record<string, unknown>) => Promise.resolve(raw));

	return { registry, read, options: { registry, key, now: () => now, read } };
};

const registeredAt = Date.UTC(2026, 9, 3, 14, 37, 42);

describe('o registro de uma pergunta', () => {
	it('guarda a pergunta com o $NOW no minuto do registro, sob o id dela', async () => {
		const { registry, options } = registrationAt(registeredAt);
		const pinned = {
			...question,
			query: { ...question.query, filter: { occurred_at: { _lte: '2026-10-03T14:37:00.000Z' } } },
		};

		const id = await register(question, options);

		expect(id).toBe(idOf(key, pinned));
		expect(await registry.get(id)).toEqual(pinned);
	});

	it('dois registros da mesma pergunta no mesmo minuto dão o mesmo id, e no minuto seguinte, outro', async () => {
		const first = await register(question, registrationAt(registeredAt).options);

		expect(await register(question, registrationAt(registeredAt + 17_000).options)).toBe(first);
		expect(await register(question, registrationAt(registeredAt + 60_000).options)).not.toBe(first);
	});

	it('a query passa antes pelo Directus, e o que ele recusa não ganha id', async () => {
		const { registry, read, options } = registrationAt(registeredAt);

		read.mockRejectedValueOnce(new InvalidQueryError({ reason: 'Invalid filter' }));

		await expect(register(question, options)).rejects.toMatchObject({ code: 'INVALID_QUERY' });
		expect(read).toHaveBeenCalledWith({ filter: { occurred_at: { _lte: '2026-10-03T14:37:00.000Z' } }, search: 'car' });
		expect(await registry.get(idOf(key, question))).toBeUndefined();
	});

	it('sem a query, ou sem o filtro, a pergunta vai como veio', async () => {
		const { registry, read, options } = registrationAt(registeredAt);
		const withoutQuery = { collection: question.collection, geo: question.geo };
		const withoutFilter = { ...question, query: { search: 'car' } };

		expect(await registry.get(await register(withoutQuery, options))).toEqual(withoutQuery);
		expect(await registry.get(await register(withoutFilter, options))).toEqual(withoutFilter);
		expect(read).toHaveBeenCalledOnce();
	});
});

describe('a pergunta de um id', () => {
	it('vem do registro, e um id que ele não conhece volta com o código de consulta desconhecida', async () => {
		const { registry, options } = registrationAt(registeredAt);
		const id = await register(question, options);

		expect(await questionOf(registry, id)).toMatchObject({ collection: 'occurrences' });
		await expect(questionOf(registry, 'AbCdEfGhIjKlMnOpQr_-09')).rejects.toMatchObject({
			code: 'GEOSPATIAL_UNKNOWN_QUERY',
			status: 404,
		});
	});
});

describe('a página de uma parte', () => {
	// The query of the registration, as Directus reads it for whoever asks: here, with the fields as a list.
	const read = (raw: Record<string, unknown>) => Promise.resolve<Query>({ ...raw, fields: ['*'] });

	it('é a query da pergunta, lida para quem pede, com o limit e o sort da URL', async () => {
		const url = {
			page: { fields: ['*'], limit: 10, sort: ['-occurred_at'] },
			raw: { limit: '10', sort: '-occurred_at' },
		};

		expect(await pageOfPart(question, url, read)).toEqual({
			filter: { occurred_at: { _lte: '$NOW' } },
			search: 'car',
			fields: ['*'],
			limit: 10,
			sort: ['-occurred_at'],
		});
	});

	it('sem o limit e o sort na URL, nem a query na pergunta, fica o que o Directus lê de uma query vazia', async () => {
		const withoutQuery = { collection: question.collection, geo: question.geo };

		expect(await pageOfPart(withoutQuery, { page: { fields: ['*'] }, raw: {} }, read)).toEqual({ fields: ['*'] });
	});

	it.each([
		['o filter', { fields: ['*'], filter: { status: { _eq: 'open' } } }, { filter: '{}' }],
		['a search', { fields: ['*'], search: 'car' }, { search: 'car' }],
		['os fields', { fields: ['id'] }, { fields: 'id' }],
		['o offset', { fields: ['*'], offset: 10 }, { offset: '10' }],
		['o page', { fields: ['*'], page: 2 }, { page: '2' }],
		['o aggregate', { fields: ['*'], aggregate: { count: ['*'] } }, { aggregate: '{"count":["*"]}' }],
	] satisfies [string, Query, Record<string, unknown>][])(
		'com %s na URL, volta com o INVALID_QUERY, porque o resto da query vai no registro',
		async (_, page, raw) => {
			await expect(pageOfPart(question, { page, raw }, read)).rejects.toMatchObject({
				code: 'INVALID_QUERY',
				extensions: {
					reason:
						'The URL of a part takes only the limit and the sort, and the rest of the query goes in its registration',
				},
			});
		},
	);
});
