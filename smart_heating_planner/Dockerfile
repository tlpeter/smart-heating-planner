FROM node:25-alpine

WORKDIR /app

# Install exactly the versions in package-lock.json (with integrity checks).
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY app/ ./

CMD ["node", "server.js"]
