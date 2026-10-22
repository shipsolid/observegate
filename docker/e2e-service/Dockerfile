FROM node:24-alpine

WORKDIR /app
COPY package.json server.js ./
USER 1000:1000
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=2s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
CMD ["node", "server.js"]
