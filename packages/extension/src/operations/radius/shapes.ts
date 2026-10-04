import type { QueryShapesResponse } from 'directus-geospatial-contract';
import { InvalidInputError } from '../../errors.js';
import { circleOf } from './circle.js';
import { type Checking, permittedRadius, type RadiusRequest, takenBy } from './items.js';

// The shapes of the radius, the part of its result that draws it (D-022): the circle, with the center and the distance
// in its properties, as the server builds it (D-055). The circle reads no item, but goes only to whoever can read what
// the items of the same question read, and whoever cannot gets the error of /items (D-001): the permitted query is
// built, and not run.
export const radiusShapes = async (
	{ cursor, ...request }: RadiusRequest,
	engine: Checking,
): Promise<QueryShapesResponse> => {
	takenBy(request.page, engine.defaultLimit);

	// The radius gives a single shape, so no page comes after the first, and no cursor is one this list gave.
	if (cursor !== undefined) {
		throw new InvalidInputError({ reason: 'The cursor is not one this list gave' });
	}

	await permittedRadius(request, engine);

	const { center, distance } = request.geo;

	return {
		data: {
			type: 'FeatureCollection',
			features: [{ type: 'Feature', geometry: circleOf(center, distance), properties: { center, distance } }],
		},
	};
};
