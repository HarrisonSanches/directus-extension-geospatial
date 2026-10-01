import type { OpenApiDocument } from './generated/index.js';
import document from './generated/openapi.json' with { type: 'json' };

export type * from './generated/index.js';

// The info.version of openapi.yaml, which a test keeps in step with the document.
export const apiVersion = '0.1.0';

// The document of the contract, which the extension serves at /geospatial/openapi.json (D-016) and the tests check the
// responses of its routes against.
export const openapi: OpenApiDocument = document;
