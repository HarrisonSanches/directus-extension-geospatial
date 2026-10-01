import { ForbiddenError } from '@directus/errors';
import type { CollectionOverview, SchemaOverview } from '@directus/types';

// The collection of a request, refused as /items refuses it besides the permissions (V-173). A collection the schema
// does not have, or one of the system, is refused as one the user cannot read. Directus never creates a collection whose
// name starts with directus_, so the prefix finds every collection of the system, also one a newer version adds. An
// inactive collection of Directus 12 needs nothing here: the chain refuses it as /items does.
export const collectionOf = (schema: SchemaOverview, collection: string): CollectionOverview => {
	const found = schema.collections[collection];

	if (found === undefined || collection.startsWith('directus_')) {
		throw new ForbiddenError();
	}

	return found;
};
