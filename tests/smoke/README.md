# Smoke Tests

End-to-end smoke tests that exercise the full MCP tool round-trip against the local sandbox provider. These are not unit tests — they require the MCP server to be built (`npm run build`) and the local Node.js runtime to be available.

## Tests

### e2e_run_in_sandbox.mjs

Verifies that `run_in_sandbox` can execute a trivial JavaScript snippet via the local subprocess provider and return a structured response with `exit_code: 0` and the expected stdout.

Run from the repo root:

```bash
node tests/smoke/e2e_run_in_sandbox.mjs
```

Expected output: `PASS: {"ok":true,"lang":"js"}`
