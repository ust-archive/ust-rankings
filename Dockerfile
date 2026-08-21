FROM node:26.7-bookworm-slim
WORKDIR /app
RUN npm install --global npm@12.0.2

COPY package.json package-lock.json ./
COPY data/package.json data/package.json
RUN npm ci

COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

ENV HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["sh", "-c", "npm start -- -H 0.0.0.0 -p ${PORT:-8080}"]
