# Multi-stage build for the acv-mcp server.
#
# Build context MUST be mcp-server/ so that tsconfig.json,
# package.json, src/, and dist/ are all addressable as ./ here.
#
#   Build:  docker build -t acv-mcp:0.1.0 mcp-server
#   Run:    docker run --rm -i acv-mcp:0.1.0
#
# Launched via stdio; the MCP transport reads stdin and writes stdout.
# The image holds no credentials. Provider env vars (E2B_API_KEY etc.) and
# the provenance dir are passed in at `docker run` time via -e and -v.
#
# Threat model: T1 ("primary agent reads MCP server env via /proc/<pid>/environ
# or `ps auxe`"). Running the server inside a container puts the credential-
# bearing process in a separate PID namespace from the primary agent's Bash
# tool, so /proc and ps inspection from the host return nothing useful.

# ---------------------------------------------------------------------------
# Stage 1 — builder: install full deps, run tsc.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /build

# `mcp-server` is an npm workspace child of the repo root; the
# package-lock.json lives at the workspace root, NOT inside mcp-server/.
# To keep the Docker build context narrow (just mcp-server/) we use
# `npm install` rather than `npm ci`. Reproducibility is acceptable here
# because the runtime dep set is small (3 prod deps) and pinned by
# semver in package.json. If you need a fully locked build, switch the
# build context to the repo root, copy the root lockfile in, and
# run `npm ci -w mcp-server`.
COPY package.json ./
RUN npm install --omit=optional --no-audit --no-fund

# Copy source and tsconfig, then build.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev \
    && rm -rf src tsconfig.json

# ---------------------------------------------------------------------------
# Stage 2 — runtime: minimal image with only dist + prod node_modules.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime

# Run as a non-root user. The MCP server never needs root and dropping
# privileges is defense-in-depth against container-escape vulns.
RUN addgroup -S acv && adduser -S -G acv acv

WORKDIR /app

# Copy only what the runtime needs.
COPY --from=builder --chown=acv:acv /build/package.json ./package.json
COPY --from=builder --chown=acv:acv /build/node_modules ./node_modules
COPY --from=builder --chown=acv:acv /build/dist ./dist

USER acv

# Provenance dir defaults to a path inside the container; override with -v
# at run time to persist across container restarts:
#   docker run --rm -i -v "$PWD/.acv:/workspace/.acv" \
#              -e ACV_PROVENANCE_DIR=/workspace/.acv acv-mcp:0.1.0
ENV ACV_PROVENANCE_DIR=/workspace/.acv \
    ACV_SANDBOX_PROVIDER_PREFERENCE=e2b,daytona,modal,docker,local \
    ACV_ALLOW_LOCAL_FALLBACK=true \
    NODE_ENV=production

# stdio transport — no port to EXPOSE.
ENTRYPOINT ["node", "dist/index.js"]
