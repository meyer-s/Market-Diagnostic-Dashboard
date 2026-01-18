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
COPY public ./public
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY tailwind.config.js postcss.config.js ./

RUN pnpm vite build

EXPOSE 5173

CMD ["pnpm", "preview", "--host", "0.0.0.0", "--port", "5173"]
