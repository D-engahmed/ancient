# syntax=docker/dockerfile:1

FROM oven/bun:1.3.5 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bun run db:generate
RUN bun run --cwd packages/server build

FROM oven/bun:1.3.5-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages

USER bun
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD bun -e 'fetch("http://127.0.0.1:3000/health/live").then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))'

CMD ["bun", "run", "packages/server/dist/index.js"]
