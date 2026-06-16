# CI

`ci.yml` is the GitHub Actions workflow for this repo: it runs build →
hook tests → vitest → lint → MCP handshake smoke → cheating-corpus catch-rate
floor (fails below 0.8) on pushes to `main`/`auto_dev` and on PRs.

## Activation

It lives here (not under `.github/workflows/`) because the automation that
authored it lacked the GitHub `workflow` OAuth scope needed to push workflow
files. To activate it, with credentials that have the `workflow` scope:

```bash
git mv ci/ci.yml .github/workflows/ci.yml
git commit -m "ci: activate GitHub Actions workflow"
git push
```
