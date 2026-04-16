FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY config.example.toml ./config.example.toml

RUN mkdir -p /data

CMD ["node", "dist/index.js"]
