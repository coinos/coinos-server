FROM node:15-alpine

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

RUN apk add --no-cache -U git

RUN git clone https://github.com/asoltys/coinos-server /app
WORKDIR /app
RUN yarn install

CMD ["yarn", "start"]
