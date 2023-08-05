import {migrateDbs, writeToSink, writeTripUpdatesToSink} from "./sinks/sqlite-sink";
import {writeToS3} from './sinks/s3Helper';
import * as NextBus from './providers/nextbus'
import * as Realtime from './providers/gtfs-realtime'
import {parseGTFS, resetGtfs} from "./gtfs-parser";
import {config} from "./config";
import {resetGtfsIfNeeded} from "./reset-gtfs";

const interval = 10000; // ms


export interface Agency {
    id: string,
    provider: string,
    gtfs_realtime_url?: string,
    tripUpdatesUrl?: string,
    nextbus_agency_id?: string
}

if (!config || !config.agencies || !config.agencies.length) {
    throw new Error("No agencies specified in config.");
}

if (!config.s3_bucket) {
    throw new Error("No s3_bucket specified in config.");
}

const providerNames = [
    'nextbus',
    'gtfs-realtime',
];

const providers: Record<string, any> = {
    'nextbus': NextBus,
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




async function saveVehicles() {
    await resetGtfsIfNeeded();

    const promises = agenciesInfo.map((agencyInfo) => {
        console.log("Working on", agencyInfo.id)
        const providerCode = providers[agencyInfo.provider];

        if (!providerCode) throw new Error("Invalid provider name")

        const currentTime = Date.now();

        if (agencyInfo.tripUpdatesUrl !== undefined) {
            providerCode.getTripUpdates(agencyInfo).then(updates => {
                return writeTripUpdatesToSink(agencyInfo, currentTime, updates);
            }).catch(err => {
                throw err
            })
        }
        return providerCode.getVehicles(agencyInfo)
            .then((vehicles) => {
                writeToSink(agencyInfo, currentTime, vehicles);
                return writeToS3(s3Bucket, agencyInfo.id, currentTime, vehicles);
            })
            .catch((err) => {
                console.log(err);
            });
    });

    await Promise.all(promises);

    return;
}

function saveVehiclesRepeat(){

    saveVehicles().then(() => {
        setTimeout(saveVehiclesRepeat, interval);
    })
}


async function start() {
    // Uncomment to load the GTFS (it's currently loaded and already exists in gtfs.db
    await parseGTFS();
    await migrateDbs();
    saveVehiclesRepeat();
}

start().catch(e => {
    console.error("Exception " + e)
    throw e;
});