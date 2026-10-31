FROM node:22-alpine
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
ENV DATA_DIR=/data PORT=3000
VOLUME /data
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
