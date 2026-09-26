# The official image of Directus with SpatiaLite, which it does not bring (V-104), loaded into every connection Directus
# opens to SQLite (V-121). test/sqlite.ts builds it on each Directus version of the suite, whose image, pinned by
# digest, comes from test/combinations.ts.
ARG DIRECTUS
FROM ${DIRECTUS}

USER root
RUN apk add --no-cache libspatialite
USER node

COPY load-spatialite.ts /directus/load-spatialite.ts

# Node strips the types of the file, as it does for the scripts of test/ (V-121).
ENV NODE_OPTIONS="--import=/directus/load-spatialite.ts"
