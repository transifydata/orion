import type { Handler } from 'aws-lambda';
import axios from 'axios';
import { saveRawBytesToS3 } from './s3Helper.js';
import { logEventWithAgency } from './logger.js';
import { config } from './config.js';
import type { Agency, LambdaEvent, LambdaResponse } from './types.js';

const s3Bucket = "orion-vehicles-backup"

export const handler: Handler<LambdaEvent, LambdaResponse> = async (_event: LambdaEvent) => {
    const headers = {
        'Content-Type': 'application/json'
    };

    try {
        // Process all agencies in parallel using Promise.all
        await Promise.all(config.agencies.map(agency => 
            saveVehiclesToS3Only(agency).catch(error => {
                console.error(`Error processing agency ${agency.id}:`, error);
                // Re-throw to ensure we catch the failure
                throw error;
            })
        ));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: `Successfully saved vehicle data to S3`,
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
            })
        };
    }
}

export async function saveVehiclesToS3Only(agencyInfo: Agency) {
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
        const vehicleKey = `${agencyInfo.id}-vehicles-${unixTime}.pb`;
        await saveRawBytesToS3(s3Bucket, vehicleKey, vehicleResponse.data);
        
        // If trip updates URL exists, fetch and save that too
        if (tripUpdatesUrl) {
            const tripResponse = await axios.get(tripUpdatesUrl, {
                responseType: 'arraybuffer'
            });
            const tripKey = `${agencyInfo.id}-trips-${unixTime}.pb`;
            await saveRawBytesToS3(s3Bucket, tripKey, tripResponse.data);
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