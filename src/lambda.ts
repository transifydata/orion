import type {Handler} from 'aws-lambda';
import {type Agency} from "./index.js";
import { config } from "./config.js";
import { logEventWithAgency } from './logger.js';
import { writeToS3 } from './sinks/s3Helper.js';
import axios from 'axios';

// Lambda event type for our specific use case
interface LambdaEvent {
    agency: Agency;
}

interface LambdaResponse {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
}

// Ensure S3 bucket is configured
const s3Bucket = process.env.S3_BUCKET;
if (!s3Bucket) {
    throw new Error('S3_BUCKET environment variable must be set');
}

export const handler: Handler<LambdaEvent, LambdaResponse> = async (event) => {
    const headers = {
        'Content-Type': 'application/json'
    };

    for (const agency of config.agencies) {
        try {
            // Save vehicles to S3
            const result = await saveVehiclesToS3Only(agency);
        } catch (error) {
            console.error("Error processing Lambda event:", error);
            
            // Determine if it's a known error type we can handle specifically
            const errorMessage = error instanceof Error ? error.message : String(error);
            const statusCode = errorMessage.includes("Invalid provider") ? 400 : 500;

            return {
                statusCode,
                headers,
                body: JSON.stringify({
                    message: "Error saving vehicle data to S3",
                    error: errorMessage,
                    agency: event.agency?.id
                })
            };
        }
    }

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: `Successfully saved vehicle data to S3`,
        })
    };
} 


export async function saveVehiclesToS3Only(agencyInfo: Agency) {
    const unixTime = Date.now();

    try {
        const gtfsRealtimeUrl = agencyInfo.gtfs_realtime_url;
        const tripUpdatesUrl = agencyInfo.tripUpdatesUrl;
        
        if (!gtfsRealtimeUrl) {
            throw new Error("GTFS realtime URL is required but not provided");
        }

        // Fetch vehicle positions
        const vehicleResponse = await axios.get(gtfsRealtimeUrl, {
            responseType: 'arraybuffer'
        });
        
        // Save vehicle positions
        await writeToS3(s3Bucket, `${agencyInfo.id}-vehicles`, unixTime, vehicleResponse.data);
        
        // If trip updates URL exists, fetch and save that too
        if (tripUpdatesUrl) {
            const tripResponse = await axios.get(tripUpdatesUrl, {
                responseType: 'arraybuffer'
            });
            await writeToS3(s3Bucket, `${agencyInfo.id}-trips`, unixTime, tripResponse.data);
        }
        
        logEventWithAgency("agency-gtfs-s3-saved", agencyInfo.id, {
            vehiclesResponseSize: vehicleResponse.data.length,
            hasTrips: !!tripUpdatesUrl
        });

        return {
            timestamp: unixTime,
            vehiclesResponseSize: vehicleResponse.data.length,
            hasTrips: !!tripUpdatesUrl
        };
    } catch (e) {
        logEventWithAgency("agency-gtfs-save-s3-failed", agencyInfo.id, {
            error: e instanceof Error ? e.message : String(e),
        });
        console.error("Error saving vehicles to S3 for " + agencyInfo.id + " " + e);
        throw e;
    }
}