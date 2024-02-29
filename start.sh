#!/bin/bash

echo "Running start.sh"

export NODE_ENV=production

if [ "$IS_SERVER" = "true" ]; then
    npm run serve --prod
else
    npm run start --prod
fi