#!/bin/sh

echo 'entrypoint.sh: Running chown for /src/data'
chown -R node:node /src/data

#runuser node -c 'node index.js'
su - node -c 'cd /src && node index.js'
