FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Remove dev dependencies and source code
RUN npm prune --production && rm -rf src/ tsconfig.json

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S notification -u 1001

# Change ownership and switch to non-root user
RUN chown -R notification:nodejs /usr/src/app
USER notification

# Expose port
EXPOSE 3007

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3007/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
