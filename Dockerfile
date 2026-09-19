FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev

EXPOSE 3000

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

CMD ["node", "dist/index.js"]