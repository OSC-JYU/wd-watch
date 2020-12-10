FROM node:12-alpine

# Install app dependencies
RUN apk update && apk add bash
COPY package.json /src/package.json
RUN cd /src; npm install

COPY . /src
WORKDIR /src
EXPOSE  8200

ENTRYPOINT ["/bin/sh", "entrypoint.sh"]

CMD ["node", "index.js"]
