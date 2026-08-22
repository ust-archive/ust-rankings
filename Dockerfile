FROM node:26.7-alpine3.24 AS builder
WORKDIR /app
RUN npm install --global npm@12.0.2

COPY package.json package-lock.json ./
COPY data/package.json data/package.json
RUN npm ci --no-audit --no-fund

COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:26.7-alpine3.24 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

RUN mkdir .next && chown node:node .next
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=node:node /app/scripts/migrate-contributions.ts ./scripts/
COPY --from=builder --chown=node:node /app/contributions/migrations ./contributions/migrations

USER node
EXPOSE 8080
CMD ["sh", "-c", "node scripts/migrate-contributions.ts && exec node server.js"]
