import { describe, expect, it } from 'vitest';
import { inputsOf } from './requests.js';
import { type Geo, openapi } from './index.js';

const geo = inputsOf(openapi).schema<Geo>('Geo');

const radius = { operation: 'radius', center: [-46.7, -23.65], distance: 1000 };

describe('a entrada conferida contra o contrato', () => {
	it('um raio no contrato passa, com o campo ou sem ele', () => {
		expect(geo(radius)).toEqual({ valid: true, value: radius });
		expect(geo({ ...radius, field: 'location' })).toEqual({ valid: true, value: { ...radius, field: 'location' } });
	});

	it.each([
		['a distância negativa', { ...radius, distance: -1 }],
		['a distância zero', { ...radius, distance: 0 }],
		['a distância em texto', { ...radius, distance: '1000' }],
		['a longitude fora da faixa', { ...radius, center: [-180.5, -23.65] }],
		['a latitude fora da faixa', { ...radius, center: [-46.7, 90.5] }],
		['o ponto com três coordenadas', { ...radius, center: [-46.7, -23.65, 760] }],
		['o ponto com uma coordenada', { ...radius, center: [-46.7] }],
		['uma operação que não existe', { ...radius, operation: 'nearest' }],
		['uma propriedade que o raio não tem', { ...radius, unit: 'km' }],
		['o raio sem a distância', { operation: 'radius', center: [-46.7, -23.65] }],
		['o campo vazio', { ...radius, field: '' }],
		['um valor que não é um objeto', 'radius'],
	])('%s reprova', (_, value) => {
		expect(geo(value)).toMatchObject({ valid: false });
	});

	it('o motivo diz onde e por quê', () => {
		expect(geo({ ...radius, distance: -1 })).toEqual({
			valid: false,
			errors: expect.arrayContaining(['/distance must be > 0']) as string[],
		});
	});
});
