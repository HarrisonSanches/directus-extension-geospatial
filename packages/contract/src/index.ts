import type { OpenApiDocument } from './generated/index.js';
import document from './generated/openapi.json' with { type: 'json' };

export type * from './generated/index.js';

// The info.version of openapi.yaml, which a test keeps in step with the document.
export const apiVersion = '0.1.0';

// The most items a page brings, the maximum of the schema Limit of openapi.yaml, which a test keeps in step with the
// document.
export const limitMaximum = 1000;

// The media type a list of items also comes as, with the same body as application/json, for a client that asks for it
// (D-058): the request of the Directus SDK hands over only the data of an application/json response, and the SDK of the
// extension asks for this one to read the meta too. A test keeps it in step with the document.
export const wholeBodyType = 'application/vnd.directus-geospatial+json';

// The document of the contract, which the extension serves at /geospatial/openapi.json (D-016) and the tests check the
// responses of its routes against.
export const openapi: OpenApiDocument = document;
