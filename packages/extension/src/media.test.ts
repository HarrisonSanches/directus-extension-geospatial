import { type ItemsResponse, wholeBodyType } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import { sendList } from './media.js';

// What sendList does to a response of Express, in order.
const sent = (preferred: string | false) => {
	const calls: string[] = [];
	const body: ItemsResponse = { data: [{ id: 1, $geo: { distance: 0 } }], meta: { next: 'next-page' } };

	sendList(
		// Express answers the type of the list the Accept prefers, as the negotiator orders them (D-058).
		{ accepts: (types) => (preferred === false || types.includes(preferred) ? preferred : false) },
		{
			vary: (field) => calls.push(`vary ${field}`),
			type: (type) => calls.push(`type ${type}`),
			json: (sentBody) => calls.push(`json ${JSON.stringify(sentBody)}`),
		},
		body,
	);

	return { calls, body: JSON.stringify(body) };
};

describe('sendList', () => {
	it('a quem prefere o tipo próprio da extensão, manda a lista nele, com o mesmo corpo e o Vary (D-058)', () => {
		const { calls, body } = sent(wholeBodyType);

		expect(calls).toEqual(['vary Accept', `type ${wholeBodyType}`, `json ${body}`]);
	});

	it('a quem prefere o application/json, ou não aceita nenhum dos dois, manda como o Directus manda', () => {
		for (const preferred of ['application/json', false] as const) {
			const { calls, body } = sent(preferred);

			expect(calls).toEqual(['vary Accept', `json ${body}`]);
		}
	});
});
