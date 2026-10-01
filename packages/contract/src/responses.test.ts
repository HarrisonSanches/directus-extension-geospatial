import { describe, expect, it } from 'vitest';
import { contractOf } from './responses.js';
import { apiVersion, openapi, type OpenApiDocument } from './index.js';

const { errorsOf } = contractOf(openapi);

const json = 'application/json; charset=utf-8';

const capabilities = {
	api: { version: apiVersion },
	extension: { version: '0.1.0' },
	directus: { version: '12.4.1' },
	operations: {},
};

const capabilitiesWith = (status: number, body: unknown, contentType: string | null = json) =>
	errorsOf({ method: 'GET', path: '/geospatial/capabilities', status, contentType, body });

describe('as respostas conferidas contra o contrato', () => {
	it('uma resposta no schema da rota e do status passa', () => {
		expect(capabilitiesWith(200, { data: capabilities })).toEqual([]);
	});

	it('uma resposta fora do schema reprova, com o lugar e o motivo', () => {
		const withoutApi = { extension: capabilities.extension, directus: capabilities.directus, operations: {} };

		expect(capabilitiesWith(200, { data: withoutApi })).toEqual([
			"The response 200 of GET /geospatial/capabilities is off the contract at /data: must have required property 'api'.",
		]);
	});

	it('o erro no formato do Directus passa no status que o contrato declara', () => {
		const forbidden = { errors: [{ message: 'You do not have permission.', extensions: { code: 'FORBIDDEN' } }] };

		expect(capabilitiesWith(403, forbidden)).toEqual([]);
	});

	it('um status que o contrato não declara para a rota reprova', () => {
		expect(capabilitiesWith(404, {})).toEqual(['The contract has no response 404 for GET /geospatial/capabilities.']);
	});

	it('uma rota fora do contrato reprova', () => {
		expect(errorsOf({ method: 'GET', path: '/geospatial/unknown', status: 200, contentType: json, body: {} })).toEqual([
			'The contract has no route for GET /geospatial/unknown.',
		]);
		expect(
			errorsOf({ method: 'POST', path: '/geospatial/capabilities', status: 200, contentType: json, body: {} }),
		).toEqual(['The contract has no response 200 for POST /geospatial/capabilities.']);
	});

	it('um corpo de um tipo que o contrato não declara reprova', () => {
		expect(capabilitiesWith(200, '<html></html>', 'text/html; charset=utf-8')).toEqual([
			'The response 200 of GET /geospatial/capabilities came as text/html, which the contract does not declare.',
		]);
		expect(capabilitiesWith(200, '', null)).toEqual([
			'The response 200 of GET /geospatial/capabilities came as no type, which the contract does not declare.',
		]);
	});

	it('o próprio documento, servido pela rota dele, está no contrato', () => {
		expect(
			errorsOf({ method: 'GET', path: '/geospatial/openapi.json', status: 200, contentType: json, body: openapi }),
		).toEqual([]);
	});
});

// A document with the shapes the contract of the extension does not have yet: a response with no body, one that is
// not JSON, and a path with a parameter.
const example: OpenApiDocument = {
	openapi: '3.1.0',
	info: { title: 'Example', version: '1.0.0' },
	paths: {
		'/geospatial/queries/{id}': {
			delete: { responses: { '204': { description: 'Forgotten.' } } },
			get: {
				responses: {
					'200': {
						description: 'A vector tile.',
						content: { 'application/vnd.mapbox-vector-tile': { schema: { type: 'string' } } },
					},
				},
			},
		},
	},
};

describe('as formas de resposta que as próximas rotas trazem', () => {
	const { errorsOf: errorsOfExample } = contractOf(example);

	it('a resposta sem corpo passa vazia, e com corpo reprova', () => {
		const forgotten = { method: 'DELETE', path: '/geospatial/queries/abc', status: 204, contentType: null };

		expect(errorsOfExample({ ...forgotten, body: '' })).toEqual([]);
		expect(errorsOfExample({ ...forgotten, body: 'gone' })).toEqual([
			'The response 204 of DELETE /geospatial/queries/abc has a body, and the contract declares none.',
		]);
	});

	it('um corpo que não é JSON passa pelo tipo, sem o schema', () => {
		expect(
			errorsOfExample({
				method: 'GET',
				path: '/geospatial/queries/abc',
				status: 200,
				contentType: 'application/vnd.mapbox-vector-tile',
				body: '\u001a\u0002',
			}),
		).toEqual([]);
	});
});
