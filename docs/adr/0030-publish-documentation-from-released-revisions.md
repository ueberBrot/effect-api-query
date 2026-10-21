# Publish documentation from released revisions

Status: Accepted. Extends [ADR 0016](0016-automate-releases-with-changesets.md) for documentation deployment.

The public website documents the published package because `main` can contain unreleased builders and behavior. Deploy the validated documentation artifact automatically only after the root package is published successfully, replacing deployment after every validated merge to `main`.

Manual deployment may rebuild a verified published version or apply documentation-only changes to its released source. Resolve both revisions to immutable commits and reject library, dependency, manifest, and workflow changes. This permits documentation corrections without publishing the package or exposing unreleased library code.

Display the documentation build's package version and link to that exact npm version. Verify its static package-version metadata before deployment. Continue checking documentation on every pull request. A separate development site remains deferred.
