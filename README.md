## Orion

Fetches transit data (realtime vehicle locations) and saves it to S3

## Etymology

Many TTC buses are of the Orion VII Model while Orion was also a giant huntsman that could walk on water (being Poseidon's son).

## Getting Started

See our welcome doc for contribution and deployment guidelines.
https://docs.google.com/document/d/1KTWRc4EO63_lDxjcp0mmprgrFPfFazWJEy2MwxBuw4E/edit?usp=sharing

## Usage

Orion is configured via JSON stored in the `src/config.ts` file. 

The config JSON should be an object containing the following properties:

`s3_bucket` - The name of the S3 bucket where transit data will be written.

`agencies` - An array containing an object for each transit agency. Each object in the agencies array should have the following properties:
* `id` - The ID of the transit agency, which will appear in the S3 keys written to the S3 bucket.
* `provider` - The module name in the providers directory (e.g. 'nextbus') which provides an API for real-time vehicle locations.
* Any custom properties specific to the provider, prefixed by the provider name (e.g. IDs or API keys)

Orion writes data to S3 using the AWS credentials from the default locations, e.g. a credentials file located within the Docker container at /root/.aws/credentials (using the default profile or a profile named by AWS_PROFILE), or using the environment variables AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.

In a development environment, you can set environment variables and AWS credentials by creating a file in the root of this repository named docker-compose.override.yml, e.g.:

To test, run `docker-compose up`.

## Prerequisites

Docker

## Running Orion

Orion has two parts: an API server that responds to requests from `trips-viewer` and returns the latest vehicle positions, and a "worker" that pulls data from GTFS Realtime for all agencies frequently and stores it into a SQLite database.

To run the API server: `yarn serve`

To run the worker: `yarn start`

## Deploying a test version

To deploy a test version of orion to Kubernetes without merging into master, simply push the tag "manual-deploy" to Github, and 
that tag will be automatically deployed to Kubernetes. To reset back to previous master, push an empty commit to master or 
re-run `orion-deploy-trigger` in Google Cloud Build.

