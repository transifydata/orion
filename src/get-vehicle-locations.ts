import {getScheduledVehicleLocations} from "./get-scheduled-vehicle-locations";
import {getLiveVehicleLocations} from "./get-live-vehicle-locations";
import {VehiclePositionOutput} from "./providers/gtfs-realtime";

export interface LinkedPosition {
    live?: VehiclePositionOutput;
    scheduled?: VehiclePositionOutput;
}

export interface LinkedPositionsOutput {
    [tripId: string]: LinkedPosition;
}

async function measureExecutionTime<T>(func: () => Promise<T>): Promise<{time: number; result: T}> {
    const startTime = performance.now();

    // Execute the provided function
    const result = await func();

    const endTime = performance.now();
    return {result, time: endTime - startTime};
}

function joinVehicleLocations(scheduled: VehiclePositionOutput[], live: VehiclePositionOutput[]): LinkedPositionsOutput {
    const output: LinkedPositionsOutput = {};

    const blockIdToTripId: Map<string, string> = new Map();

    scheduled.forEach(sp => {
        blockIdToTripId.set(sp.blockId, sp.tripId);
        output[sp.tripId] = {
            scheduled: sp,
        };
    });
    live.forEach(lp => {
        if (output.hasOwnProperty(lp.tripId)) {
            output[lp.tripId] = Object.assign(output[lp.tripId], {
                live: lp,
            });
        } else if (blockIdToTripId.has(lp.blockId)) {
            const mappedTripId = blockIdToTripId.get(lp.blockId)!;
            output[mappedTripId] = Object.assign(output[mappedTripId], {
                live: lp,
            });
        } else {
            console.warn("No scheduled trip for live trip", lp);
            output[lp.tripId] = {
                live: lp,
            }
        }
    });

    return output;
}

export default async function getVehicleLocations(agency: string, time: number): Promise<LinkedPositionsOutput> {
    const {result: scheduledPositions, time: scheduledTime} = await measureExecutionTime(
        async () => await getScheduledVehicleLocations(agency, time),
    );
    const {result: livePositions, time: liveTime} = await measureExecutionTime(
        async () => await getLiveVehicleLocations(agency, time),
    );

    console.log("Scheduled execution time:", scheduledTime, "Live execution time:", liveTime);

    const output: LinkedPositionsOutput = {};

    scheduledPositions.forEach(sp => {
        output[sp.tripId] = {
            scheduled: sp,
        };
    });
    livePositions.forEach(lp => {
        output[lp.tripId] = Object.assign(output[lp.tripId] || {}, {
            live: lp,
        });
    });

    return output;
}
