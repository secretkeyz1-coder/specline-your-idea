# SvelteKit web (adapter-node) — production image (T205)
FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY ["Referensi UI", "./Referensi UI"]
RUN cd apps/web && bun run build

FROM oven/bun:1.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# adapter-node binds $PORT (default 3000) — keep proxy/healthcheck in sync.
ENV PORT=5173
# oven/bun no longer ships adduser/addgroup — create the unprivileged user
# via passwd/group directly (works on any base image).
RUN printf 'sdd:x:1000:\n' >> /etc/group \
    && printf 'sdd:x:1000:1000::/app:/usr/sbin/nologin\n' >> /etc/passwd
COPY --from=build /app/apps/web/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build ["/app/Referensi UI", "./Referensi UI"]
# Preserve project/upstream notices alongside the scoped reference collection.
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY third-party-licenses ./third-party-licenses
USER sdd
EXPOSE 5173
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD bun -e "fetch('http://127.0.0.1:5173/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "build/index.js"]
