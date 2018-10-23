FROM node:10-alpine

ENV NODE_ENV=production
ADD . /app
WORKDIR /app
RUN npm ci
CMD ["node", "index.js"]
