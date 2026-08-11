# Vampir Köylü — evrensel dağıtım imajı (Render, Koyeb, Fly, Railway hepsi çalıştırır)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev || true
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
