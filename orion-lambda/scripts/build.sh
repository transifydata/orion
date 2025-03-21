#!/bin/bash

# Exit on error
set -e

# Clean dist directory
rm -rf dist
mkdir -p dist

# Build TypeScript code
npm run build

# Copy package files
cp package.json README.md dist/

# Install production dependencies in dist
cd dist
npm install --production
cd ..

# Create deployment package
cd dist
zip -r ../lambda.zip .
cd ..

echo "Build completed successfully! Deployment package is available at lambda.zip" 