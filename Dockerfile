FROM node:23.10

# Create app directory
WORKDIR /usr/src/app

# Install dependencies
COPY package.json yarn.lock ./
COPY orion-lambda/ ./orion-lambda/
RUN yarn

# Bundle app source
COPY . .

ENTRYPOINT [ "bash", "start.sh" ]

# Build
# docker build -t orion .

# Run
# docker run orion:latest
