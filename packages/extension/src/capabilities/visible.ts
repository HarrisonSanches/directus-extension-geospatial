import type { Capabilities } from 'directus-geospatial-contract';

export type Viewer = 'anonymous' | 'user' | 'admin';

// As Directus does with its own version and health: anonymous requests are refused, and only admins see the
// database. The route asks who is asking before it touches the database.
export const viewerOf = (accountability: { user?: string | null; admin?: boolean } | null | undefined): Viewer => {
	if (!accountability?.user) {
		return 'anonymous';
	}

	return accountability.admin === true ? 'admin' : 'user';
};

// The response for a user who is not an admin lists what it carries, so a new admin-only field stays out of it.
export const visibleTo = (capabilities: Capabilities, viewer: Exclude<Viewer, 'anonymous'>): Capabilities => {
	if (viewer === 'admin') {
		return capabilities;
	}

	const { api, extension, directus, operations } = capabilities;

	return { api, extension, directus, operations };
};
