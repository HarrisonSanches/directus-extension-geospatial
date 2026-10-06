import type { RestCommand } from '@directus/sdk';
import type { Capabilities } from 'directus-geospatial-contract';

// What the extension can do on this Directus: the level of each operation, and the versions (D-042). A request without
// a session rejects with the FORBIDDEN of Directus, which isGeospatialError(error, 'FORBIDDEN') tells.
export const geoCapabilities =
	<Schema>(): RestCommand<Capabilities, Schema> =>
	() => ({ path: '/geospatial/capabilities', method: 'GET' });
