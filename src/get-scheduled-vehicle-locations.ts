import moment from "moment-timezone";
import {UpdatingGtfsFeed} from "./updating-gtfs-feed";
import BetterSqlite3 from "better-sqlite3";
import {VehiclePosition, VehiclePositionOutput} from "./providers/gtfs-realtime";
import assert from "assert";
import {getScheduledVehicleLocationsSQL} from "./sql-vehicle-locations";
import {Point} from "@turf/turf";

export function HHMMSSToSeconds(time) {
    // Split the time string into hours, minutes, and seconds
    const [hours, minutes, seconds] = time.split(":");

    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
}

export function secondsToHHMMSS(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const seconds2 = seconds % 60;

    const formattedHours = hours.toString().padStart(2, "0");
    const formattedMinutes = minutes.toString().padStart(2, "0");
    const formattedSeconds = seconds2.toString().padStart(2, "0");

    return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

export function unixTimestampToSecondsOfDay(unixTimestamp, timezone) {
    // timezone is from IANA timezone database, like "America/Toronto"
    const torontoTime = moment.unix(unixTimestamp).tz(timezone);
    return torontoTime.diff(torontoTime.clone().startOf("day"), "seconds");
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
    const timeOfDay = unixTimestampToSecondsOfDay(timestamp, "America/Toronto");

    let lastDelay = 0;
    for (const st of stop_times) {
        const stopDelay = delays[st.stop_id];
        lastDelay = stopDelay ? stopDelay : lastDelay;
        if (HHMMSSToSeconds(st.departure_time) + lastDelay >= timeOfDay) {
            // console.log(`Found stop time for trip ${gtfs.agency} ${tripId}`)
            return st;
        }
    }

    console.warn(
        `WARNING: Couldn't find stop time for ${gtfs.agency} ${tripId} with ${timestamp} ${timeOfDay}. Trip probably already ended?`,
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

function getTimeOfDayForGtfs(time: Date): number {
    // Returns the time of day in seconds
    // Handles special case: GTFS feeds go past 24 hours, so we want to do the same for seconds conversion
    let timeOfDaySecs = unixTimestampToSecondsOfDay(time.getTime() / 1000, "America/Toronto");

    // Some brampton buses run past midnight (latest 3:08 AM), so we set 3:15 AM as the cutoff for the next day
    if (timeOfDaySecs <= 3.25 * 3600) {
        timeOfDaySecs += 24 * 3600;
    }

    return timeOfDaySecs;
}

export function isDefined(x: any): boolean {
    return x !== null && x !== undefined;
}

export function getClosestStopTimes(db: BetterSqlite3.Database, time: Date, tripFilter?: string): ClosestStopTime[] {
    const timeOfDaySecs = getTimeOfDayForGtfs(time);
    const timeOfDay = secondsToHHMMSS(timeOfDaySecs);
    const timeOfDayBefore = secondsToHHMMSS(timeOfDaySecs - 7 * 60);
    const timeOfDayAfter = secondsToHHMMSS(timeOfDaySecs + 7 * 60);
    return getScheduledVehicleLocationsSQL(time, db, timeOfDay, timeOfDayBefore, timeOfDayAfter, tripFilter);
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
    time: Date,
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

    const timeOfDaySecs = getTimeOfDayForGtfs(time);

    function interpolateLocationSimpleLinear(beforeStopTime: ClosestStopTime, afterStopTime: ClosestStopTime) {
        const beforeStopLocation = feed.getStopLocation(beforeStopTime.stop_id);
        const afterStopLocation = feed.getStopLocation(afterStopTime.stop_id);

        // Interpolate the current location based on time
        const timeDiff = HHMMSSToSeconds(afterStopTime.arrival_time) - HHMMSSToSeconds(beforeStopTime.departure_time);
        const currentTimeDiff = timeOfDaySecs - HHMMSSToSeconds(beforeStopTime.departure_time);
        const interpolationFactor = currentTimeDiff / timeDiff;

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
        const currentTimeDiff = timeOfDaySecs - HHMMSSToSeconds(beforeStopTime.departure_time);
        const interpolationFactor = currentTimeDiff / timeDiff;

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

    console.log(`Used shape interpolation for ${shapeInterpCount} / ${stopTimePairs.length} buses`);
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

export async function getScheduledVehicleLocations(agency: string, time: number): Promise<VehiclePositionOutput[]> {
    // Use the scheduled GTFS feed to get the positions of all vehicles at a given time.
    // You don't need to fill out VID, status, secsSinceReport, stopId, or label.
    const feed = await UpdatingGtfsFeed.getFeed(agency, time);
    const gtfsDatabase = feed.db;

    assert(gtfsDatabase);

    const closestStopTimes = getClosestStopTimes(gtfsDatabase, new Date(time), undefined);
    const stopTimesWithLocation = processClosestStopTimes(feed, closestStopTimes, new Date(time));

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
    currentTime: number,
    feed: UpdatingGtfsFeed,
    vp: VehiclePosition,
): DistanceAlongRoute {
    const busDate = new Date(currentTime - 1000 * (vp.secsSinceReport || 0));

    const shape = feed.getShapeByTripID(vp.tripId);

    const scheduledLocation = getClosestStopTimes(feed.db, busDate, vp.tripId);
    let scheduledDistanceAlongRoute = -1;

    if (scheduledLocation.length === 1) {
        console.warn("Bus is nearly ending it's journey! Skipping.", currentTime, vp.tripId, scheduledLocation);
        return {scheduledDistanceAlongRoute: 0, actualDistanceAlongRoute: 0};
    } else if (scheduledLocation.length == 0) {
        // If we can't find a scheduled location, that means the trip has already ended. This bus is late and still not finished.
        // scheduledDistance is at the end, hence equal to the length of the shape
        scheduledDistanceAlongRoute = shape.length;
    } else {
        assert(scheduledLocation.length == 2);
        const interpolated = processClosestStopTimes(feed, scheduledLocation, busDate);

        scheduledDistanceAlongRoute = interpolated[0].distanceAlongRoute;
    }

    const locationPoint: Point = {
        type: "Point",
        coordinates: [vp.lon as number, vp.lat as number],
    };
    const actualDistanceAlongRoute = shape.project(locationPoint) * shape.length;

    return {scheduledDistanceAlongRoute, actualDistanceAlongRoute};
}
