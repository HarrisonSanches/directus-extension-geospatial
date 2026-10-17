// Codecov takes the uploads to a repository it shows as deactivated and drops them in silence, so the codecov/patch that
// the rulesets require never comes, and the pull request waits with no warning (A-063). After the upload, the coverage
// job reads the repository in the public API of Codecov, which answers without a token for a public repository (V-197),
// and fails with the cause. The address goes as an argument, so a data: URL tries the failure without deactivating
// anything: node test/codecov.ts 'data:application/json,{"activated":false}'.
const repository = process.env.GITHUB_REPOSITORY ?? 'HarrisonSanches/directus-extension-geospatial';
const url = process.argv[2] ?? `https://api.codecov.io/api/v2/github/${repository.replace('/', '/repos/')}/`;

const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });

if (response.ok) {
	const { activated } = (await response.json()) as { activated?: unknown };

	if (activated === true) {
		process.stdout.write('Codecov shows the repository as activated, so it keeps the upload.\n');
	} else {
		process.stderr.write(
			`Codecov shows the repository with activated: ${String(activated)}, and drops its uploads in silence. Activate ` +
				'it on the page of the repository in Codecov, and run this job again to send the coverage again.\n',
		);
		process.exitCode = 1;
	}
} else {
	process.stderr.write(`The API of Codecov answered ${String(response.status)}, so the activation was not checked.\n`);
	process.exitCode = 1;
}
