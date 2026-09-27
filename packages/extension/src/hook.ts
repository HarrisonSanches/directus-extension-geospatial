import { defineHook } from '@directus/extensions-sdk';
import packageJson from '../package.json' with { type: 'json' };

export default defineHook((_, { logger }) => {
	logger.child({ extension: 'geospatial' }).info(`Geospatial ${packageJson.version} loaded`);
});
