FROM node:26-slim
WORKDIR /app
COPY package.json package-lock.json ./
# tsx (a dev dependency) runs the TypeScript sources directly, the same way as `npm start` locally.
RUN npm ci --include=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
ENV PORT=8787 DB_PATH=/data/phone-agent.db
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "src/server.ts"]
