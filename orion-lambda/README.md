# Orion Lambda Package

This package contains the AWS Lambda function for the Orion transit data collection system. It provides a streamlined version of the Orion application's functionality, focusing only on S3 storage of transit data.

## Installation

```bash
npm install orion-lambda
```

## Usage

The package exports the following:

```typescript
import { handler } from 'orion-lambda';
import type { Agency } from 'orion-lambda';

// Example agency configuration
const agency: Agency = {
    id: "example-transit",
    provider: "gtfs-realtime",
    gtfs_realtime_url: "https://example.com/vehicle-positions",
    tripUpdatesUrl: "https://example.com/trip-updates"
};

// The handler can be used directly in AWS Lambda
export const lambdaHandler = handler;
```

## Configuration

The Lambda function requires the following environment variables:

- `S3_BUCKET`: The name of the S3 bucket where transit data will be stored
- AWS credentials should be configured through Lambda execution role

## Lambda Event Format

The Lambda function expects an event with the following structure:

```json
{
  "agency": {
    "id": "agency-id",
    "provider": "provider-name",
    "gtfs_realtime_url": "url-for-gtfs-realtime",
    "tripUpdatesUrl": "url-for-trip-updates"
  }
}
```

## Development

1. Install dependencies:
```bash
npm install
```

2. Build the package:
```bash
npm run build
```

3. Run tests:
```bash
npm test
```

## S3 Storage Format

Vehicle data is stored in S3 with the following key format:
`{agency-id}/{year}/{month}/{day}/{hour}/{minute}/{second}/{agency-id}-{timestamp}.json.gz`

The data is stored in gzipped JSON format with GTFS-realtime protobuf data.

## Error Handling

The Lambda function includes comprehensive error handling:
- Validates required environment variables
- Validates required agency configuration fields
- Handles network errors when fetching GTFS data
- Provides detailed error messages in the response

## Response Format

Successful response (200):
```json
{
  "message": "Successfully saved vehicle data to S3",
  "timestamp": 1234567890,
  "vehiclesResponseSize": 42,
  "hasTrips": true
}
```

Error response (400/500):
```json
{
  "message": "Error saving vehicle data to S3",
  "error": "Detailed error message",
  "agency": "agency-id"
}
``` 