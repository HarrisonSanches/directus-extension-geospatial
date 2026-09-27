# Contributing

Thank you for looking into Geospatial. This page says what helps while the extension is being built, how to
run the project and how a change gets in.

## What helps right now

The extension is in development: the foundation is being built, no spatial operation works yet, and nothing is
published. Until the first release, the maintainer builds it phase by phase, following a plan. So, for now:

- **Welcome:**
  - bug reports on what already exists: the development environment, the test suite and the CI;
  - questions and feedback on the design, in [`docs/arquitetura.md`](docs/arquitetura.md) and
    [`docs/decisoes.md`](docs/decisoes.md);
  - fixes to the documentation, typos included.
- **Not yet:** pull requests with features or larger changes. They would compete with the plan and will most
  likely be closed. If you want to build something, open an issue first, so we can talk about it.
- **Never in public:** a security vulnerability. [`SECURITY.md`](SECURITY.md) says how to report it privately.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Language

Code, commit messages, pull request titles and the public documentation are in English. The design documents
(`docs/`, `CONTEXT.md`) and the development standards (`docs/padroes/`) are in Portuguese. Issues and pull
request descriptions can be in English or in Portuguese.

## Running the project

You need only Node, pnpm and Docker:

- Node 24, the version in [`.node-version`](.node-version). The extension itself targets Node 22, the one in the
  Directus images;
- pnpm 12, the version in `packageManager` in [`package.json`](package.json). The project refuses any other
  version, and it does not use Corepack;
- Docker, for the development environment and the integration suite.

```sh
pnpm install                # also installs the commit-msg hook
pnpm check                  # formatting, lint, types, Knip, unit tests and the integration suite
pnpm test                   # unit tests only
pnpm test:integration       # the integration suite, with Directus and the databases in containers
```

The integration suite runs each test file on Directus 11.17 and 12, with PostGIS and with SQLite.
`INTEGRATION=11.17-postgis pnpm test:integration` runs a single combination, and
[`test/combinations.ts`](test/combinations.ts) lists them. Without a Directus license key, which only the
maintainer has, Directus 12 runs on its Core tier, and the tests expect that.

The development environment runs Directus 12, PostGIS and Redis on `127.0.0.1`, with the extension rebuilt on
every change. Copy [`dev/.env.example`](dev/.env.example) to `dev/.env` and run `pnpm dev`: it fills in the empty
secrets, and the file explains the rest. `pnpm dev:down` stops it.

## How a change gets in

The standards are in [`docs/padroes/`](docs/padroes/README.md), including what "done" means. The short version:

- **Tests run on the real thing.** Directus and the databases run in containers, with no mocks of either, and new
  or changed code keeps at least 90% coverage.
- **One branch per change,** from `develop`, named `<type>/<id>-<description>`, as in
  [Conventional Branch](https://conventionalbranch.org/): `fix/12-dev-env-port`.
- **Commits follow [Conventional Commits](https://www.conventionalcommits.org/).** The `commit-msg` hook runs
  commitlint, with a header of at most 72 characters and no vague subject such as `update files`.
- **The pull request goes to `develop`** and is merged with squash, so its title becomes the commit: it follows
  the same standard. The description says why the change is needed and ends with the footers of the template:
  `Refs:` with the issue (`Refs: #12`), and `Co-Authored-By:` only when an AI agent worked on the change.
- **The CI has to pass,** with the coverage of the patch and the quality gate of SonarQube Cloud. Pull requests
  from forks get no secrets, so their Directus 12 jobs run on the Core tier, and SonarQube Cloud cannot analyze
  them. When a pull request from a fork is ready, the maintainer brings its commits into a branch of the repository,
  with you still as their author, and the analysis runs there.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE) of the project.
