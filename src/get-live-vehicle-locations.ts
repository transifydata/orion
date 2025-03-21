import {VehiclePositionOutput} from "./providers/gtfs-realtime";
import {UpdatingGtfsFeed} from "./updating-gtfs-feed";
import {sqlVehicleLocations} from "./sql-vehicle-locations";
import {getClosestStopTimes, HHMMSSToSeconds, isDefined} from "./get-scheduled-vehicle-locations";
import {openDb} from "./sinks/sqlite-tools";
import { TimeTz } from "./Date";


export function validateVehiclePosition(vehiclePosition: VehiclePositionOutput): VehiclePositionOutput {
    const tripHeadsign = vehiclePosition.trip_headsign;
    const routeShortName = vehiclePosition.route_short_name || vehiclePosition.rid;

    // for metro-mn, the trip headsign doesn't include the route number (which is the route short name)
    // so we have to manually add it
    let newTripHeadsign = tripHeadsign;
    if (!tripHeadsign.trimStart().startsWith(routeShortName)) {
        newTripHeadsign = `${routeShortName} ${tripHeadsign}`;
    }
    
    return {
        rid: vehiclePosition.rid,
        vid: vehiclePosition.vid,
        lat: vehiclePosition.lat,
        lon: vehiclePosition.lon,
        heading: vehiclePosition.heading,
        tripId: vehiclePosition.tripId,
        stopIndex: vehiclePosition.stopIndex,
        status: vehiclePosition.status,
        trip_headsign: newTripHeadsign,
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
        scheduledStatus: vehiclePosition.scheduledStatus,
    };
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

        const shape = feed.getShapeByTripID(r.tripId, true);
        const routeData = r.rid ? feed.getRoute(r.rid) : undefined;

        let stopId = r.stopId;
        if (shape) {
            stopId = shape
                .projectDistanceToStopID(actualDistanceAlongRoute);
        }

        let vp = validateVehiclePosition({
            ...r,
            source: "live",
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
            terminalDepartureTime: feed.getTerminalDepartureTime(r.tripId),
            trip_headsign: tripAttr?.trip_headsign,
            distanceAlongRoute: actualDistanceAlongRoute,
            stopId: stopId || r.stopId,

            // in metro-mn, route-short-name is sometimes not available, so we use the rid as fallback
            route_short_name: routeData?.route_short_name || r.rid,
        }) as VehiclePositionOutput;
        
        const busRecordTime = new TimeTz(time, agency === 'metro-mn' ? 'America/Chicago' : "America/Toronto").offsetSecs(-1 * (r.secsSinceReport || 0));

        let scheduledLocation;
        if (vp.stopId) {
            scheduledLocation = getClosestStopTimes(feed.db, busRecordTime, vp.tripId, vp.stopId);
        } else {
            console.log('No stopId for', vp.tripId, vp.vid);
        }

        const calcDelayFromDistances = () => {
            // We can calculate the delay by comparing the scheduled distance along the route with the actual distance along the route
            // Then use the average bus speed (estimated at 35 km/hr) to calculate the delay in seconds
            const AVG_BUS_SPEED_METERS_PER_SEC = 35 * 1000 / 3600; // 35 km/h * 1000 m/km / 3600 s/h (get m/s)
            if (isDefined(scheduledDistanceAlongRoute) && isDefined(actualDistanceAlongRoute)) {
                const distanceDelta = scheduledDistanceAlongRoute - actualDistanceAlongRoute;

                // time delta in seconds
                const timeDelta = distanceDelta / AVG_BUS_SPEED_METERS_PER_SEC;

                // If the bus is ahead of schedule, the time delta will be negative
                return timeDelta;
            }
            return null;
        };

        if (scheduledLocation && scheduledLocation.length >= 1) {
                // Only works if scheduled stop_time is within +/- 30-min of busRecordTime.
                // TODO - look into that.

                const scheduledTime = scheduledLocation[0].departure_time;
                let busRecordTimeSeconds = busRecordTime.secondsOfDay();
                let scheduledTimeSeconds = HHMMSSToSeconds(scheduledTime);

                // Adjust due to HHMMSS going past 24-hours (e.g. 25:30).
                if (scheduledTimeSeconds > 60*60*21 && busRecordTimeSeconds < 60*60*3) {
                    busRecordTimeSeconds += 60*60*24;
                }
                const delay = busRecordTimeSeconds - scheduledTimeSeconds;

                const distanceDelay = calcDelayFromDistances();

                if (distanceDelay !== null && Math.abs(distanceDelay) <= 180) {
                    // Rely on the distances to estimate the delay if the actual and scheduled
                    // vehicles are close to each other.
                    // This is because:
                    // 1) In some cases it will be more accurate as schedule runtimes can jump at
                    // timepoints
                    // 2) To address the instance where a vehicle laying over at the start of
                    // its trip before it's scheduled to depart is reported as very early.
                    vp.calculatedDelay = distanceDelay;
                } else {
                    vp.calculatedDelay = delay;
                }
        } else {
            // console.log("No scheduled stop time found for", vp.tripId, vp.stopId, vp.vid, busRecordTime.secondsOfDay());
            // We want to show the bus delay in seconds
            vp.calculatedDelay = calcDelayFromDistances() || undefined;
        }

        return vp;
    }).filter(vp => !vp.secsSinceReport || vp.secsSinceReport <= 60*5);
}
