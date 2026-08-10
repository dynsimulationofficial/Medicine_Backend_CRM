# Stage 1: Build the app with TypeScript
FROM node:18 AS builder

WORKDIR /usr/src/app

# Copy package files first for caching
COPY package*.json ./

# Configure npm for retries, offline cache, slower concurrency
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm install --prefer-offline --no-audit --progress=false --network-concurrency=1

# Copy rest of the app and build
COPY . .
RUN npm run build

# Stage 2: Run the app with only necessary files
FROM node:18

WORKDIR /usr/src/app

# Set default staging environment
ENV NODE_ENV=staging

# Copy only necessary files from builder stage
COPY --from=builder /usr/src/app/package.json ./package.json
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/start.sh ./start.sh

# Make start script executable
RUN chmod +x ./start.sh

EXPOSE 8016
CMD ["./start.sh"]