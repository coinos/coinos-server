# coinos-server

Coinos is a bitcoin wallet app that supports payments over the <a href="https://bitcoin.org">bitcoin</a>, <a href="https://blockstream.com/liquid/">liquid</a> and <a href="http://lightning.network/">lightning</a> networks. Try it out at <a href="https://coinos.io/">coinos.io</a>.

This repository contains the code for the backend API server which is implemented as a NodeJS application. The code for the frontend UI is tracked separately <a href="https://github.com/asoltys/coinos.io">here</a> (but is automatically installed & started via the Docker way outlined below). 

## Install/Run (the Docker way)

### Requirements 

* <a href="https://docs.docker.com/get-docker/
">docker</a> and <a href="https://docs.docker.com/compose/install/">docker-compose</a>
* NodeJS (recommended version: 16)
* ~7GB of hard drive space (which will go into /var/lib/docker; primarily for Liquid)

### Getting Started
    git clone git@github.com:coinos/coinos-server.git
    git clone git@github.com:coinos/coinos-ui.git
    cd coinos-ui
    yarn
    cd ../coinos-server
    yarn
    cp -rf sampleconfig ./config
    cp .env.sample .env
    cp fx.sample fx
    mkdir mysql
    cp db/schema.sql mysql/
    cp sample.override.yml docker-compose.override.yml
    docker-compose up -d --force-recreate maria
    docker exec -i mariadb mysql -u root -ppassword < mysql/schema.sql   
    docker-compose up

Note the last step will take some time on first run as it will download the aforementioned docker images.

After successful creation of all docker containers coinos will be available at http://localhost:8085 

To shutdown coinos and all of its containers/services, run `docker-compose down` again.  

At anypoint to purge the database and start with a new one run `rm -rf mysql` and then `mkdir mysql` and then the same steps following from that point as outlined above.   Or run `purge-except-git.sh` from `./scripts`

To review a log of individual containers use `docker-compose app` or `docker-compose maria` etc; container names are available in `docker-compose.yml` or via `docker-compose ps` when they are running.  `docker images` will show you a list of the images installed on your system and `docker image rm [IMAGE ID]` removes them.

#### Volumes and local filesystem changes

The `docker-compose.yml` specifies volumes that map to the host (ie- your local machine).  As per Docker's <a href="https://docs.docker.com/storage/volumes/">volume feature</a> these override what is in the container's 'virtual' filesystem for those folders and instead will map to what is on your local filesystem.  As such, changes/developments that occur in these locations will be reflected without needing to restart the containers. 

Additionally <a href="https://github.com/remy/nodemon">Nodemon</a> is setup by default to watch coinos-server directory and will auto-restart the app as changes occur. 

Alternative to allowing nodemon to manage the app, you may enter bash on the docker to start/stop the node app manually ie: 

    docker exec -it app bash
    node index.js 
    # ^ starts app manually in a bash session inside the docker
    # ( reflecting your local coinos-server directory)


To prevent nodemon from starting with the container change the `package.json` `"start"` script value to: `"tail -f /dev/null"` which will then keep the container alive so you may enter an interactive bash as above to start the app manually. 

#### Debugging

To debug the node app while it is running via Docker, edit `docker-compose.yml` to add `9229` to the ports section for the `app` service: 

    ports:
      - '3119:3119'
      - '9229'

then get the IP of the app container: 

    docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' app
    > 192.168.115.72 #outputs the coinos app container IP

then edit `package.json` start script to: 

    "start" : "nodemon --inspect=0.0.0.0 index.js",

(or use the interactive bash technique above with this same inspect flag)

restart with `docker-compose restart app`

then open your browser (Chrome in this example) to the URL`chrome://inspect` then click "Configure" and add the IP address + debugger port to the list of targets ex- `192.168.115.72:92229`

an inspect link will then display under 'Remote Target'!

  Note the IP address may change between restarts so you may have to rerun the docker inspect command above again to make sure you have the correct IP on following sessions. 

----

### Install/Run (standalone)

Note the Docker way outlined above is recommended as manual setup requirements/instructions shown below are out of date. 


#### Requirements

* <a href="https://github.com/bitcoin/bitcoin">bitcoind</a> with zmq support
* <a href="https://github.com/ElementsProject/elements">elementsd</a> with zmq support
* <a href="https://github.com/lightningnetwork/lnd">lnd</a> or <a href="https://github.com/elementsproject/lightning">c-lightning</a>
* a database that <a href="https://github.com/sequelize/sequelize">sequelize</a> can talk to

The bitcoind and elementsd nodes can be a pruned if you want to limit the amount of disk space used.

#### Getting Started

    git clone git@github.com:coinos/coinos-server.git
    cd coinos-server
    cp -rf sampleconfig ./config    # edit config files as necessary for your local setup
    cp .env.sample .env
    yarn
    yarn start 
    # or, alternatively
    yarn min    # to run a stripped down development version that doesn't do payments or talk to any nodes

#### Database Setup

I've only tested with <a href="https://mariadb.org/">Maria</a>. Here's a [schema](https://github.com/asoltys/coinos-server/blob/master/db/schema.sql) to get you started.

    cat db/schema.sql | mysql -u root -p
