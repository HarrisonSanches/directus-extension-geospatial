import { describe, expect, it } from 'vitest';
import postgis18 from '../../testdata/versions/postgis-18-3.6.json' with { type: 'json' };
import { detectCapabilities } from './detect.js';
import { viewerOf, visibleTo } from './visible.js';

const capabilities = detectCapabilities({
	apiVersion: '0.1.0',
	extensionVersion: '0.1.0',
	directusVersion: '12.4.1',
	client: 'postgres',
	...postgis18,
	internals: { status: 'accepted', adapter: '12' },
});

describe('quem vê o capabilities', () => {
	it('o admin vê tudo, com o banco, a extensão espacial e os internos', () => {
		expect(viewerOf({ user: 'admin-id', admin: true })).toBe('admin');
		expect(visibleTo(capabilities, 'admin')).toEqual(capabilities);
	});

	it('o usuário logado vê a matriz e as versões, sem o banco, a extensão espacial e os internos', () => {
		expect(viewerOf({ user: 'maria-id', admin: false })).toBe('user');
		expect(visibleTo(capabilities, 'user')).toEqual({
			api: capabilities.api,
			extension: capabilities.extension,
			directus: capabilities.directus,
			operations: capabilities.operations,
		});
	});

	it.each([
		['sem usuário', { user: null, admin: false }],
		['sem accountability', null],
		['com accountability indefinida', undefined],
	])('o pedido %s é anônimo', (_, accountability) => {
		expect(viewerOf(accountability)).toBe('anonymous');
	});
});
