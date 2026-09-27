# Security policy

Geospatial runs inside Directus, outside the extension sandbox, with full access to the database Directus uses. A
vulnerability in it can expose data that the Directus permissions protect, so every report is taken seriously.

## Supported versions

Nothing is released yet. Until the first release on npm, only the `develop` branch receives fixes. From then on,
this page lists the supported versions.

## Reporting a vulnerability

Please do not open a public issue, pull request or discussion about it.

Report it privately through GitHub: on the **Security** tab of the repository, choose **Report a vulnerability**.
Only you and the maintainer see the report. GitHub explains the steps in
[Privately reporting a security vulnerability](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately).

Include what you can:

- the affected code or setup: the commit, the Directus version and the database;
- the steps to reproduce it;
- the impact you expect, such as who could read or change what.

## What happens next

- The maintainer confirms the report within 7 days.
- The fix is worked out in the private advisory, with you, and released as soon as it is ready.
- The advisory is then published, crediting you unless you ask otherwise.

## Out of scope

A vulnerability in Directus itself goes to the Directus project, through the private report on
[its Security tab](https://github.com/directus/directus/security). When you are not sure where it belongs, report
it here, and the maintainer passes it on.
