FROM node:18

WORKDIR /app

# Install dependencies first (for better caching)
COPY package.json pnpm-lock.yaml ./

# Install pnpm and dependencies with platform-specific handling
RUN npm install -g pnpm && \
    rm -rf node_modules && \
    pnpm install --force --shamefully-hoist

# Copy application files
COPY src ./src
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY tailwind.config.js postcss.config.js ./

EXPOSE 5173

CMD ["pnpm", "dev", "--host"]