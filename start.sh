#!/bin/bash

echo "Running start.sh"

if [ "$IS_SERVER" = "true" ]; then
    npm run serve
else
    npm run start
fi