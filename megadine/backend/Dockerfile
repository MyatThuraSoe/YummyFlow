FROM node:22-alpine

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org/
COPY package*.json ./
RUN npm ci --registry=$NPM_REGISTRY

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
