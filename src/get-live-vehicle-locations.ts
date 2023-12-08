import {
    VehiclePosition,
    VehiclePositionOutput,
} from "./providers/gtfs-realtime";
import {UpdatingGtfsFeed} from "./updating-gtfs-feed";
import {transit_realtime} from "gtfs-realtime-bindings";
import {openDb} from "./sinks/sqlite-sink";

type TripUpdate = transit_realtime.TripUpdate

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
    };
}

export interface SQLVehiclePosition extends VehiclePosition, TripUpdate {
    lat: string;
    lon: string;
    server_time: number;
}

function getRouteByRouteId(feed: UpdatingGtfsFeed, routeId: string) {
    const ret = feed.getRoutes({
        route_id: routeId
    }, ['route_long_name', 'route_short_name'])
    return ret[0];
}

export async function getLiveVehicleLocations(agency: string, time: number): Promise<VehiclePositionOutput[]> {
    const feed = await UpdatingGtfsFeed.getFeed(agency);
    const db = await openDb();

    const startTimeBuffer = time - 5 * 60 * 1000;

    const rows: SQLVehiclePosition[] = await db.all(`
WITH latest_vehicle_positions AS
( SELECT
        vp.*
        FROM vehicle_position vp
        INNER JOIN (
          SELECT vid, MAX(server_time) AS max_time, agency_id
          FROM vehicle_position
          WHERE server_time BETWEEN :start_time AND :end_time AND agency_id=:agency_id
          GROUP BY vid
        ) latest ON vp.vid = latest.vid AND vp.server_time = latest.max_time AND vp.agency_id = latest.agency_id),

    latest_trip_updates AS
   (SELECT
        tu.*
        FROM trip_update tu
        INNER JOIN (
          SELECT vehicle_id, MAX(server_time) AS max_time, agency_id
          FROM trip_update
          WHERE server_time BETWEEN :start_time AND :end_time AND agency_id=:agency_id
          GROUP BY vehicle_id
        ) latest ON tu.vehicle_id = latest.vehicle_id AND tu.server_time = latest.max_time and tu.agency_id = latest.agency_id)

        SELECT *, vp.server_time
        FROM latest_vehicle_positions vp
        LEFT OUTER JOIN latest_trip_updates tu
            ON tu.vehicle_id = vp.vid AND tu.trip_id=vp.tripId;`, {
        ':start_time': startTimeBuffer,
        ':end_time': time,
        ':agency_id': agency
    })

    return rows.map(r => {
        const tripAttr = feed.getTrips({trip_id: r.tripId}, ['direction_id', 'trip_headsign'])[0];
        if (!tripAttr) {
            console.warn("No trip attr for", r.tripId)
        }
        return validateVehiclePosition({
            ...r,
            source: "live",
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
            terminalDepartureTime: feed.getTerminalDepartureTime(r.tripId),
            trip_headsign: tripAttr.trip_headsign,
        })
    });
}