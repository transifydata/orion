import {UpdatingGtfsFeed} from "./updating-gtfs-feed";
import BetterSqlite3 from "better-sqlite3";
import {VehiclePosition, VehiclePositionOutput} from "./providers/gtfs-realtime";
import assert from "assert";
import {getScheduledVehicleLocationsSQL} from "./sql-vehicle-locations";
import {Point} from "@turf/turf";
import {TimeTz, secondsToHHMMSS} from "./Date";

export function HHMMSSToSeconds(time) {
    // Split the time string into hours, minutes, and seconds
    const [hours, minutes, seconds] = time.split(":");

    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
}

export function getClosestScheduledStopTime(
    gtfs: UpdatingGtfsFeed,
    delays: Record<string, number>,
    tripId: string,
    timestamp: number,
) {
    // We have a list of delays for each stopID, but don't know what stop the bus is currently at.
    // Iterate through all stops and find the *next* stop that the bus will arrive to.

    const stop_times = gtfs.getStoptimes({trip_id: tripId}, []);
    const timeOfdaySecs = new TimeTz(timestamp, "America/Toronto").secondsOfDay();

    let lastDelay = 0;
    for (const st of stop_times) {
        const stopDelay = delays[st.stop_id];
        lastDelay = stopDelay ? stopDelay : lastDelay;
        if (HHMMSSToSeconds(st.departure_time) + lastDelay >= timeOfdaySecs) {
            // console.log(`Found stop time for trip ${gtfs.agency} ${tripId}`)
            return st;
        }
    }

    console.warn(
        `WARNING: Couldn't find stop time for ${gtfs.agency} ${tripId} with ${timestamp} ${timeOfdaySecs}. Trip probably already ended?`,
    );
    return undefined;
}

export interface ClosestStopTime {
    trip_id: string;
    arrival_time: string;
    departure_time: string;
    stop_id: string;
    stop_sequence: string;
    stop_headsign: number | null;
    pickup_type: string;
    drop_off_type: string;
    shape_dist_traveled: number | null;
    timepoint: string;
    source: "0before" | "1after";
}


export function isDefined(x: any): boolean {
    return x !== null && x !== undefined;
}

export function getClosestStopTimes(db: BetterSqlite3.Database, time: TimeTz, tripFilter?: string): ClosestStopTime[] {
    const getClosestStopTimesInner = (date: TimeTz, secondsOffset: number) => {
        const timeOfDaySecs = date.secondsOfDay() + secondsOffset;
        const timeOfDay = secondsToHHMMSS(timeOfDaySecs);

        // Limit the search to (-10, +20) minutes before and after the current time
        // This makes the search faster as we don't have to search through the entire day for the appropriate stop
        const timeOfDayBefore = secondsToHHMMSS(timeOfDaySecs - 10 * 60);
        const timeOfDayAfter = secondsToHHMMSS(timeOfDaySecs + 20 * 60);
        const dayofWeek = date.dayOfWeek();
        const YYYYMMDD = date.dayAsYYYYMMDD();
        return getScheduledVehicleLocationsSQL(db, YYYYMMDD, dayofWeek, timeOfDay, timeOfDayBefore, timeOfDayAfter, tripFilter);
    }

    const previousDay = time.offsetSecs(-24 * 3600);
    const busesRunningToday = getClosestStopTimesInner(time, 0)

    /*
    Get buses running since yesterday night (previousDay) if we are in the early morning / late-night transition period

    At 1am on a Monday a bus might correspond to a scheduled bus at 25:00 from the previous date (a Sunday schedule) or
     to a bus at 1:00 on the current date. To ensure real-time vehicles can be matched, if it's before 4am, scheduled
     buses from the same time from the previous day - but with 24 hours added to their secondsOfDay (GTFS uses seconds
     of day to store departure times) - are fetched.
     */
    if (time.secondsOfDay() <= 4 * 3600) {
        const busesRunningOvernight = getClosestStopTimesInner(previousDay, 24 * 3600)
        return busesRunningOvernight.concat(busesRunningToday)
    } else {
        // Don't bother to check for overnight buses (24:00:00 onwards)
        return busesRunningToday;
    }
}

export interface StopTimesWithLocation extends ClosestStopTime {
    // Lat, lon
    currentLocation: [number, number];
    heading: number;
    distanceAlongRoute: number;
}

export function processClosestStopTimes(
    feed: UpdatingGtfsFeed,
    closestStopTimes: ClosestStopTime[],
    time: TimeTz,
): StopTimesWithLocation[] {
    // Make pairs based on before and after closest stop times
    const stopTimePairs: [ClosestStopTime, ClosestStopTime][] = [];
    let i = 1;
    while (i < closestStopTimes.length) {
        if (
            closestStopTimes[i - 1].source === "0before" &&
            closestStopTimes[i].source === "1after" &&
            closestStopTimes[i - 1].trip_id === closestStopTimes[i].trip_id
        ) {
            // Found a pair
            stopTimePairs.push([closestStopTimes[i - 1], closestStopTimes[i]]);
            i += 2;
        } else {
            i += 1;
        }
    }

    if (stopTimePairs.length == 0) {
        console.warn("No stop time pairs found!", closestStopTimes);
    }

    const timeOfDaySecs = time.secondsOfDay()

    function interpolateLocationSimpleLinear(beforeStopTime: ClosestStopTime, afterStopTime: ClosestStopTime) {
        const beforeStopLocation = feed.getStopLocation(beforeStopTime.stop_id);
        const afterStopLocation = feed.getStopLocation(afterStopTime.stop_id);

        // Interpolate the current location based on time
        const timeDiff = HHMMSSToSeconds(afterStopTime.arrival_time) - HHMMSSToSeconds(beforeStopTime.departure_time);
        const currentTimeDiff = timeOfDaySecs - HHMMSSToSeconds(beforeStopTime.departure_time);

        let interpolationFactor = 0;
        if (timeDiff !== 0) {
            interpolationFactor = currentTimeDiff / timeDiff;
        }

        const currentLocation: [number, number] = [
            beforeStopLocation[0] + interpolationFactor * (afterStopLocation[0] - beforeStopLocation[0]),
            beforeStopLocation[1] + interpolationFactor * (afterStopLocation[1] - beforeStopLocation[1]),
        ];

        // Calculate the direction (heading) in degrees
        const direction =
            Math.atan2(afterStopLocation[1] - beforeStopLocation[1], afterStopLocation[0] - beforeStopLocation[0]) *
            (180 / Math.PI);

        // Ensure the direction is within the range [0, 360)
        const normalizedDirection = (direction + 360) % 360;

        return {
            currentLocation,
            heading: normalizedDirection,
            distanceAlongRoute: -1,
        };
    }

    function interpolateLocationAlongShape(beforeStopTime: ClosestStopTime, afterStopTime: ClosestStopTime) {
        const shape = feed.getShapeByTripID(beforeStopTime.trip_id);

        const beforeShapeDistTravelled = beforeStopTime.shape_dist_traveled;
        const afterShapeDistTravelled = afterStopTime.shape_dist_traveled;

        assert(
            beforeShapeDistTravelled !== null && afterShapeDistTravelled !== null,
            "Shape dist travelled fields not present!",
        );

        // Interpolate the current location based on time
        const timeDiff = HHMMSSToSeconds(afterStopTime.arrival_time) - HHMMSSToSeconds(beforeStopTime.departure_time);
        let currentTimeDiff = timeOfDaySecs - HHMMSSToSeconds(beforeStopTime.departure_time);

        if (currentTimeDiff < 0) {
            // We are currently in the early morning period (0AM - 4AM), so timeOfDaySecs is between 0 and 4 * 3600,
            // whereas the departure time is between 24:00 - 28:00. We need to add 24 hours to currentTimeDiff
            currentTimeDiff += 24 * 3600;
        }

        let interpolationFactor = 0;
        if (timeDiff !== 0) {
            interpolationFactor = currentTimeDiff / timeDiff;
        }

        const currentShapeDistTravelled =
            beforeShapeDistTravelled + interpolationFactor * (afterShapeDistTravelled - beforeShapeDistTravelled);

        const currentLocation = shape.interpolate(currentShapeDistTravelled);

        // To get the angle, we need to compare two positions
        // Calculate the position a bit further to calculate the angle of the bus
        let direction = 0;

        if (currentShapeDistTravelled + 0.005 < 1.0) {
            // Only calculate the direction if we're not at the end of the shape
            const deltaPosition = shape.interpolate(currentShapeDistTravelled + 0.005);

            // Calculate the direction (heading) in degrees
            direction =
                Math.atan2(deltaPosition[1] - currentLocation[1], deltaPosition[0] - currentLocation[0]) *
                (180 / Math.PI);
        }

        // Ensure the direction is within the range [0, 360)
        const normalizedDirection = (direction + 360) % 360;

        return {
            currentLocation,
            heading: normalizedDirection,
            distanceAlongRoute: currentShapeDistTravelled * shape.length,
        };
    }

    let shapeInterpCount = 0;
    const result = stopTimePairs.map(([beforeStopTime, afterStopTime]) => {
        let result: {
            distanceAlongRoute: number;
            currentLocation: [number, number];
            heading: number;
        };

        if (isDefined(beforeStopTime.shape_dist_traveled) && isDefined(afterStopTime.shape_dist_traveled)) {
            shapeInterpCount += 1;
            result = interpolateLocationAlongShape(beforeStopTime, afterStopTime);
        } else {
            result = interpolateLocationSimpleLinear(beforeStopTime, afterStopTime);
        }
        return {...beforeStopTime, ...result};
    });

    return result;
}

function convertClosestStopTimeToVehiclePositions(
    db: UpdatingGtfsFeed,
    st: StopTimesWithLocation,
): VehiclePositionOutput {
    const {route_id: routeid, trip_headsign} = db.getTrips({trip_id: st.trip_id}, ["route_id", "trip_headsign"])[0];

    // When the user hovers over this bus, we preferentially show the live bus location by matching trip_ids
    // If there's no live bus in the GTFS-realtime feed, we show this scheduled bus along with the message
    const vid = "Could not find corresponding real-time bus";

    const heading = st.heading;

    // Follows the "VehicleStopStatus" enum in GTFS realtime reference
    const status = 2;

    const secsSinceReport = 0;

    return {
        rid: routeid,
        vid: vid,
        lat: st.currentLocation[0],
        lon: st.currentLocation[1],
        heading: heading,
        tripId: st.trip_id,
        stopIndex: parseInt(st.stop_sequence),
        trip_headsign: trip_headsign,
        status: status,
        secsSinceReport: secsSinceReport,
        server_time: Date.now(),
        source: "scheduled",
        terminalDepartureTime: db.getTerminalDepartureTime(st.trip_id),
        distanceAlongRoute: st.distanceAlongRoute,
    };
}

export async function getScheduledVehicleLocations(agency: string, unixTime: number): Promise<VehiclePositionOutput[]> {
    // Use the scheduled GTFS feed to get the positions of all vehicles at a given time.
    // You don't need to fill out VID, status, secsSinceReport, stopId, or label.
    const feed = await UpdatingGtfsFeed.getFeed(agency, unixTime);
    const gtfsDatabase = feed.db;

    assert(gtfsDatabase);
    const time = new TimeTz(unixTime, "America/Toronto");

    const closestStopTimes = getClosestStopTimes(gtfsDatabase, time, undefined);
    console.log("Found", closestStopTimes.length, "closest stop times", time.toString())
    const stopTimesWithLocation = processClosestStopTimes(feed, closestStopTimes, time);

    const positions = stopTimesWithLocation.map(st => {
        return convertClosestStopTimeToVehiclePositions(feed, st);
    });

    // Assert that trip_id is unique
    const tripIds = new Set(positions.map(p => p.tripId));
    if (tripIds.size !== positions.length) {
        throw new Error("Trip IDs are not unique");
    }
    return positions;
}

export interface DistanceAlongRoute {
    scheduledDistanceAlongRoute: number;
    actualDistanceAlongRoute: number;
}

export function calculateDistanceAlongRoute(
    unixTime: number,
    feed: UpdatingGtfsFeed,
    vp: VehiclePosition,
): DistanceAlongRoute {
    const busRecordTime = new TimeTz(unixTime, "America/Toronto").offsetSecs(-1 * (vp.secsSinceReport || 0));

    const shape = feed.getShapeByTripID(vp.tripId);

    const scheduledLocation = getClosestStopTimes(feed.db, busRecordTime, vp.tripId);
    let scheduledDistanceAlongRoute = -1;

    if (scheduledLocation.length === 1) {
        console.warn("Bus is nearly ending it's journey! Skipping.", unixTime, vp.tripId, scheduledLocation);
        return {scheduledDistanceAlongRoute: 0, actualDistanceAlongRoute: 0};
    } else if (scheduledLocation.length == 0) {
        // If we can't find a scheduled location, that means the trip has already ended. This bus is late and still not finished.
        // scheduledDistance is at the end, hence equal to the length of the shape
        scheduledDistanceAlongRoute = shape.length;
    } else {
        assert(scheduledLocation.length == 2);
        const interpolated = processClosestStopTimes(feed, scheduledLocation, busRecordTime);

        scheduledDistanceAlongRoute = interpolated[0].distanceAlongRoute;
    }

    const actualLocation: Point = {
        type: "Point",
        coordinates: [vp.lon as number, vp.lat as number],
    };
    const actualDistanceAlongRoute = shape.project(actualLocation) * shape.length;

    return {scheduledDistanceAlongRoute, actualDistanceAlongRoute};
}
