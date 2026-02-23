# Use official Node LTS
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (cache)
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy application code
COPY server ./server
# Optional web frontend (if created) will live in /app/web
COPY web ./web

# Create data dir for SQLite and make sure it exists
RUN mkdir -p /data
VOLUME ["/data"]

ENV DB_PATH=/data/mes-menus.sqlite
ENV PORT=8080

EXPOSE 8080

# Start the app
CMD ["node", "server/index.js"]