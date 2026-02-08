FROM node:20-bookworm-slim

# Use ARG for PNPM_VERSION for flexibility (default matches package.json)
ARG PNPM_VERSION=9.1.0

WORKDIR /app

# Enable corepack and install specific pnpm version
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Copy package files first for caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies (frozen lockfile for reproducibility)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the project (compile TypeScript)
RUN pnpm build

# Expose the application port
EXPOSE 3000

# Start the server using the defined script
CMD ["pnpm", "start:server"]
