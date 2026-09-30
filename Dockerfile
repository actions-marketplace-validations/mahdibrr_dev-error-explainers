# MCP server (stdio) for Glama's automated checks and for anyone who prefers a container.
# Zero runtime dependencies: only the package's own files are copied.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY bin ./bin
USER node
ENTRYPOINT ["node", "bin/mcp.js"]
