# Control Plane API (Bun + Elysia) — production image (T205)
FROM oven/bun:1.4 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/ai/package.json packages/ai/
COPY packages/auth/package.json packages/auth/
COPY packages/mcp/package.json packages/mcp/
COPY apps/api/package.json apps/api/
# sddctl is bundled into the API image (GET /api/v1/cli/sddctl.mjs).
COPY apps/cli/package.json apps/cli/
RUN bun install --frozen-lockfile

FROM install AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/cli ./apps/cli
RUN bun install --frozen-lockfile && bun run --filter '@sdd/api' build

FROM oven/bun:1.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# oven/bun no longer ships adduser/addgroup — create the unprivileged user
# via passwd/group directly (works on any base image).
RUN printf 'sdd:x:1000:\n' >> /etc/group \
    && printf 'sdd:x:1000:1000::/app:/usr/sbin/nologin\n' >> /etc/passwd
COPY --from=install /app/node_modules ./node_modules
# Workspace metadata (package.json files) + source are required so that
# `bun packages/db/scripts/migrate.ts` runs from this image (T210).
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./dist
# Preserve project and copied/adapted upstream licenses in distributed images.
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY third-party-licenses ./third-party-licenses
USER sdd
# One-off migration runner: `docker compose run --rm migrate`
CMD ["bun", "dist/index.js"]
