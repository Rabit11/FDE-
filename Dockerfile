# Use local image (has Node 20) to avoid Docker Hub pull timeouts
FROM fde-platform-backend:latest

WORKDIR /app

# Clear previous app leftovers from base image (best-effort)
RUN rm -rf /app/src /app/prisma /app/public /app/server 2>/dev/null || true

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY .env.example ./

RUN mkdir -p /app/data/uploads \
  && if [ ! -f /app/.env ]; then cp .env.example .env; fi

ENV NODE_ENV=production
ENV PORT=8084
EXPOSE 8084

CMD ["node", "server/index.js"]
