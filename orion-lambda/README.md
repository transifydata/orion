# Orion Lambda

A serverless AWS Lambda function for collecting and storing GTFS realtime transit data from multiple agencies.

## Overview

This Lambda function fetches GTFS realtime vehicle positions and trip updates from configured transit agencies and stores them in S3 for later processing. The data is stored in Protocol Buffer format with timestamps for tracking historical transit data.

Orion also does this (via `save-vehicles.ts`, but we have this function as a secondary backup / failsafe in case Orion is buggy). Orion is hosted on GKE and when we have deploys or misconfigurations in the code, it will not save the realtime vehicle positions. During those down-periods, this lambda will act as the backup. 

## Configuration

The function uses this configuration:

- `AWS_REGION`: us-east-2
- `LAMBDA_FUNCTION_NAME`: orion-save
- `LAMBDA_MEMORY_SIZE`: 300MB

## Project Structure

- `src/lambda.ts` - Main Lambda function handler
- `src/lambda.test.ts` - Integration tests for the Lambda function
- `deploy-lambda.sh` - Deployment script for AWS Lambda


## Deployment

The project includes a deployment script that handles building, packaging, and deploying to AWS Lambda:

```bash
./deploy-lambda.sh
```

The deployment script will:
1. Build the TypeScript code
2. Package the function with production dependencies
3. Update Lambda configuration (memory, timeout)
4. Deploy the code to AWS Lambda
5. Clean up temporary files

## Function Details

The Lambda function:
- Processes multiple transit agencies in parallel
- Fetches both vehicle positions and trip updates (if available)
- Stores raw Protocol Buffer data in S3
- Has a 60-second timeout

## Development

To add new agencies or modify existing ones, update the config file with the appropriate GTFS realtime URLs and agency information.
