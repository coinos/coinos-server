# Coinos

Coinos is a web-based bitcoin and nostr client. You can use it as a front end to your personal bitcoin and lightning nodes or host a public instance that allows anyone to register with a username and password. Try ours at https://coinos.io

This repository contains the code for the API server. The frontend code is at <a href="https://github.com/coinos/coinos-ui">https://github.com/coinos/coinos-ui</a>

## Requirements

- Make sure you have <a href="https://docs.docker.com/get-docker/">Docker</a> installed in your system..

## Quick Install

1. Start the Docker application.

2. Run this start up script:
```bash
chmod +x setup.sh
./setup.sh
```

The above script will setup docker containers for the different components that Coinos needs to run.

## Understanding Coinos:

Coinos comprises of the folowing components:
- **The Coinos Server:** This is the main server implementation that setups and handles the API requests. Depends on the Bitcoin node, the Lightning node and the database.
- **[Bitcoin node](https://github.com/bitcoin/bitcoin):** This is the Bitcoin Core implementation that upholds the chains consensus rules.
- **[Liquid Implementation](https://liquid.net/):** This is a Bitcoin layer-2 network that uses Bitcoin as its native asset and allows users to issue their own assets.
- **[Core Lightning](https://docs.corelightning.org/docs/home):** This is also a Bitcoin layer-2 network that facilitates lightning fast Bitcoin payments via the Lightning Network protocol.
- **[KeyDB](https://docs.keydb.dev/):** KeyDB is a high performance fork of Redis with a focus on multithreading, memory efficiency, and high throughput.
- **[Nostr](https://nostr.com/):** Nostr is a simple, open protocol that enables global, decentralized, and censorship-resistant social media.
- **[Cashu Nutshell](https://github.com/cashubtc/nutshell):** Nutshell is an Ecash wallet and mint for Bitcoin Lightning based on the Cashu protocol.

A complete Coinos site utilizes all of the above components to support it's features. However, 
its important to note the most important ones: **Coinos Server**, **Bitcoin node**, **Core Lightning** and **KeyDB**. Without these, 
none of the Coinos features would work and would probably not start. If you want to run thin, you can remove the other containers 
from the setup(You will get to see where to do this later). 

### How Coinos Works

Running the startup script does a few tasks for you in the background. The tasks are performed in this order:

1. A `config.ts` file is created and it's contents copied from the sample file `config.ts.sample`. This file holds the configuration options 
the various Coinos components discussed above.

2. A `compose.yml` file is created and it's contents copied from the sample file `compose.yml.sample`. This file conatins instructions 
on the various Docker containers required to start Coinos. You will also notice duplicate component containers with different names such as cl,clb and clc. These are meant to easen the testing and development process locally as you can simulate transactions and connections.

3. A folder `data` is created and it's contents copied from the `sampledata` folder. This directory contains various folders for the different components integrated by Coinos. This is where you will find specific configurations and settings for the different components such as Bitcoin and Lightning.

4. Finally, the various Docker containers configured above are started  and the Coinos server application is run. At this point, all containers should be running, otherwise it could indicate a problem with the previous tasks execution. You can check your container's status by running this command: `docker ps -a`.

5. Bitcoin needs a wallet and to be synced to the blockchain to work. The startup script creates a Bitcoin wallet and rescans the blockchain to update it's state. By default, the chain is set to `regtest` so we also generate a few blocks and an address to get going.

6. Liquid requires a wallet also, thus we generate one for it.

Basically, the startup script automates tasks you would have done manually and easen the process. You can also add your own custom commands that you would like executed when starting up.

### Tips
