import {writeToSink, writeTripUpdatesToSink} from "./sinks/sqlite-sink";
import {UpdatingGtfsFeed} from "./updating-gtfs-feed";
import {writeToS3} from "orion-lambda/s3Helper";
import {migrateDbs} from "./sinks/sqlite-tools";
import { logEventWithAgency } from "orion-lambda/logger";
import { saveVehiclesToS3Only } from "orion-lambda/lambda";
import NextBus from "./providers/nextbus";
import Realtime from "./providers/gtfs-realtime";
import {config} from "orion-lambda/config";
import {type Agency} from "orion-lambda/types";

export const SAVE_INTERVAL = 5000; // ms



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

export const providerNames = ["nextbus", "gtfs-realtime"];

export const providers: Record<string, Provider> = {
    nextbus: NextBus,
    "gtfs-realtime": Realtime,
};



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

export async function saveVehicles(agencyInfo: Agency) {
    const unixTime = Date.now();

    const providerCode = providers[agencyInfo.provider];
    let savingFailed = false;
    try {
        const db = await UpdatingGtfsFeed.getFeed(agencyInfo.id, Date.now());
        let tripUpdatesCount = 0;
        let vehiclesCount = 0;
        
        if (!providerCode) throw new Error("Invalid provider name");

        if (agencyInfo.tripUpdatesUrl !== undefined) {
            await providerCode.getTripUpdates(agencyInfo).then(updates => {
                tripUpdatesCount = updates.length;
                return writeTripUpdatesToSink(db, agencyInfo, unixTime, updates);
            });
        }
        await providerCode.getVehicles(agencyInfo).then(vehicles => {
            vehiclesCount = vehicles.length;
            return writeToSink(db, agencyInfo, unixTime, vehicles).then(() => {
                return writeToS3(config.s3_bucket, agencyInfo.id, unixTime, vehicles).catch(e => {
                    console.log("Error saving to S3: ", e)
                    throw e;
                })
            });
        });

        logEventWithAgency("agency-gtfs-saved", agencyInfo.id, {
            tripUpdatesCount,
            vehiclesCount,
        });
    } catch (e) {
        // todo: report these errors to an error tracking service
        // Use console.log instead of console.error as to avoid downtime from Kubernetes restarts (10-sec or more)
        logEventWithAgency("agency-gtfs-save-failed", agencyInfo.id, {
            error: e instanceof Error ? e.message : String(e),
        });
        console.warn("WARN: saving vehicles / trip updates failed for " + agencyInfo.id + " " + e);
        savingFailed = true;
    }
    if (savingFailed) {
        try {
            await saveVehiclesToS3Only(agencyInfo);
        } catch (e) {
            // If even S3 fallback fails, we should log it but not throw
            // This ensures the repeat cycle continues
            console.error(`Final S3 fallback failed for agency ${agencyInfo.id}:`, e);
        }
    }
}

export function saveVehicleRepeatForAgency(agencyInfo: Agency) {
    const startTime = Date.now();
    saveVehicles(agencyInfo)
        .catch(e => console.error(`Error in saveVehicles for agency ${agencyInfo.id}:`, e))
        .finally(() => {
            const endTime = Date.now();
            const duration = endTime - startTime;

            if (SAVE_INTERVAL < duration) {
                console.log(`Saving vehicles for ${agencyInfo.id} took ${duration}ms, which is longer than the interval of ${SAVE_INTERVAL}ms`);
            }
            const waitTime = Math.max(SAVE_INTERVAL - duration, 500);
            setTimeout(() => saveVehicleRepeatForAgency(agencyInfo), waitTime);
        });
}

async function start() {
    await migrateDbs();
    // Start independent loops for each agency
    agenciesInfo.forEach(agencyInfo => {
        saveVehicleRepeatForAgency(agencyInfo);
    });
}

start().catch(e => {
    console.error("Exception " + e);
    throw e;
});
