import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

// Loads SpatiaLite into every connection Directus opens to SQLite, which Directus never does by itself (V-121). Node
// runs it before Directus, in every process of the container, through the NODE_OPTIONS of the Dockerfile next to it,
// the way the APM agents instrument a database driver.

type Loaded = (error: Error | null) => void;

type Opened = (this: Database, error: Error | null) => void;

// The part of the sqlite3 driver this file uses, which only exists inside the container.
interface Database {
	loadExtension: (path: string, callback: Loaded) => void;
	emit: (event: 'error', error: Error) => boolean;
}

interface Sqlite3 {
	Database: new (filename: string, ...options: (number | Opened)[]) => Database;
}

// Where the libspatialite package of Alpine installs the extension.
const spatialite = '/usr/lib/mod_spatialite.so.8';

// Knex requires sqlite3 from its own folder, where pnpm links it, and Node keeps one module for each real path, so this
// is the driver Directus opens its connections with. The suite reads the versions with it too.
const fromApi = createRequire(realpathSync('/directus/node_modules/@directus/api/package.json'));
export const sqlite3 = createRequire(realpathSync(fromApi.resolve('knex')))('sqlite3') as Sqlite3;

const { Database } = sqlite3;

// The driver hands the connection over, to Knex too, only after SpatiaLite is loaded, so no query runs without it. It
// takes an optional mode and then the callback, and calls the callback on the connection.
sqlite3.Database = class extends Database {
	constructor(filename: string, ...options: (number | Opened)[]) {
		const mode = options.filter((option) => typeof option === 'number');
		const opened = options.find((option) => typeof option === 'function');

		super(filename, ...mode, function (this: Database, error: Error | null) {
			const done: Loaded = (result) => {
				if (opened !== undefined) {
					opened.call(this, result);
				} else if (result !== null) {
					// What the driver does with an error when nobody passed a callback.
					this.emit('error', result);
				}
			};

			if (error === null) {
				this.loadExtension(spatialite, done);
			} else {
				done(error);
			}
		});
	}
};
