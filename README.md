# Directus Geospatial

> Status: planning. There is no code yet.

A Directus extension that turns the Studio into an operational geospatial panel. Spatial operations run in the database (PostGIS as the reference implementation, with adapters for the other databases Directus supports). They are available in the Studio (layout, module and dashboard panel), through the API, through a typed SDK and in Flows, always respecting Directus permissions.

Planned operations: radius, drawn area, measure, nearest, trajectory, corridor, count by region, density grid and hotspots. The extension also produces evidence reports as PDF.

The planning documents are in Portuguese:

- [docs/arquitetura.md](docs/arquitetura.md): architecture
- [docs/decisoes.md](docs/decisoes.md): decision log
- [docs/verificacoes.md](docs/verificacoes.md): verified facts about third-party tools
- [CONTEXT.md](CONTEXT.md): glossary

## License

[MIT](LICENSE)
