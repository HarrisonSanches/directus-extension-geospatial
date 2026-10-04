import { describe, expect, it } from 'vitest';
import { keyOf } from './key.js';

describe('as chaves da extensão', () => {
	it('saem do SECRET do Directus, uma para cada uso, e sempre as mesmas para o mesmo SECRET', () => {
		const ids = keyOf('a secret of Directus', 'registered query id');

		expect(ids).toHaveLength(32);
		expect(keyOf('a secret of Directus', 'registered query id')).toEqual(ids);
		expect(keyOf('a secret of Directus', 'cursor')).not.toEqual(ids);
		expect(keyOf('another secret', 'registered query id')).not.toEqual(ids);
	});

	it('sem o SECRET, são sorteadas no processo, como o Directus faz com o dele (V-182)', () => {
		expect(keyOf(undefined, 'cursor')).toHaveLength(32);
		expect(keyOf(undefined, 'cursor')).not.toEqual(keyOf(undefined, 'cursor'));
		expect(keyOf('', 'cursor')).not.toEqual(keyOf('', 'cursor'));
	});
});
