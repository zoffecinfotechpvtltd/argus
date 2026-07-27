# Saas-mode image (multi-tenant, Postgres-backed) — a separate hosted deployment target, not part
# of the shipped product (see GUIDE.md). The exe-mode self-host path stays a compiled Windows
# binary (scripts/release.ts) — this is the *other* deployment target, not a replacement for it.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:ui && bun run generate:embeds

FROM oven/bun:1-slim
WORKDIR /app
ENV MODE=saas
COPY --from=build /app /app
EXPOSE 7070
CMD ["bun", "run", "src/bootstrap/main.ts"]
