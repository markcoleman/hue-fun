FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsdown.config.ts openapi-ts.config.ts ./
COPY src ./src
COPY docs ./docs
COPY scripts ./scripts
COPY test ./test
COPY openhue.yaml ./
RUN npm ci
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
ENV HUE_MCP_TRANSPORT=http \
    HUE_MCP_HOST=0.0.0.0 \
    HUE_MCP_PORT=8080
EXPOSE 8080
ENTRYPOINT ["node", "dist/hue-mcp.mjs", "--transport", "http", "--host", "0.0.0.0", "--port", "8080"]
