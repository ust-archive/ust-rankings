FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

COPY package.json bun.lock ./
COPY data/package.json data/package.json
RUN bun install --frozen-lockfile

COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run update-data && node ./node_modules/next/dist/bin/next build

ENV HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["sh", "-c", "node ./node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-8080}"]
