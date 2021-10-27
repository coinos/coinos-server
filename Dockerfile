FROM node:alpine

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

RUN apk add git
RUN apk add --update npm
RUN npm i -g pnpm

COPY . /app
WORKDIR /app

RUN pnpm i

CMD ["pnpm", "start"]
