FROM node:20

# Create app directory
WORKDIR /usr/src/app

# Install dependencies
COPY package.json yarn.lock ./
RUN yarn

# Bundle app source
COPY . .

ENTRYPOINT [ "bash", "start.sh" ]

# Build
# docker build -t orion .

# Run
# docker run orion:latest
