# Orion Lambda

A serverless AWS Lambda function for collecting and storing transit vehicle data from GTFS realtime feeds.

## Overview

This Lambda function fetches GTFS realtime vehicle positions and trip updates from configured transit agencies and stores them in S3 for backup and analysis. The data is saved in Protocol Buffer format with timestamps for tracking historical transit data.

## Features

- Parallel processing of multiple transit agencies
- Handles both vehicle positions and trip updates
- Automatic error handling and logging
- Configurable memory and timeout settings
- S3 backup storage

## Prerequisites

- Node.js (Latest LTS version recommended)
- Yarn package manager
- AWS CLI installed and configured
- AWS credentials with appropriate permissions for Lambda and S3

## Installation

1. Clone the repository
2. Install dependencies:
```bash
yarn install
```

## Configuration

The Lambda function requires the following configuration:

- AWS Region: us-east-2 (default)
- S3 Bucket: orion-vehicles-backup
- Lambda Function Name: orion-save
- Memory Size: 150MB
- Timeout: 60 seconds

Agency configuration should be provided through the `config.ts` file with the following structure:

```typescript
{
  id: string;
  gtfs_realtime_url: string;
  tripUpdatesUrl?: string;
}
```

## Development

The project is written in TypeScript and uses the following main dependencies:

- aws-lambda: ^1.0.7
- aws-sdk: ^2.238.1
- axios: ^1.4.0

To build the TypeScript code:

```bash
yarn build
```

## Testing

Run tests using Vitest:

```bash
yarn test
```

## Deployment

Deploy the Lambda function using the provided script:

```bash
yarn deploy-lambda
```

The deployment script will:
1. Build the TypeScript code
2. Install production dependencies
3. Create a deployment package
4. Update Lambda configuration
5. Deploy the code to AWS Lambda

## Error Handling

The Lambda function includes comprehensive error handling:
- Invalid provider errors return 400 status code
- Other errors return 500 status code
- All errors are logged with agency context

## License

[Add your license here]

## Contributing

[Add contribution guidelines here]
