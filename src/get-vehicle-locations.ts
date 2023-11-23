import {getScheduledVehicleLocations} from "./get-scheduled-vehicle-locations";
import {getLiveVehicleLocations} from "./get-live-vehicle-locations";
import {VehiclePositionOutput} from "./providers/gtfs-realtime";


export interface LinkedPosition {
    live?: VehiclePositionOutput;
    scheduled: VehiclePositionOutput;
}

export interface LinkedPositionsOutput {
    [tripId: string]: LinkedPosition;
}
export default async function getVehicleLocations(agency: string, time: number | undefined): Promise<LinkedPositionsOutput> {
    if (time === undefined) {
        time = Date.now();
    }
    const scheduledPositions = await getScheduledVehicleLocations(agency, time);
    const livePositions = await getLiveVehicleLocations(agency, time);

    const output: LinkedPositionsOutput = {};

    scheduledPositions.forEach((sp) => {
        output[sp.tripId] = {
            scheduled: sp,
        }
    })
    livePositions.forEach((lp) => {
        output[lp.tripId] = Object.assign(output[lp.tripId] || {}, {
            live: lp,
        })
    })

    return output;
}