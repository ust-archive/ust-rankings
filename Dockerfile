FROM oven/bun:1.3.14
WORKDIR /app

COPY package.json bun.lock ./
COPY data/package.json data/package.json
RUN bun install --frozen-lockfile

COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run update-data && bun --bun next build

ENV HOSTNAME=0.0.0.0
EXPOSE 8080
USER bun
CMD ["sh", "-c", "bun --bun next start -H 0.0.0.0 -p ${PORT:-8080}"]
