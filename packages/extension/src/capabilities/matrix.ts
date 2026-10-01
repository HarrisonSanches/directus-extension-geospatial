import type { Database, Internals, OperationCapability, Spatial } from 'directus-geospatial-contract';
import { radiusLevels } from '../operations/radius/levels.js';

// Each operation of the catalog, by its id (D-024), with its level in each database.
const operations = { radius: radiusLevels } as const;

export type OperationId = keyof typeof operations;

const internalsOff: OperationCapability = {
	level: 'unavailable',
	reason: 'The internals of this Directus are not the ones the extension expects.',
};

const noSpatial: OperationCapability = {
	level: 'unavailable',
	reason: 'The database in use has no spatial extension.',
};

interface Environment {
	client: Database['client'];
	internals: Internals;
}

// The level of an operation in the database in use, as the operation declares it, unless the internals are off (§5,
// protection 2), without the SQL the declaration carries.
export const capabilityOf = (operation: OperationId, { client, internals }: Environment): OperationCapability => {
	const declared = operations[operation][client];

	if (internals.status === 'refused') {
		return internalsOff;
	}

	return declared.level === 'unavailable'
		? { level: declared.level, reason: declared.reason }
		: { level: declared.level };
};

// The capability matrix (D-002), as the capabilities route reports it: without a spatial extension in the database,
// no operation runs either.
export const matrixOf = (
	environment: Environment & { spatial: Spatial | null },
): Record<OperationId, OperationCapability> => {
	const levelOf = (operation: OperationId) =>
		environment.spatial === null && environment.internals.status === 'accepted'
			? noSpatial
			: capabilityOf(operation, environment);

	return { radius: levelOf('radius') };
};
