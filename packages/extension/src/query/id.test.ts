import type { RegisteredQuery } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import { canonicalOf, idKeyOf, idOf } from './id.js';

const question: RegisteredQuery = {
	collection: 'occurrences',
	geo: { operation: 'radius', center: [-46.7, -23.65], distance: 1000 },
	query: { filter: { _and: [{ status: { _eq: 'open' } }, { category: { _in: ['theft', 'fire'] } }] }, search: 'car' },
};

// The same question, with the keys of every object in another order.
const reordered: RegisteredQuery = {
	query: { search: 'car', filter: { _and: [{ status: { _eq: 'open' } }, { category: { _in: ['theft', 'fire'] } }] } },
	geo: { distance: 1000, center: [-46.7, -23.65], operation: 'radius' },
	collection: 'occurrences',
};

const key = idKeyOf('a secret of Directus');

describe('a forma canônica de um JSON (RFC 8785)', () => {
	it('ordena as chaves de cada objeto, sem espaços, e mantém a ordem das listas', () => {
		expect(canonicalOf({ b: [3, 1, { d: true, c: null }], a: 'x' })).toBe('{"a":"x","b":[3,1,{"c":null,"d":true}]}');
	});

	it('ordena as chaves pelas unidades UTF-16, e escreve os números e os textos como o JSON.stringify', () => {
		expect(canonicalOf({ é: 1, z: 1e21, Z: 0.000001, '\u{1F600}': 'a"b' })).toBe(
			'{"Z":0.000001,"z":1e+21,"é":1,"\u{1F600}":"a\\"b"}',
		);
	});
});

describe('o id da consulta registrada', () => {
	it('é curto, em base64url, e o mesmo para a mesma pergunta, com as chaves em qualquer ordem', () => {
		const id = idOf(key, question);

		expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
		expect(idOf(key, reordered)).toBe(id);
	});

	it.each([
		['outra coleção', { ...question, collection: 'hooked_occurrences' }],
		['outra distância', { ...question, geo: { ...question.geo, distance: 1001 } }],
		['outra ordem numa lista', { ...question, geo: { ...question.geo, center: [-23.65, -46.7] } }],
		['outra busca', { ...question, query: { ...question.query, search: 'bus' } }],
		['os campos', { ...question, query: { ...question.query, fields: ['id'] } }],
	] satisfies [string, RegisteredQuery][])('muda com %s', (_, other) => {
		expect(idOf(key, other)).not.toBe(idOf(key, question));
	});

	it('depende da chave da instalação, então não se calcula fora dela', () => {
		expect(idOf(idKeyOf('another secret'), question)).not.toBe(idOf(key, question));
		expect(idOf(idKeyOf('a secret of Directus'), question)).toBe(idOf(key, question));
	});

	it('sem o SECRET, a chave é sorteada no processo, como o Directus faz com o dele (V-182)', () => {
		expect(idOf(idKeyOf(undefined), question)).not.toBe(idOf(idKeyOf(undefined), question));
		expect(idOf(idKeyOf(''), question)).not.toBe(idOf(idKeyOf(''), question));
	});
});
