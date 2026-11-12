FROM node:22-alpine

WORKDIR /app

# postgresql-client provides pg_dump/psql so backups talk straight to
# DATABASE_URL (no Docker socket needed). tzdata gives Node the IANA zones the
# restaurant time zone setting relies on. APK_MIRROR lets an offline/restricted
# network point apk at a reachable mirror.
ARG APK_MIRROR=dl-cdn.alpinelinux.org
RUN sed -i "s#dl-cdn.alpinelinux.org#${APK_MIRROR}#g" /etc/apk/repositories \
    && apk add --no-cache postgresql-client tzdata

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
