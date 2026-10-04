import { hkdfSync, randomBytes } from 'node:crypto';

// What a key of the extension is for. Each use gets a key of its own, so no key serves another.
type Use = 'registered query id' | 'cursor';

// A key of the extension, derived from the SECRET of Directus by HKDF (RFC 5869), with its use as the info, so the keys
// serve no other use of the secret. Every instance of a Directus shares its SECRET, and so the keys. Without one,
// Directus draws a secret for the process, and the keys are drawn the same way (V-182).
export const keyOf = (secret: unknown, use: Use): Buffer =>
	typeof secret === 'string' && secret !== ''
		? Buffer.from(hkdfSync('sha256', secret, '', `directus-extension-geospatial ${use}`, 32))
		: randomBytes(32);
