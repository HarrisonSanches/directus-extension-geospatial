// The commands of the extension for the Directus SDK, used in client.request(...) as the ones of Directus are, with the
// prefix geo (D-024), and the types of the contract they take and give (D-016).
export { geoCapabilities } from './capabilities.js';
export { type GeospatialError, type GeospatialErrorCode, isGeospatialError } from './errors.js';
export { geoFinalSummary, type GeoFinalSummaryOptions } from './final-summary.js';
export { geoPaginate } from './paginate.js';
export {
	type GeoQuery,
	type GeoQueryItem,
	type GeoQueryItemsOutput,
	type GeoQueryItemsPage,
	type GeoQueryPage,
	type GeoQuestion,
	type GeoRadiusOperation,
	geoQueryItems,
	geoQueryShapes,
	geoQuerySummary,
	geoRegisterQuery,
} from './queries.js';
export { geoRadius, type GeoRadiusItem, type GeoRadiusOutput, type GeoRadiusQuery } from './radius.js';
export type {
	Capabilities,
	Cursor,
	ErrorCode,
	GeoValues,
	Item,
	ItemsMeta,
	OperationCapability,
	Position,
	QueryId,
	Shape,
	Shapes,
	SummaryValues,
} from 'directus-geospatial-contract';
