# Build + runtime da API Hono com o front ja compilado.
FROM oven/bun:1-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/public ./public
COPY --from=build /app/src ./src
COPY --from=build /app/tools ./tools
CMD ["sh", "-c", "bun run db:migrate && bun src/api/index.ts"]
