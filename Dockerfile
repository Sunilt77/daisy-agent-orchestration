FROM node:20-slim AS build

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

# Install full deps for build, then prune to production-only.
RUN npm ci

COPY . .

RUN npm run build
RUN npm prune --omit=dev
RUN npm run prisma:generate

FROM node:20-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs appuser

COPY --chown=appuser:nodejs --from=build /app/package*.json ./
COPY --chown=appuser:nodejs --from=build /app/node_modules ./node_modules
COPY --chown=appuser:nodejs --from=build /app/prisma ./prisma
COPY --chown=appuser:nodejs --from=build /app/dist ./dist
COPY --chown=appuser:nodejs --from=build /app/server.ts ./server.ts
COPY --chown=appuser:nodejs --from=build /app/src ./src
COPY --chown=appuser:nodejs --from=build /app/scripts ./scripts
COPY --chown=appuser:nodejs docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER appuser

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start:cloudrun"]
