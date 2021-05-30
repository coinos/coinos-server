FROM node:slim

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

RUN apt-get update
RUN apt-get install git make gcc g++ python libzmq3-dev -y

RUN git clone https://github.com/asoltys/coinos-server /app
WORKDIR /app

RUN yarn install

ENV SHELL /bin/bash

CMD ["yarn", "start"]
