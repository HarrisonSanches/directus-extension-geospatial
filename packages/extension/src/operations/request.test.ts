import type { Query, SchemaOverview } from '@directus/types';
import { describe, expect, it } from 'vitest';
import { accountabilityOf, geometryFieldOf, geoOf, limitOf, sortOf, unsupportedIn } from './request.js';

const radius = { operation: 'radius', center: [-46.7, -23.65], distance: 1000 };

describe('o geo do pedido', () => {
	it('vem em JSON, como o filter do Directus, e sai com o tipo do contrato', () => {
		expect(geoOf(JSON.stringify(radius))).toEqual(radius);
	});

	it.each([
		['sem o geo', undefined, 'The geo parameter is required'],
		['com o geo nos colchetes da URL, e não em JSON', { operation: 'radius' }, 'The geo parameter goes as JSON'],
		['com um JSON quebrado', '{"operation":', 'The geo parameter is not valid JSON'],
	])('%s, o pedido volta com o erro de query do Directus', (_, raw, reason) => {
		expect(() => geoOf(raw)).toThrow(expect.objectContaining({ code: 'INVALID_QUERY', extensions: { reason } }));
	});

	it('fora do contrato, o erro diz onde e por quê', () => {
		expect(() => geoOf(JSON.stringify({ ...radius, distance: -1 }))).toThrow(
			expect.objectContaining({
				code: 'INVALID_QUERY',
				extensions: { reason: expect.stringContaining('/distance must be > 0') as string },
			}),
		);
	});

	it('o SRID não vem no pedido: o motor o lê da coluna (D-007)', () => {
		expect(() => geoOf(JSON.stringify({ ...radius, srid: 31983 }))).toThrow(
			expect.objectContaining({
				code: 'INVALID_QUERY',
				extensions: { reason: expect.stringContaining('must NOT have additional properties') as string },
			}),
		);
	});
});

describe('a página que o raio ainda não trata', () => {
	it('o que o raio trata passa', () => {
		const page: Query = { fields: ['*'], filter: { region: { _eq: 'south' } }, search: 'x', limit: 10, offset: 5 };

		expect(unsupportedIn(page)).toBeUndefined();
		expect(unsupportedIn({ ...page, page: 2 })).toBeUndefined();
	});

	it.each([
		['a agregação', { aggregate: { count: ['*'] } }, 'aggregate'],
		['o agrupamento', { group: ['region'] }, 'group'],
		['o deep das relações', { deep: { author: { _limit: 1 } } }, 'deep'],
		['a versão de conteúdo', { version: 'draft' }, 'version'],
		['a exportação', { export: 'csv' as const }, 'export'],
	])('%s volta recusada, e não fica de fora calada', (_, page, parameter) => {
		expect(unsupportedIn({ fields: ['*'], ...page })).toBe(parameter);
	});

	it('um campo de uma relação também volta recusado', () => {
		expect(unsupportedIn({ fields: ['id', 'author.name'] })).toBe('fields of a relation');
	});

	it('a ordem por campos da coleção passa, e a por uma relação ou uma função volta recusada', () => {
		expect(unsupportedIn({ sort: ['status', '-occurred_at'] })).toBeUndefined();
		expect(unsupportedIn({ sort: ['-author.name'] })).toBe('sort by a relation');
		expect(unsupportedIn({ sort: ['year(occurred_at)'] })).toBe('sort by a function');
	});
});

describe('a ordem da página', () => {
	it('sem sort, a lista segue a ordem natural da operação', () => {
		expect(sortOf({})).toEqual([]);
	});

	it('cada campo do sort, com o menos na frente para a ordem decrescente, como no /items', () => {
		expect(sortOf({ sort: ['status', '-occurred_at'] })).toEqual([
			{ field: 'status', direction: 'asc' },
			{ field: 'occurred_at', direction: 'desc' },
		]);
	});
});

describe('o tamanho da página', () => {
	it('sem o limit, vale a página padrão do Directus', () => {
		expect(limitOf({}, 100)).toBe(100);
	});

	it('a página padrão nunca passa do máximo do contrato', () => {
		expect(limitOf({}, 5000)).toBe(1000);
	});

	it('o limit dentro do contrato vale como veio', () => {
		expect(limitOf({ limit: 1000 }, 100)).toBe(1000);
	});

	it.each([
		['acima do máximo', 1001, 'must be <= 1000'],
		['o -1, que no /items traz todos', -1, 'must be >= 1'],
		['o zero', 0, 'must be >= 1'],
	])('o limit %s volta com o erro de query do Directus, com o motivo', (_, limit, reason) => {
		expect(() => limitOf({ limit }, 100)).toThrow(
			expect.objectContaining({
				code: 'INVALID_QUERY',
				extensions: { reason: expect.stringContaining(reason) as string },
			}),
		);
	});
});

const schemaWith = (fields: Record<string, string>): SchemaOverview =>
	({
		collections: {
			occurrences: {
				collection: 'occurrences',
				primary: 'id',
				fields: Object.fromEntries(Object.entries(fields).map(([field, type]) => [field, { field, type }])),
			},
		},
		relations: [],
	}) as unknown as SchemaOverview;

describe('o campo de geometria do raio', () => {
	it('sem o field, vale o único campo de geometria da coleção, de qualquer subtipo', () => {
		expect(
			geometryFieldOf(schemaWith({ id: 'integer', geometry: 'geometry.Point' }), 'occurrences', undefined),
		).toEqual({
			field: 'geometry',
		});
		expect(geometryFieldOf(schemaWith({ id: 'integer', area: 'geometry' }), 'occurrences', undefined)).toEqual({
			field: 'area',
		});
	});

	it('sem o field, a coleção sem geometria e a com duas pedem que o pedido diga qual', () => {
		expect(geometryFieldOf(schemaWith({ id: 'integer' }), 'occurrences', undefined)).toEqual({
			problem: 'The collection occurrences has no geometry field',
		});
		expect(
			geometryFieldOf(schemaWith({ place: 'geometry.Point', area: 'geometry.Polygon' }), 'occurrences', undefined),
		).toEqual({ problem: 'The collection occurrences has 2 geometry fields, so the geo names one in field' });
	});

	it('com o field, vale o campo de geometria pedido', () => {
		const schema = schemaWith({ place: 'geometry.Point', area: 'geometry.Polygon' });

		expect(geometryFieldOf(schema, 'occurrences', 'area')).toEqual({ field: 'area' });
	});

	it('com o field num campo que não é de geometria, o pedido volta recusado', () => {
		expect(geometryFieldOf(schemaWith({ id: 'integer' }), 'occurrences', 'id')).toEqual({
			problem: 'The field id of occurrences is not a geometry',
		});
	});

	it('com o field num campo que o esquema não tem, a cadeia do Directus decide, como no /items', () => {
		expect(geometryFieldOf(schemaWith({ id: 'integer' }), 'occurrences', 'nowhere')).toEqual({ field: 'nowhere' });
	});
});

describe('quem pede', () => {
	it('o pedido sem accountability é recusado, e nunca lido como o Directus lendo para si mesmo, sem permissão', () => {
		expect(() => accountabilityOf(undefined)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
	});

	it('a accountability do público passa como veio, e as permissões dele decidem', () => {
		const anonymous = { role: null, roles: [], user: null, admin: false, app: false, ip: '127.0.0.1' };

		expect(accountabilityOf(anonymous)).toBe(anonymous);
	});
});
