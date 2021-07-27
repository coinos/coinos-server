#!/bin/bash
# purge coinos-ui and coinos-server 
# ie- fresh install/clean working dirs but without the clone -
# useful for local dev when you have stashed changes or branches
# you don't want to destroy

# start script from coinos-server/scripts ie: 
# $ cd /var/node/coinos-server/scripts
# $ ./purge-except-git.sh

# you may have to run it with sudo to remove the directories created by docker

# and now the script will move up a dir and do its thing: 
cd ../

# if you have docker-compose process running
docker-compose down

#purge: 
rm -rf config
rm -rf mysql
rm -rf node_modules
rm .env 
rm fx
rm docker-compose.override.yml

#also on ui: 
cd ../coinos-ui
rm -rf node_modules

# (and then follow instructions in root README to rebuild/install)
