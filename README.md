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

## orion-database.db volume

`yarn start` continually fetches GTFS RT data and appends it to a sqlite database `orion-database.db`. Currently, this 
database is stored in a volume and mounted at the `/data` directory to the container (see `orion-deployment.yaml`).

The volume is allocated with 300GB SSD (see `persistent-volume-claim.yaml`). To increase the size of the volume,
you can modify the `resources.requests.storage` field in `persistent-volume-claim.yaml` and then run `kubectl apply -f kubernetes/`.

To check the size of the database, SSH into any pod in `orion-api-deployment` and run `ls -lh /data`.

## Deploying a test version

To deploy a test version of orion to Kubernetes without merging into master, simply push the tag "manual-deploy" to Github, and 
that tag will be automatically deployed to Kubernetes. To reset back to previous master, push an empty commit to master or 
re-run `orion-deploy-trigger` in Google Cloud Build.


## Local Testing

### Method 1: Run `yarn start` to populate local db

Orion maintains a database of GTFS RT live vehicles feed. If you want to debug things locally, you will not have that database
as only prod continually pulls from GTFS RT. Your own `orion-database.db` locally will be empty. To test locally, you can
do `yarn start` for a few minutes to populate your local database with some real-time data. Then you can run `yarn serve`
to test the local endpoints.

### Method 2: Use `localtesting.ts` script

Modify the `localtesting.ts` script to run the specific things you want to test. For example, feed in specific GTFS RT data 
or get a specific feed with `UpdatingGtfsFeed.getFeed(...)`. To run the script, run `tsx src/localtesting.ts` in the terminal.

If you are using Webstorm and want to use the debugger, create a Node configuration with Node parameters:

`--loader tsx src/localtesting.ts`

I recommend modifying this script to test out specific date edge cases (e.g. midnight). 


## Downloading orion-database.db

You can now download the remote orion-database.db file locally to view historical GTFS RT data. Since the file is upwards of 60GBs, it's infeasible to download it over SSH. But now, we are taking
daily snapshots of this file and storing it in S3.

To download and replicate a copy of the GTFS RT data available, use the script `scripts/download-db.ts`

```
# Download the database from a specific date range
tsx scripts/download-db.ts {YYYYMMDD} {YYYYMMDD}
```

Once the database is downloaded, you should see a log line `Database downloaded to ${path}`. This path contains all the 
vehicle locations from the given range. 

To merge it into the main `orion-database.db` which serves production traffic, you can use the `sqlite3` command line tool.
Refer to `mergeInto()` implementation for more details. 

```
# Merge the downloaded database into the main database
sqlite3 orion-database.db

sqlite> ATTACH 'path/to/downloaded-db.db' AS downloaded;
sqlite> INSERT OR IGNORE INTO vehicle_position SELECT * FROM downloaded.vehicle_position;
sqlite> INSERT OR IGNORE INTO trip_update SELECT * FROM downloaded.trip_update;
```

## Making a manual snapshot

By default, snapshots are made on a daily basis inside `pruneDb()`. If you want to make a manual snapshot or backfill
snapshots, then refer to `fetch-snapshots.ts` script.


# Observability

Logs: https://console.cloud.google.com/logs/query;query=resource.type%3D%22k8s_container%22%0Aresource.labels.cluster_name%3D%22metrics-mvp-cluster%22%0Aresource.labels.container_name%3D%22orion-api%22%0Aresource.labels.namespace_name%3D%22default%22%0A--Hide%20similar%20entries%0A-%2528textPayload%3D~%22GET%20%2F%20%2528%2528%3F:%5Cd%5B,.%5D%3F%2529*%5Cd%2529%20%2528%2528%3F:%5Cd%5B,.%5D%3F%2529*%5Cd%2529%20-%20%2528%2528%3F:%5Cd%5B,.%5D%3F%2529*%5Cd%2529%20ms%22%2529%0A--End%20of%20hide%20similar%20entries;cursorTimestamp=2025-03-20T17:52:30.997232586Z;duration=PT5M?referrer=search&project=busviz


Vehicle Positions saved rate: https://console.cloud.google.com/monitoring/alerting/policies/17495653405858143773?project=busviz
