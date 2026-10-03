# Pull request

## What and why

<!-- One or two sentences. Link the issue: Closes #123 -->

## Type of change

- [ ] Bug fix (no API or schema change)
- [ ] Feature (new or changed behaviour)
- [ ] Refactor (no behaviour change)
- [ ] Docs
- [ ] Build / CI / infra

## Checklist

- [ ] `bash verify-all.sh` is green (tsc + eslint + vitest, all six packages)
- [ ] New behaviour has tests
- [ ] Prompt builders, zod schemas and services are covered
- [ ] No new `any` without a comment saying why
- [ ] No secrets, keys or tokens committed; `.env` stays git-ignored
- [ ] Model ids are in env/config, never hard-coded
- [ ] Accessibility kept: keyboard nav, ARIA labels, contrast
- [ ] Docs updated if behaviour or config changed
- [ ] `CHANGELOG.md` has an entry under Unreleased

## Risk and rollback

- Risk: <!-- low / medium / high - and why -->
- Rollback: <!-- revert this commit? feature flag? -->

## Notes for the reviewer

Anything non-obvious: a deliberate shortcut, a follow-up, or where to look first.
