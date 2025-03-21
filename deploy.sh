#!/bin/bash

# Exit on error
set -e
node --version

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

# Check if required environment variables are set
if [ -z "$AWS_REGION" ]; then
    echo "AWS_REGION is not set"
    exit 1
fi

if [ -z "$S3_BUCKET" ]; then
    echo "S3_BUCKET is not set"
    exit 1
fi

if [ -z "$LAMBDA_FUNCTION_NAME" ]; then
    echo "LAMBDA_FUNCTION_NAME is not set"
    exit 1
fi

# Clean and create dist directory
rm -rf dist
mkdir -p dist

# Build TypeScript code
echo "Building TypeScript code..."
node --version
yarn build:lambda

# Create a temporary directory for packaging
TEMP_DIR=$(mktemp -d)
cp -r dist/* "$TEMP_DIR/"
cp package.json "$TEMP_DIR/"
cp yarn.lock "$TEMP_DIR/"

# Install production dependencies in the temporary directory
cd "$TEMP_DIR"
yarn install --production --frozen-lockfile
cd -

# Create ZIP file
echo "Creating deployment package... $TEMP_DIR"
cd "$TEMP_DIR"
# zip -r ../function.zip .
# cd -

# # Deploy to Lambda
# echo "Deploying to Lambda..."
aws lambda update-function-code \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --zip-file fileb://function.zip \
    --region "$AWS_REGION"

# # Update Lambda configuration with environment variables
# aws lambda update-function-configuration \
#     --function-name "$LAMBDA_FUNCTION_NAME" \
#     --environment "Variables={S3_BUCKET=$S3_BUCKET}" \
#     --region "$AWS_REGION"

# # Clean up
# rm -rf "$TEMP_DIR" function.zip

# echo "Deployment completed successfully!" 