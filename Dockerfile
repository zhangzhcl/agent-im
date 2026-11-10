FROM node:22-alpine

WORKDIR /app

# Install production dependencies only
COPY package.json ./
RUN npm install --omit=dev

# Copy source code and entry points
COPY src/ ./src/
COPY bin/ ./bin/
COPY index.js README.md config.example.json ./

# Create data directories for persistence
RUN mkdir -p /app/data/state /app/data/media

EXPOSE 8080

ENV NODE_ENV=production

CMD ["node", "bin/cli.js", "start", "--config", "/app/config.json"]
