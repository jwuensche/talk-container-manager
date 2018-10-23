FROM node:10-alpine

ENV NODE_ENV=production
ADD . /app
WORKDIR /app
CMD ["node", "index.js"]
