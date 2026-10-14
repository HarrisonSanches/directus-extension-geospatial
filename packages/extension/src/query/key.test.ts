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

	// A change of the salt, the info or the length would change every id and cursor an installation gave, after an update
	// of the extension, and between instances of two versions.
	it('são as do HKDF com o SHA-256, sem sal e com o uso no info, as mesmas em qualquer versão da extensão', () => {
		expect(keyOf('a secret of Directus', 'registered query id').toString('hex')).toBe(
			'ee64d29d3422a3d5ca6b236e4da6a699651d51c7dea1c2eb24c94cb4634cee8a',
		);
		expect(keyOf('a secret of Directus', 'cursor').toString('hex')).toBe(
			'180f85b315b928710533279dbf97b2eeaaec606c34c9c5eafd558845e3c7543f',
		);
	});

	it('sem o SECRET, são sorteadas no processo, como o Directus faz com o dele (V-182)', () => {
		expect(keyOf(undefined, 'cursor')).toHaveLength(32);
		expect(keyOf(undefined, 'cursor')).not.toEqual(keyOf(undefined, 'cursor'));
		expect(keyOf('', 'cursor')).not.toEqual(keyOf('', 'cursor'));
	});
});
