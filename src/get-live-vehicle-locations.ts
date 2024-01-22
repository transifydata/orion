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
        distanceAlongRoute: vehiclePosition.distanceAlongRoute,
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
        const tripAttr = feed.getTrips({trip_id: r.tripId}, ["direction_id", "trip_headsign"])[0];
        if (!tripAttr) {
            console.warn("No trip attr for", r.tripId);
        }

        const scheduledDistanceAlongRoute = r.scheduledDistanceAlongRoute;
        const actualDistanceAlongRoute = r.actualDistanceAlongRoute;

        const AVERAGE_BUS_SPEED = 40 * 1000 / 3600; // 40 km/h * 1000 m/km / 3600 s/h (get m/s)
        if (isDefined(scheduledDistanceAlongRoute) && isDefined(actualDistanceAlongRoute)) {
            const distanceDelta = scheduledDistanceAlongRoute - actualDistanceAlongRoute;

            // Seconds
            const timeDelta = distanceDelta / AVERAGE_BUS_SPEED;

            r.delay = timeDelta;
        }


        const vp = validateVehiclePosition({
            ...r,
            source: "live",
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
            terminalDepartureTime: feed.getTerminalDepartureTime(r.tripId),
            trip_headsign: tripAttr.trip_headsign,
            distanceAlongRoute: 0,
        });

        const locationPoint: Point = {
            type: "Point",
            coordinates: [vp.lon as number, vp.lat as number],
        };
        const shape = feed.getShapeByTripID(vp.tripId);
        vp.distanceAlongRoute = shape.project(locationPoint) * shape.length;
        return vp;
    });
}
