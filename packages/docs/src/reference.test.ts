import { openapi } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import { isReferenceLink, operationIdsOf, referenceConfiguration, referencePath } from './reference.ts';

// Every operationId of the contract, read from its text, apart from how reference.ts walks the paths.
const operationIds = [...JSON.stringify(openapi).matchAll(/"operationId":"(\w+)"/g)].flatMap(([, id]) =>
	id === undefined ? [] : [id],
);

const linkTo = (link: string) => isReferenceLink({ link });

describe('isReferenceLink()', () => {
	it('aceita a página da referência e a âncora de cada operação do contrato, com o SEARCH do additionalOperations', () => {
		expect(operationIds).toContain('searchItems');
		expect(operationIds.length).toBeGreaterThan(1);
		expect(linkTo(referencePath)).toBe(true);
		expect(operationIds.filter((id) => !linkTo(`/api/#geospatial/${id}`))).toEqual([]);
	});

	it('recusa a âncora de uma operação que o contrato não tem, de outro documento ou sem a operação', () => {
		expect(linkTo('/api/#geospatial/itemz')).toBe(false);
		expect(linkTo('/api/#geospatial/')).toBe(false);
		expect(linkTo('/api/#other/items')).toBe(false);
		expect(linkTo('/api/#items')).toBe(false);
	});

	it('deixa qualquer outro link ao validador do site', () => {
		expect(linkTo('/guides/radius/')).toBe(false);
		expect(linkTo('/api')).toBe(false);
		expect(linkTo('/api/items/')).toBe(false);
	});
});

describe('operationIdsOf()', () => {
	it('lê o operationId de cada método e do additionalOperations, e ignora os outros campos de um caminho', () => {
		const paths = {
			'/items': {
				summary: 'The items',
				parameters: [{ name: 'collection', in: 'path' }],
				get: { operationId: 'items' },
				additionalOperations: { SEARCH: { operationId: 'searchItems' } },
			},
			'/queries': { post: { operationId: 'registerQuery' }, put: { summary: 'Without an id' } },
			'/broken': 'not a path item',
			'/odd': { additionalOperations: 'not a map of operations', delete: { operationId: 42 } },
		};

		expect(operationIdsOf(paths)).toEqual(new Set(['items', 'searchItems', 'registerQuery']));
	});
});

describe('referenceConfiguration', () => {
	it('entrega ao Scalar o contrato que o build embute, sem buscar nada para montar a página', () => {
		expect(referenceConfiguration.content).toBe(openapi);
		expect(referenceConfiguration).not.toHaveProperty('url');
	});

	it('desliga tudo o que fala com um host fora do site (V-194)', () => {
		expect(referenceConfiguration).toMatchObject({
			withDefaultFonts: false,
			agent: { disabled: true },
			mcp: { disabled: true },
			telemetry: false,
			proxyUrl: '',
			hideClientButton: true,
		});
	});

	it('dá à âncora de cada operação o operationId, e à de uma operação sem ele, o método e o caminho', () => {
		const { generateOperationSlug } = referenceConfiguration;

		expect(generateOperationSlug({ operationId: 'items', method: 'get', path: '/geospatial/items/{collection}' })).toBe(
			'items',
		);
		expect(generateOperationSlug({ method: 'get', path: '/geospatial/items' })).toBe('get/geospatial/items');
	});
});
