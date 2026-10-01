# An official image of Directus with a module of the chain of the ItemsService moved to another file, as a version of
# Directus that reorganized its files would have it: Directus imports the module from the new file and starts, and the
# path the adapters of the extension import no longer exists. Deleting the module would stop Directus itself, which
# imports it statically (V-170). test/internals.test.ts builds it on each Directus version of the suite, whose image,
# pinned by digest, comes from test/combinations.ts.
ARG DIRECTUS
FROM ${DIRECTUS}

USER root

# The package @directus/api the image runs (V-141), the module, and every file of the package that imports it, which
# grep fails the build without. The new name ends in the old one after a hyphen, so no import of it matches the old
# path.
RUN set -eu; \
	api="$(dirname "$(readlink -f /directus/node_modules/@directus/api/package.json)")/dist"; \
	importers="$(grep -rl '/get-db-query\.js' "$api")"; \
	mv "$api/database/run-ast/lib/get-db-query.js" "$api/database/run-ast/lib/moved-get-db-query.js"; \
	sed -i 's#/get-db-query\.js#/moved-get-db-query.js#' $importers; \
	if grep -rq '/get-db-query\.js' "$api"; then exit 1; fi

USER node
