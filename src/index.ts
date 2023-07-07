import {writeTripUpdatesToSink} from "./sinks/sqlite-sink";
import fs, {PathOrFileDescriptor} from 'fs';

import {writeToSink, migrateDbs, getVehicleLocations} from "./sinks/sqlite-sink";
// const axios = require('axios');
// const s3Helper = require('./sinks/s3Helper');

const interval = 15000; // ms

const configPath = process.env.ORION_CONFIG_PATH;
let configJson = process.env.ORION_CONFIG_JSON;

export interface Agency {
    id: string,
    provider: string,
    gtfs_realtime_url?: string,
    gtfs_vehiclepositions_url?: string,
    nextbus_agency_id?: string
}

if (!configJson && !configPath) {
    configJson = JSON.stringify({
        "s3_bucket": "orion-vehicles",
        "agencies": [
            {
                "id": "brampton",
                "provider": "gtfs-realtime",
                "gtfs_realtime_url": "https://nextride.brampton.ca:81/API/VehiclePositions?format=gtfs.proto"
            },
            // {
            //     "id": "ttc",
            //     "provider": "nextbus",
            //     "nextbus_agency_id": "ttc"
            // },
            // {
            //     "id": "grt",
            //     "provider": "gtfs-realtime",
            //     "gtfs_realtime_url": "http://webapps.regionofwaterloo.ca/api/grt-routes/api/vehiclepositions",
            //     "gtfs_vehiclepositions_url": "https://webapps.regionofwaterloo.ca/api/grt-routes/api/tripupdates"
            // },
            // {
            //     "id": "peterborough",
            //     "provider": "gtfs-realtime",
            //     "gtfs_realtime_url": "http://pt.mapstrat.com/current/gtfrealtime_VehiclePositions.bin"
            // },
            // {
            //     "id": "barrie",
            //     "provider": "gtfs-realtime",
            //     "gtfs_realtime_url": "http://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb"
            // }
            // TODO: add GO transit
        ]
    })
    // throw new Error("Missing ORION_CONFIG_JSON or ORION_CONFIG_PATH environment variable");
}

let config: {s3_bucket: string, agencies: Agency[]};
if (configJson) {
    console.log("reading config from ORION_CONFIG_JSON");
    config = JSON.parse(configJson);
} else {
    console.log("reading config from " + configPath);
    config = JSON.parse(fs.readFileSync(configPath as PathOrFileDescriptor).toString());
}

if (!config || !config.agencies || !config.agencies.length) {
    throw new Error("No agencies specified in config.");
}

if (!config.s3_bucket) {
    throw new Error("No s3_bucket specified in config.");
}

const providerNames = [
    'nextbus',
    'marin',
    'gtfs-realtime',
];
import * as NextBus from './providers/nextbus'
import * as Marin from './providers/marin'
import * as Realtime from './providers/gtfs-realtime'
import * as assert from "assert";

const providers: Record<string, any> = {
    'nextbus': NextBus,
    'marin': Marin,
    'gtfs-realtime': Realtime
}

const s3Bucket = config.s3_bucket;
console.log("S3 bucket: " + s3Bucket);

var agenciesInfo = config.agencies.map((agencyConfig) => {
    const providerName = agencyConfig.provider;
    if (!providerNames.includes(providerName)) {
        throw new Error("Invalid provider: " + providerName);
    }


    const agencyId = agencyConfig.id;
    if (!agencyId) {
        throw new Error("Agency missing id");
    }

    console.log("Agency: " + agencyId + " (" + providerName + ")");

    return agencyConfig;
});

// wait until the next multiple of 15 seconds
// setTimeout(function() {
//     setInterval(saveVehicles, interval);
//     saveVehicles();
// }, interval - Date.now() % interval);

function saveVehicles() {

  const promises = agenciesInfo.map((agencyInfo) => {
    console.log("Working on", agencyInfo.id)
    const providerCode = providers[agencyInfo.provider];

    if (!providerCode) throw new Error("Invalid provider name")

    const currentTime = Date.now();

    if (agencyInfo.gtfs_vehiclepositions_url !== undefined) {
        console.log("Getting trip updates", providerCode)
        providerCode.getTripUpdates(agencyInfo).then(updates => {
            return writeTripUpdatesToSink(agencyInfo, currentTime, updates);
        }).catch(err => {throw err})
    }
    return providerCode.getVehicles(agencyInfo)
      .then((vehicles) => {
          writeToSink(agencyInfo, currentTime, vehicles);
        // return s3Helper.writeToS3(s3Bucket, agencyInfo.id, currentTime, vehicles);
      })
      .catch((err) => {
        console.log(err);
      });
  });

  Promise.all(promises);
}


async function start() {
    await migrateDbs();
    saveVehicles();

}

start().catch(e => {
    console.error("Exception " + e)
    throw e;
});