#!/bin/bash

# This script is used to deploy the Orion Lambda function to AWS.
# It will build the TypeScript code, package it, and deploy it to AWS.
# It will also update the Lambda function configuration.

export AWS_PAGER=""

# Set the memory size for the Lambda function in MB
export LAMBDA_MEMORY_SIZE=150

# Exit on error
set -e
node --version

export AWS_REGION=us-east-2
export LAMBDA_FUNCTION_NAME=orion-save
# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if Yarn is installed
if ! command -v yarn &> /dev/null; then
    echo "Yarn is not installed. Please install it first."
    exit 1
fi



# Build TypeScript code
echo "Building TypeScript code..."
yarn build

# Create a temporary directory for packaging
# cp -r dist/* dist
cp package.json dist
cp yarn.lock dist

# Install production dependencies in the temporary directory
cd dist
yarn install --production
echo "Creating deployment package... dist"

zip -r ../function.zip .
cd ..

# Update Lambda configuration
echo "Updating Lambda configuration..."
aws lambda update-function-configuration \
    --function-name "orion-save" \
    --timeout 60 \
    --memory-size $LAMBDA_MEMORY_SIZE \
    --region us-east-2 


# Deploy to Lambda
echo "Deploying to Lambda..."
aws lambda update-function-code \
    --function-name "orion-save" \
    --zip-file fileb://function.zip \
    --region us-east-2 


# Clean up
rm -rf function.zip

echo "Deployment completed successfully!" 