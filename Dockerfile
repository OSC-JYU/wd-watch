FROM node:24-alpine

# Install app dependencies
RUN apk update && apk add bash
COPY package.json /src/package.json
RUN cd /src; npm install

COPY . /src
RUN chown -R node:node /src && chmod -R a+rX /src
WORKDIR /src
EXPOSE  8200

ENTRYPOINT ["/bin/sh", "entrypoint.sh"]

CMD ["npm", "start"]
