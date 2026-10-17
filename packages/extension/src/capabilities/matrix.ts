import type { Database, Internals, OperationCapability, Spatial } from 'directus-geospatial-contract';
import { radiusLevels } from '../operations/radius/levels.js';

// Each operation of the catalog, by its id (D-024), with its level in each database.
const operations = { radius: radiusLevels } as const;

export type OperationId = keyof typeof operations;

const internalsOff: OperationCapability = {
	level: 'unavailable',
	reason: 'The internals of this Directus are not the ones the extension expects.',
};

const noSpatial: { level: 'unavailable'; reason: string } = {
	level: 'unavailable',
	reason: 'The database in use has no spatial extension.',
};

// What the extension detected of the database on startup (startup.ts), and what the check of the internals found.
interface Environment {
	client: Database['client'];
	spatial: Spatial | null;
	internals: Internals;
}

// The level an operation declares for the database in use, which runs only with the spatial extension of that database:
// without one, the operation is unavailable too. Where the operation does not run yet, the reason stays its own. The
// capabilities and the operations read the level the same way, so an operation never runs where the capabilities say
// it is unavailable, nor fails where they say it runs (A-050).
export const levelOn = <Level extends { level: OperationCapability['level'] }>(
	levels: Record<Database['client'], Level>,
	{ client, spatial }: Pick<Environment, 'client' | 'spatial'>,
): Level | typeof noSpatial => {
	const declared = levels[client];

	return declared.level !== 'unavailable' && spatial === null ? noSpatial : declared;
};

// The level of an operation in the database in use, unless the internals are off (§5, protection 2), without the SQL
// the declaration carries.
export const capabilityOf = (operation: OperationId, environment: Environment): OperationCapability => {
	if (environment.internals.status === 'refused') {
		return internalsOff;
	}

	const declared = levelOn(operations[operation], environment);

	return declared.level === 'unavailable'
		? { level: declared.level, reason: declared.reason }
		: { level: declared.level };
};

// The capability matrix (D-002), as the capabilities route reports it.
export const matrixOf = (environment: Environment): Record<OperationId, OperationCapability> => ({
	radius: capabilityOf('radius', environment),
});
