import type { Handler } from 'aws-lambda';
import axios from 'axios';
import { writeToS3 } from './s3Helper.js';
import { logEventWithAgency } from './logger.js';
import type { LambdaEvent, LambdaResponse, Agency } from './types.js';

// Ensure S3 bucket is configured
const s3Bucket = process.env.S3_BUCKET as string;
if (!s3Bucket) {
    throw new Error('S3_BUCKET environment variable must be set');
}

export const handler: Handler<LambdaEvent, LambdaResponse> = async (event) => {
    const headers = {
        'Content-Type': 'application/json'
    };

    try {
        const agency = event.agency;
        const result = await saveVehiclesToS3Only(agency);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: `Successfully saved vehicle data to S3`,
                ...result
            })
        };
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

async function saveVehiclesToS3Only(agencyInfo: Agency) {
    const unixTime = Date.now();

    try {
        const { gtfs_realtime_url: gtfsRealtimeUrl, tripUpdatesUrl } = agencyInfo;
        
        if (!gtfsRealtimeUrl) {
            throw new Error("GTFS realtime URL is required but not provided");
        }

        // Fetch vehicle positions
        const vehicleResponse = await axios.get(gtfsRealtimeUrl, {
            responseType: 'arraybuffer'
        });
        
        // Save vehicle positions to S3
        const vehicleKey = `${agencyInfo.id}-vehicles`;
        await writeToS3(s3Bucket, vehicleKey, unixTime, vehicleResponse.data);
        
        // If trip updates URL exists, fetch and save that too
        if (tripUpdatesUrl) {
            const tripResponse = await axios.get(tripUpdatesUrl, {
                responseType: 'arraybuffer'
            });
            const tripKey = `${agencyInfo.id}-trips`;
            await writeToS3(s3Bucket, tripKey, unixTime, tripResponse.data);
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