import type { Accountability } from '@directus/types';
import { openapi, type OpenApiDocument } from 'directus-geospatial-contract';
import { viewerOf } from '../capabilities/visible.js';

// The document of the contract (D-016), embedded in the build, to anyone with a session, as the capabilities: it
// carries the version of the API, and starting closed keeps opening it compatible (D-042).
export const readOpenapi = (accountability: Accountability | undefined): OpenApiDocument | 'forbidden' =>
	viewerOf(accountability) === 'anonymous' ? 'forbidden' : openapi;
