# Orion Lambda Function

This Lambda function is designed to fetch and save vehicle data directly to S3 for a single transit agency. It uses a streamlined version of the Orion application's functionality, focusing only on S3 storage without SQLite database operations.

## Deployment

1. Build the Lambda package:
```bash
npm run build:lambda
```

2. The build will be available in the `dist` directory. Zip the contents:
```bash
cd dist
zip -r ../lambda.zip .
```

3. Upload the `lambda.zip` to AWS Lambda.

## Configuration

The Lambda function expects an event with the following structure:

```json
{
  "agency": {
    "id": "agency-id",
    "provider": "provider-name",
    "gtfs_realtime_url": "url-for-gtfs-realtime",
    "tripUpdatesUrl": "url-for-trip-updates",
    "nextbus_agency_id": "nextbus-id"
  }
}
```

Note: Only include the fields relevant to your agency's provider type.

## AWS Lambda Configuration

Required environment variables:
- `AWS_ACCESS_KEY_ID`: AWS access key for S3 access
- `AWS_SECRET_ACCESS_KEY`: AWS secret key for S3 access
- `S3_BUCKET`: S3 bucket name for storing vehicle data

Recommended Lambda settings:
- Memory: 256MB minimum (reduced from original since no database operations)
- Timeout: 10 seconds
- Runtime: Node.js 18.x

## Example CloudWatch Event Rule

To run the Lambda function every 5 minutes for a specific agency:

```json
{
  "agency": {
    "id": "example-transit",
    "provider": "gtfs-realtime",
    "gtfs_realtime_url": "https://example.com/vehicle-positions",
    "tripUpdatesUrl": "https://example.com/trip-updates"
  }
}
```

## Response Format

Successful response (200):
```json
{
  "message": "Successfully saved vehicle data to S3 for agency example-transit",
  "vehiclesCount": 42,
  "timestamp": 1234567890
}
```

Error response (500):
```json
{
  "message": "Error saving vehicle data to S3",
  "error": "Detailed error message"
}
```

## Error Handling

The function will:
1. Return a 200 status code on successful execution with vehicle count and timestamp
2. Return a 500 status code with error details on failure
3. Log errors to CloudWatch Logs

## Monitoring

Monitor the function using CloudWatch Metrics and Logs:
- Invocation count
- Error count
- Duration
- Memory usage
- Vehicle count per execution (via custom metrics) 