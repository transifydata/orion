import NextBus from "./providers/nextbus";
import Realtime from "./providers/gtfs-realtime";
import {config} from "./config";
import { logEventWithAgency } from "orion-lambda/logger";
import { writeToS3 } from "orion-lambda/s3Helper";
console.log(logEventWithAgency, writeToS3);

export const SAVE_INTERVAL = 5000; // ms

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

export const providerNames = ["nextbus", "gtfs-realtime"];

export const providers: Record<string, Provider> = {
    nextbus: NextBus,
    "gtfs-realtime": Realtime,
};
