#!/bin/sh

echo 'entrypoint.sh: Running chown for /src/data'
chown -R node:node /src/data
chown -R node:node /src/public

su - node -c 'cd /src && node index.js'
