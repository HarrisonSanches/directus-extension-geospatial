import type { createApiReference } from '@scalar/api-reference';
import { openapi } from 'directus-geospatial-contract';

// The page of the reference of the API, which Scalar renders in the browser from the contract (D-060).
export const referencePath = '/api/';

// The slug of the document in the anchors of the reference, which go #geospatial/<operationId>, like #geospatial/items.
const referenceSlug = 'geospatial';

// What the page of the reference hands to Scalar: the contract the build embeds, so the page fetches nothing to render
// it, and the anchors by the operationId, which a link of the docs points to. Scalar talks to no host but the site
// (V-194): its fonts, its AI chat, its MCP entry, its telemetry, the proxy of the test requests and the button of its
// own API client stay off.
export const referenceConfiguration = {
	content: openapi,
	slug: referenceSlug,
	generateOperationSlug: ({ operationId, method, path }) => operationId ?? `${method}${path}`,
	withDefaultFonts: false,
	agent: { disabled: true },
	mcp: { disabled: true },
	telemetry: false,
	proxyUrl: '',
	hideClientButton: true,
} satisfies Parameters<typeof createApiReference>[1];

// An object of the document, which its generated type leaves as unknown below the paths.
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The operations of a path: one under each method, and those under additionalOperations, like the SEARCH.
const operationsOf = (pathItem: unknown) => {
	const { additionalOperations, ...fields } = isRecord(pathItem) ? pathItem : {};

	return [...Object.values(fields), ...(isRecord(additionalOperations) ? Object.values(additionalOperations) : [])];
};

// The operationId of every operation of the paths of a document. The other fields of a path, like its parameters, have
// none.
export const operationIdsOf = (paths: Record<string, unknown>) =>
	new Set(
		Object.values(paths)
			.flatMap(operationsOf)
			.flatMap((operation) =>
				isRecord(operation) && typeof operation.operationId === 'string' ? [operation.operationId] : [],
			),
	);

const operationIds = operationIdsOf(openapi.paths);

// The links validator sees the page of the reference but not the anchors Scalar renders in the browser, so a link into
// it is left to this check: the page itself, or the anchor of an operation of the contract (V-194). A typo still fails
// the build.
export const isReferenceLink = ({ link }: { link: string }) => {
	const anchor = `${referencePath}#${referenceSlug}/`;

	return link === referencePath || (link.startsWith(anchor) && operationIds.has(link.slice(anchor.length)));
};
