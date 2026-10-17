import { InternalServerError } from '@directus/errors';
import type { Accountability, ApiExtensionContext } from '@directus/types';
import { apiVersion, type Capabilities, type Internals } from 'directus-geospatial-contract';
import packageJson from '../../package.json' with { type: 'json' };
import { detectCapabilities, type Detected } from '../capabilities/detect.js';
import { viewerOf, visibleTo } from '../capabilities/visible.js';
import { failClosed } from '../db/fail-closed.js';

// The version Directus itself reports in /server/info, which any user with a session can read.
const directusVersionOf = async (context: ApiExtensionContext, accountability: Accountability | undefined) => {
	const server = new context.services.ServerService({ schema: await context.getSchema(), accountability });
	const info: Record<string, unknown> = await server.serverInfo();

	if (typeof info.version !== 'string') {
		throw new InternalServerError();
	}

	return info.version;
};

// What the extension found once for the process: the database it detected, and the internals it checked.
interface Startup {
	detected: () => Promise<Detected>;
	internals: () => Promise<Internals>;
}

export const readCapabilities = async (
	context: ApiExtensionContext,
	accountability: Accountability | undefined,
	{ detected, internals }: Startup,
): Promise<Capabilities | 'forbidden'> => {
	const viewer = viewerOf(accountability);

	if (viewer === 'anonymous') {
		return 'forbidden';
	}

	// Each one reads the database: Directus its settings at each request, and the detection and the check of the internals
	// once for the process, again after a failure.
	const [found, directusVersion, checked] = await failClosed(
		() => Promise.all([detected(), directusVersionOf(context, accountability), internals()]),
		context.logger.child({ extension: 'geospatial' }),
	);

	const capabilities = detectCapabilities({
		...found,
		directusVersion,
		extensionVersion: packageJson.version,
		apiVersion,
		internals: checked,
	});

	return visibleTo(capabilities, viewer);
};
