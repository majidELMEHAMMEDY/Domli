FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
USER node
EXPOSE 3100
CMD ["node", "src/index.js"]
