#!/bin/bash

# Exit on error
set -e
node --version

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
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

# Build Lambda package
echo "Building Lambda package..."
yarn build:lambda

# Deploy to Lambda
echo "Deploying to Lambda..."
aws lambda update-function-code \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --zip-file fileb://orion-lambda/lambda.zip \
    --region "$AWS_REGION"

# Update Lambda configuration with environment variables
aws lambda update-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --environment "Variables={S3_BUCKET=$S3_BUCKET}" \
    --region "$AWS_REGION"

echo "Deployment completed successfully!" 