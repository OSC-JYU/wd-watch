#!/bin/sh

echo 'entrypoint.sh: Running chown for /src'
chown -R node:node /src

echo 'entrypoint.sh: Running chown for /src/data'
chown -R node:node /src/data
chown -R node:node /src/public

APP_PORT=${PORT:-8200}
echo "entrypoint.sh: Starting WD-watch on port ${APP_PORT}"
su - node -c "cd /src && PORT=${APP_PORT} npm start"
