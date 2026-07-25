FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 HOST=0.0.0.0
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 8080
CMD ["npm", "start"]
