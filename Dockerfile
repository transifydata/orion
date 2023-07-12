FROM node:20

# Create app directory
WORKDIR /usr/src/app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Bundle app source
COPY . .

ENTRYPOINT [ "bash", "start.sh" ]

# Build
# docker build -t orion .

# Run
# docker run orion:latest
