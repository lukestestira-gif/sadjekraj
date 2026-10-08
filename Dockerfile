FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 SALON_TIME_ZONE=Europe/Belgrade
COPY package.json ./
COPY server.js ./
COPY public ./public
COPY data ./data
RUN mkdir -p data public/uploads && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "require('http').get('http://127.0.0.1:3000/api/public',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
