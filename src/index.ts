import {writeToSink, writeTripUpdatesToSink} from "./sinks/sqlite-sink";
import NextBus from "./providers/nextbus";
import Realtime from "./providers/gtfs-realtime";
import {config} from "./config";
import {UpdatingGtfsFeed} from "./updating-gtfs-feed";
import {writeToS3} from "./sinks/s3Helper";
import {migrateDbs} from "./sinks/sqlite-tools";

const interval = 5000; // ms

export interface Agency {
    id: string;
    provider: string;
    gtfs_realtime_url?: string;
    tripUpdatesUrl?: string;
    nextbus_agency_id?: string;
}

if (!config || !config.agencies || !config.agencies.length) {
    throw new Error("No agencies specified in config.");
}

if (!config.s3_bucket) {
    throw new Error("No s3_bucket specified in config.");
}

export interface Provider {
    getVehicles: (config: Agency) => Promise<any>;
    getTripUpdates: (config: Agency) => Promise<any>;
}

const providerNames = ["nextbus", "gtfs-realtime"];

const providers: Record<string, Provider> = {
    nextbus: NextBus,
    "gtfs-realtime": Realtime,
};

const s3Bucket = config.s3_bucket;
console.log("S3 bucket: " + s3Bucket);

var agenciesInfo = config.agencies.map(agencyConfig => {
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

async function saveVehicles() {
    const promises = agenciesInfo.map(async agencyInfo => {
        const unixTime = Date.now();
        const providerCode = providers[agencyInfo.provider];
        let savingFailed = false;
        try {
            console.log("Working on", agencyInfo.id);
            const db = await UpdatingGtfsFeed.getFeed(agencyInfo.id, Date.now());
            
            if (!providerCode) throw new Error("Invalid provider name");

            if (agencyInfo.tripUpdatesUrl !== undefined) {
                await providerCode.getTripUpdates(agencyInfo).then(updates => {
                    return writeTripUpdatesToSink(db, agencyInfo, unixTime, updates);
                });
            }
            await providerCode.getVehicles(agencyInfo).then(vehicles => {
                return writeToSink(db, agencyInfo, unixTime, vehicles).then(() => {
                    return writeToS3(s3Bucket, agencyInfo.id, unixTime, vehicles).catch(e => {
                        console.log("Error saving to S3: ", e)
                    })
                });
            });
        } catch (e) {
            // todo: report these errors to an error tracking service
            // Use console.log instead of console.error as to avoid downtime from Kubernetes restarts (10-sec or more)
            console.log("Error saving vehicles / trip updates for " + agencyInfo.id + " " + e);
            savingFailed = true;
            // throw e; 
        }
        if (savingFailed) {
            try {
                if (!providerCode) throw new Error("Invalid provider name");
                await providerCode.getVehicles(agencyInfo).then(vehicles => {
                    return writeToS3(s3Bucket, agencyInfo.id, unixTime, vehicles).catch(e => {
                        console.log("Error saving to S3: ", e)
                    });
                });
            } catch (e) {
                console.log("Error saving vehicles to S3 for " + agencyInfo.id + " " + e);
            }
        }
    });

    await Promise.all(promises);
    return;
}

function saveVehiclesRepeat() {
    saveVehicles().then(() => {
        console.log("Done running! Scheduling next one");
        setTimeout(saveVehiclesRepeat, interval);
    });
}

async function start() {
    // Uncomment to load the GTFS (it's currently loaded and already exists in gtfs.db
    await migrateDbs();
    saveVehiclesRepeat();
}

start().catch(e => {
    console.error("Exception " + e);
    throw e;
});
