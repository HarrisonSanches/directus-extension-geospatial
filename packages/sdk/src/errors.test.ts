import type { ErrorCode } from 'directus-geospatial-contract';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { isGeospatialError } from './errors.js';
import { fakeClient } from './fake-fetch.js';

// The error a request of the SDK rejects with, when the route answers with the error of a code.
const rejectionOf = async (code: string): Promise<unknown> => {
	const { client } = fakeClient({ status: 400, body: { errors: [{ message: 'Off.', extensions: { code } }] } });

	return client.request(() => ({ path: '/geospatial/items/occurrences' })).catch((error: unknown) => error);
};

describe('isGeospatialError()', () => {
	it('sem código, reconhece um erro da extensão pelo prefixo GEOSPATIAL_ (D-045), com o código tipado', async () => {
		const error = await rejectionOf('GEOSPATIAL_INVALID_INPUT');

		expect(isGeospatialError(error)).toBe(true);
		expect(isGeospatialError(await rejectionOf('FORBIDDEN'))).toBe(false);

		if (isGeospatialError(error)) {
			expectTypeOf(error.errors[0].extensions.code).toEqualTypeOf<ErrorCode>();
			expect(error.errors[0].extensions.code).toBe('GEOSPATIAL_INVALID_INPUT');
		}
	});

	it('com um código, da extensão ou do Directus, reconhece o erro desse código, e o tipo fica nele', async () => {
		const error = await rejectionOf('GEOSPATIAL_LIMIT_EXCEEDED');

		expect(isGeospatialError(error, 'GEOSPATIAL_LIMIT_EXCEEDED')).toBe(true);
		expect(isGeospatialError(error, 'GEOSPATIAL_INVALID_INPUT')).toBe(false);
		expect(isGeospatialError(await rejectionOf('INVALID_QUERY'), 'INVALID_QUERY')).toBe(true);

		if (isGeospatialError(error, 'GEOSPATIAL_LIMIT_EXCEEDED')) {
			expectTypeOf(error.errors[0].extensions.code).toEqualTypeOf<'GEOSPATIAL_LIMIT_EXCEEDED'>();
		}
	});

	it('o que não é um erro no formato do Directus não é um erro da extensão', () => {
		for (const thrown of [new Error('Network down.'), 'text', undefined, null, { errors: 'off' }, { errors: [] }]) {
			expect(isGeospatialError(thrown)).toBe(false);
			expect(isGeospatialError(thrown, 'FORBIDDEN')).toBe(false);
		}
	});
});
