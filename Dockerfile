FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ ffmpeg

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

RUN mkdir -p uploads

EXPOSE 3000

CMD ["node", "src/app.js"]
