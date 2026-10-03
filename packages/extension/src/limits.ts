import { limitMaximum } from 'directus-geospatial-contract';

// The limits of the extension, in one place, with the defaults of §7.8. The admin configures them with the collections
// of the extension, in F06.
export const limits = {
	// The bytes of the body of a request, below the 1 MB Directus takes (V-10).
	body: 256 * 1024,
	// The items of a page, the maximum of the contract (D-051).
	page: limitMaximum,
	// The items of a circle the server measures and orders, where the database does not (D-052).
	server: 50_000,
	// The registered queries in memory: each one kept for 24 hours since it was last used, and the least recently used
	// ones out first past the bytes of their questions, in JSON (D-053).
	registry: { retention: 24 * 60 * 60 * 1000, bytes: 32 * 1024 * 1024 },
} as const;
