FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

# Install backend deps
COPY package*.json ./
COPY prisma ./prisma
COPY prisma-gazelle ./prisma-gazelle
RUN npm ci

# Install frontend deps
COPY client/package*.json ./client/
RUN cd client && npm ci

# Build everything (BASE_PATH bakes the sub-path prefix into the frontend bundle)
ARG BASE_PATH=""
COPY . .
RUN VITE_BASE_PATH=${BASE_PATH} npm run build

FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma-gazelle ./prisma-gazelle
COPY --from=builder /app/package.json ./package.json
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

CMD ["./entrypoint.sh"]
