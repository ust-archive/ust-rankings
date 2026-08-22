# Git conventions

## Delivery unit

A ticket-sized pull request is the delivery unit. Merge pull requests by squashing so each becomes one commit on `master`. Split work that needs independently useful commits into separate tickets and pull requests.

Merge only after required checks and reviews pass. Delete the source branch after merging.

## Messages

Authored commits and pull request titles follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). This repository has no syntax overrides.

The pull request title becomes the squash commit title. The pull request body becomes its body, so keep it current and include:

- `## Summary` for the delivered behavior.
- `## Verification` for the checks performed.
- A separate `Closes #<issue>` for every fully delivered parent or child ticket. GitHub does not infer closure through issue relationships.

Accept GitHub's generated squash message without rewriting it at merge time.
