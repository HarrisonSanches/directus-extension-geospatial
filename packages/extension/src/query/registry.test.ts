import type { RegisteredQuery } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import { memoryRegistry } from './registry.js';

const hour = 60 * 60 * 1000;

const questionOf = (search: string): RegisteredQuery => ({
	collection: 'occurrences',
	geo: { operation: 'radius', center: [-46.7, -23.65], distance: 1000 },
	query: { search },
});

// The bytes a question of a search of that length takes, in JSON.
const bytesOf = (length: number) => Buffer.byteLength(JSON.stringify(questionOf('x'.repeat(length))));

// A registry on a clock the test moves.
const registryAt = (bytes = 1024 * 1024) => {
	const clock = { now: 0 };
	const registry = memoryRegistry({ retention: 24 * hour, bytes, now: () => clock.now });

	return { registry, clock };
};

describe('o registro em memória', () => {
	it('devolve a pergunta pelo id, e nada por um id que não conhece', async () => {
		const { registry } = registryAt();

		await registry.put('a', questionOf('car'));

		expect(await registry.get('a')).toEqual(questionOf('car'));
		expect(await registry.get('b')).toBeUndefined();
	});

	it('esquece a entrada depois do prazo sem uso (D-038, D-053)', async () => {
		const { registry, clock } = registryAt();

		await registry.put('a', questionOf('car'));
		clock.now = 24 * hour - 1;
		expect(await registry.get('a')).toEqual(questionOf('car'));

		clock.now += 24 * hour;
		expect(await registry.get('a')).toBeUndefined();
	});

	it('cada uso renova o prazo, e registrar de novo também', async () => {
		const { registry, clock } = registryAt();

		await registry.put('a', questionOf('car'));
		await registry.put('b', questionOf('bus'));

		for (let day = 1; day <= 3; day += 1) {
			clock.now = day * 20 * hour;
			expect(await registry.get('a')).toEqual(questionOf('car'));
			await registry.put('b', questionOf('bus'));
		}

		clock.now += 24 * hour;
		expect(await registry.get('a')).toBeUndefined();
		expect(await registry.get('b')).toBeUndefined();
	});

	it('acima do teto, sai primeiro a entrada usada há mais tempo (LRU)', async () => {
		const { registry } = registryAt(3 * bytesOf(10));

		await registry.put('a', questionOf('x'.repeat(10)));
		await registry.put('b', questionOf('y'.repeat(10)));
		await registry.put('c', questionOf('z'.repeat(10)));
		// Reading a makes b the least recently used.
		await registry.get('a');
		await registry.put('d', questionOf('w'.repeat(10)));

		expect(await registry.get('b')).toBeUndefined();
		expect(await registry.get('a')).toBeDefined();
		expect(await registry.get('c')).toBeDefined();
		expect(await registry.get('d')).toBeDefined();
	});

	it('a mesma entrada registrada de novo conta uma vez no teto', async () => {
		const { registry } = registryAt(2 * bytesOf(10));

		await registry.put('a', questionOf('x'.repeat(10)));
		await registry.put('b', questionOf('y'.repeat(10)));
		await registry.put('a', questionOf('x'.repeat(10)));
		await registry.put('a', questionOf('x'.repeat(10)));

		expect(await registry.get('a')).toBeDefined();
		expect(await registry.get('b')).toBeDefined();
	});

	it('com o relógio do sistema voltando, uma entrada vencida não volta', async () => {
		const { registry, clock } = registryAt();

		clock.now = 10 * hour;
		await registry.put('a', questionOf('car'));
		// The clock of the system goes back an hour, so b, registered after a, expires before it.
		clock.now = 9 * hour;
		await registry.put('b', questionOf('bus'));

		clock.now = 33 * hour + hour / 2;
		expect(await registry.get('b')).toBeUndefined();
		expect(await registry.get('a')).toEqual(questionOf('car'));
	});
});
