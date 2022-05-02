FROM node:16.14.2-alpine

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

RUN apk add bash
RUN apk add git
RUN apk add --update npm
RUN npm i -g pnpm

COPY . /app
WORKDIR /app

RUN pnpm i