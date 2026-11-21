FROM node:22-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY server.mjs ./
COPY web web
COPY library library
COPY examples examples
USER node
EXPOSE 8080
CMD ["node", "server.mjs", "8080"]
