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
    /*
    We generate a list of scheduled vehicle positions and a list of live vehicle positions. We need to associate each
    vehicle position with each other if they are the same vehicle. To match each position:
        - they have the same trip_id.
        - they have the same block_id, which means they are the same vehicle but currently operating on a different trip.
            - this happens if the live vehicle is running late but the scheduled vehicle has already started on the next trip.
            - can also happen if the live vehicle is running early and the scheduled vehicle is still on the previous trip.
     */
    const output: LinkedPositionsOutput = {};

    // Map block IDs from the current scheduled buses to their tripIds
    // If we encounter the same block ID in the live data, we can use this map to find the tripId of the scheduledBus
    const scheduledBlockIdToTripId: Map<string, string> = new Map();

    scheduled.forEach(sp => {
        if (sp.scheduledStatus === 'running') {
            scheduledBlockIdToTripId.set(sp.blockId, sp.tripId);
        }
        output[sp.tripId] = {
            scheduled: sp,
        };
    });
    live.forEach(lp => {
        if (lp.vid === "2015") {
            let wtf = 5;
        }
        if (output.hasOwnProperty(lp.tripId) && output[lp.tripId].scheduled!.scheduledStatus === 'running') {
            output[lp.tripId] = Object.assign(output[lp.tripId], {
                live: lp,
            });
        } else if (scheduledBlockIdToTripId.has(lp.blockId)) {
            const mappedTripId = scheduledBlockIdToTripId.get(lp.blockId)!;
            output[mappedTripId] = Object.assign(output[mappedTripId], {
                live: lp,
            });
        } else if (output.hasOwnProperty(lp.tripId)) {
            output[lp.tripId] = Object.assign(output[lp.tripId], {
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

export default async function getVehicleLocations(agency: string, time: number, joinByBlockId: boolean): Promise<LinkedPositionsOutput> {
    const {result: scheduledPositions, time: scheduledTime} = await measureExecutionTime(
        async () => await getScheduledVehicleLocations(agency, time),
    );
    const {result: livePositions, time: liveTime} = await measureExecutionTime(
        async () => await getLiveVehicleLocations(agency, time),
    );

    console.log("Scheduled execution time:", scheduledTime, "Live execution time:", liveTime);

    let output: LinkedPositionsOutput;
    if (joinByBlockId) {
        console.log("Joining by block ID")
        output = joinVehicleLocations(scheduledPositions, livePositions);
    } else {
        output = {}
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
    }

    const filteredOutput: LinkedPositionsOutput = {};
    for (const [tripId, linkedPosition] of Object.entries(output)) {
        if (!linkedPosition.live && linkedPosition.scheduled!.scheduledStatus !== 'running') {
            // If there's no live position and the scheduled position is not running, don't include it
        } else {
            filteredOutput[tripId] = linkedPosition;
        }
    }

    return filteredOutput;
}
