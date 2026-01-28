FROM node:24-alpine

# ---------------------------------------------------------------------
# 1. Install System Dependencies (Added Step)
# We do this FIRST so it is cached efficiently.
# - python3 & py3-pip: Required to run twitch-dl
# - ffmpeg: Required by twitch-dl to merge video segments
# ---------------------------------------------------------------------
RUN apk add --no-cache python3 py3-pip ffmpeg build-base g++ gcompat libstdc++

# ---------------------------------------------------------------------
# 2. Install Deno (Added Step)
# We use the binary from the official Deno image.
# ---------------------------------------------------------------------
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

# ---------------------------------------------------------------------
# 3. Install twitch-dl (Pinned Version)
# We pin version 3.3.0 for SaaS stability.
# --break-system-packages is safe here because we are in a container.
# ---------------------------------------------------------------------
RUN pip3 install twitch-dl==3.3.0 --break-system-packages

WORKDIR /app

# ---------------------------------------------------------------------
# 4. Install Node Dependencies
# ---------------------------------------------------------------------
COPY package*.json ./

# Accept NODE_ENV as an build argument (defaults to production)
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Install dependencies based on environment
RUN if [ "$NODE_ENV" = "development" ]; then \
      npm install; \
    else \
      npm ci --omit=dev; \
    fi

# ---------------------------------------------------------------------
# 6. Source Code
# ---------------------------------------------------------------------
# We copy the entire src directory. This supports both individual
# services (bot/server) and the combined 'dev-bot' service.
COPY . .

# ---------------------------------------------------------------------
# 7. Build the Project
# ---------------------------------------------------------------------
# Build the TypeScript project to JavaScript
RUN npm run build
