import {VehiclePosition, VehiclePositionOutput} from "./providers/gtfs-realtime";
import {UpdatingGtfsFeed} from "./updating-gtfs-feed";
import {transit_realtime} from "gtfs-realtime-bindings";
import {openDb} from "./sinks/sqlite-sink";
import {sqlVehicleLocations} from "./sql-vehicle-locations";
import {Point} from "@turf/turf";
import {isDefined} from "./get-scheduled-vehicle-locations";

type TripUpdate = transit_realtime.TripUpdate;

export function validateVehiclePosition(vehiclePosition: VehiclePositionOutput): VehiclePositionOutput {
    return {
        rid: vehiclePosition.rid,
        vid: vehiclePosition.vid,
        lat: vehiclePosition.lat,
        lon: vehiclePosition.lon,
        heading: vehiclePosition.heading,
        tripId: vehiclePosition.tripId,
        stopIndex: vehiclePosition.stopIndex,
        status: vehiclePosition.status,
        trip_headsign: vehiclePosition.trip_headsign,
        secsSinceReport: vehiclePosition.secsSinceReport,
        stopId: vehiclePosition.stopId,
        label: vehiclePosition.label,
        delay: vehiclePosition.delay,
        server_time: vehiclePosition.server_time,
        source: vehiclePosition.source,
        terminalDepartureTime: vehiclePosition.terminalDepartureTime,
        calculatedDelay: vehiclePosition.calculatedDelay,
        distanceAlongRoute: vehiclePosition.distanceAlongRoute,
        blockId: vehiclePosition.blockId,
    };
}

export interface SQLVehiclePosition extends VehiclePosition, TripUpdate {
    lat: string;
    lon: string;
    server_time: number;
}

export async function getLiveVehicleLocations(agency: string, time: number): Promise<VehiclePositionOutput[]> {
    const feed = await UpdatingGtfsFeed.getFeed(agency, time);
    const db = await openDb();

    const rows = await sqlVehicleLocations(db, time, agency);

    return rows.map(r => {
        const tripAttr = feed.getTrip(r.tripId, ["direction_id", "trip_headsign", "block_id"]);
        if (!tripAttr) {
            console.warn("No trip attr for", r.tripId);
        }

        const scheduledDistanceAlongRoute = r.scheduledDistanceAlongRoute;
        const actualDistanceAlongRoute = r.actualDistanceAlongRoute;

        if (!r.blockId) {
            // blockId field is null for vehicle positions before the deploy
            r.blockId = tripAttr?.block_id;
        }

        // We want to show the bus delay in seconds
        // We can calculate the delay by comparing the scheduled distance along the route with the actual distance along the route
        // Then use the average bus speed (estimated at 35 km/hr) to calculate the delay in seconds
        const AVG_BUS_SPEED_METERS_PER_SEC = 35 * 1000 / 3600; // 35 km/h * 1000 m/km / 3600 s/h (get m/s)
        if (isDefined(scheduledDistanceAlongRoute) && isDefined(actualDistanceAlongRoute)) {
            const distanceDelta = scheduledDistanceAlongRoute - actualDistanceAlongRoute;

            // time delta in seconds
            const timeDelta = distanceDelta / AVG_BUS_SPEED_METERS_PER_SEC;

            // If the bus is ahead of schedule, the time delta will be negative
            r.calculatedDelay = timeDelta;
        }

        const vp = validateVehiclePosition({
            ...r,
            source: "live",
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
            terminalDepartureTime: feed.getTerminalDepartureTime(r.tripId),
            trip_headsign: tripAttr?.trip_headsign,
            distanceAlongRoute: actualDistanceAlongRoute
        });

        return vp;
    });
}
