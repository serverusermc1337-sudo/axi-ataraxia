FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV DATA_DIR=/data
CMD ["node", "--experimental-sqlite", "src/index.js"]
