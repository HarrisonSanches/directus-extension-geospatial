import { type Internals, openapi } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import { radiusLevels } from '../operations/radius/levels.js';
import { capabilityOf, matrixOf } from './matrix.js';

const accepted: Internals = { status: 'accepted', adapter: '12' };
const refused: Internals = { status: 'refused', problems: { '12': ['missing'], '11.17': ['missing'] } };
const postgis = { name: 'postgis', version: '3.6.4' } as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The database clients the contract lists, read from the document, as the capabilities route reports them.
const clientsOfContract = () => {
	const { components } = openapi as { components?: unknown };
	const schemas = isRecord(components) ? components.schemas : undefined;
	const database = isRecord(schemas) ? schemas.Database : undefined;
	const properties = isRecord(database) ? database.properties : undefined;
	const client = isRecord(properties) ? properties.client : undefined;

	const values: unknown = isRecord(client) ? client.enum : undefined;

	return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
};

describe('a matriz de capacidades', () => {
	it('o raio roda no PostGIS sem o índice, enquanto o envelope lê o texto da query permitida (A-023)', () => {
		expect(matrixOf({ client: 'postgres', spatial: postgis, internals: accepted })).toEqual({
			radius: { level: 'indexed' },
		});
	});

	it.each(['sqlite', 'mysql', 'mssql', 'oracle', 'cockroachdb', 'redshift', 'unknown'] as const)(
		'o raio fica indisponível no banco %s, com um motivo que não diz o banco',
		(client) => {
			const { radius } = matrixOf({ client, spatial: postgis, internals: accepted });

			expect(radius).toEqual({ level: 'unavailable', reason: 'It does not run on the database in use yet.' });
		},
	);

	it('com os internos recusados, nenhuma operação roda', () => {
		expect(matrixOf({ client: 'postgres', spatial: postgis, internals: refused })).toEqual({
			radius: {
				level: 'unavailable',
				reason: 'The internals of this Directus are not the ones the extension expects.',
			},
		});
	});

	it('sem a extensão espacial no banco, nenhuma operação roda', () => {
		expect(matrixOf({ client: 'postgres', spatial: null, internals: accepted })).toEqual({
			radius: { level: 'unavailable', reason: 'The database in use has no spatial extension.' },
		});
	});

	it('a rota lê o nível pelo banco e pelos internos, sem a extensão espacial', () => {
		expect(capabilityOf('radius', { client: 'postgres', internals: accepted })).toEqual({ level: 'indexed' });
		expect(capabilityOf('radius', { client: 'postgres', internals: refused }).level).toBe('unavailable');
	});

	it('o raio declara um nível para cada banco que o contrato lista, e só para eles', () => {
		expect(Object.keys(radiusLevels).sort()).toEqual([...clientsOfContract()].sort());
	});
});
