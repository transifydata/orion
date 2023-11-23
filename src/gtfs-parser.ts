import { Feature, FeatureCollection, Geometry } from "@turf/helpers";
import BetterSqlite3 from "better-sqlite3";

import moment from "moment-timezone";
import { UpdatingGtfsFeed } from "./updating-gtfs-feed";
import {
  convertApiRouteToRoute,
  downloadRoutesFromTransifyApi,
} from "./transify-api-connector";
import {VehiclePosition, VehiclePositionOutput} from "./providers/gtfs-realtime";

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface Route {
  id: string;
  short_name: string;
  long_name: string;
  shape: Feature;
  stops: FeatureCollection<Geometry, Stop>;
}

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

  const stop_times = gtfs.getStoptimes({ trip_id: tripId }, []);
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

export async function resetGtfs() {
  console.log("Resetting GTFS...");
  await UpdatingGtfsFeed.updateAll();
}

export async function getAllRoutesWithShapes(agency: string): Promise<Route[]> {
  const routes1 = await downloadRoutesFromTransifyApi(agency);
  const feed = await UpdatingGtfsFeed.getFeed(agency);

  return routes1.features.map((feature) => {
    console.log("Processing route", feature.properties.route_id);
    const route_obj: Route = convertApiRouteToRoute(
      feature,
      getStopByRoute(feed, feature.properties.route_id),
    );
    return route_obj;
  });
}

function getStopByRoute(
  feed: UpdatingGtfsFeed,
  routeId: string,
): FeatureCollection<Geometry, Stop> {
  const stops = feed.getStops({ route_id: routeId }, []);

  const features: Array<Feature<Geometry, Stop>> = stops.map((stop) => {
    const props: Stop & any = {
      id: stop.stop_id,
      name: stop.stop_name,
      lat: stop.stop_lat,
      lon: stop.stop_lon,
      route_id: routeId,
    };
    const feat: Feature<Geometry, Stop> = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [stop.stop_lon, stop.stop_lat],
      },
      properties: {
        ...props,
      },
    };
    return feat;
  });

  return {
    type: "FeatureCollection",
    features: features,
  };
}

function getDayOfWeekColumnName(date: Date): string {
  const dayOfWeek = date.getDay();
  const dayColumnNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  return dayColumnNames[dayOfWeek];
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

function getDateAsString(date: Date): string {
  // Returns a date in YYYYMMDD format

  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0"); // Months are zero-based
  const day = date.getDate().toString().padStart(2, "0");

  return `${year}${month}${day}`;
}

function getClosestStopTimes(
  db: BetterSqlite3.Database,
  time: Date,
): ClosestStopTime[] {
  const timeOfDaySecs = unixTimestampToSecondsOfDay(
    time.getTime() / 1000,
    "America/Toronto",
  );
  const timeOfDay = secondsToHHMMSS(timeOfDaySecs);
  console.log("Time of day", timeOfDay)
  const timeOfDayBefore = secondsToHHMMSS(timeOfDaySecs - 5 * 60);
  const timeOfDayAfter = secondsToHHMMSS(timeOfDaySecs + 5 * 60);

  const query = `
WITH eligible_trips AS (
  SELECT DISTINCT t.trip_id
  FROM trips t
    INNER JOIN calendar c ON t.service_id = c.service_id
  WHERE c.${getDayOfWeekColumnName(
    time,
  )} = 1 AND c.start_date <= @date AND c.end_date >= @date
),
after_stops AS (
  SELECT ROWID, trip_id, MIN(arrival_time) AS first_stop_after_1_30PM
  FROM stop_times
  WHERE arrival_time >= @timeOfDay
    AND arrival_time < @timeOfDayAfter
    AND trip_id IN (SELECT trip_id FROM eligible_trips)
  GROUP BY trip_id
),
before_stops AS (
  SELECT ROWID, trip_id, MIN(arrival_time) AS first_stop_before_1_30PM
  FROM stop_times
  WHERE arrival_time <= @timeOfDay
    AND arrival_time > @timeOfDayBefore
    AND trip_id IN (SELECT trip_id FROM eligible_trips)
  GROUP BY trip_id
)

SELECT stop_times.*, '1after' as source
FROM stop_times
INNER JOIN after_stops ON stop_times.ROWID = after_stops.ROWID

UNION

SELECT stop_times.*, '0before' as source
FROM stop_times
INNER JOIN before_stops ON stop_times.ROWID = before_stops.ROWID

ORDER BY trip_id, source;
  `;

  const statement = db.prepare(query);

  // @ts-ignore
  return statement.all({
    date: getDateAsString(time), // YYYYMMDD format (e.g. "20231001")
    timeOfDay: timeOfDay,
    timeOfDayBefore: timeOfDayBefore,
    timeOfDayAfter: timeOfDayAfter,
  });
}

export interface StopTimesWithLocation extends ClosestStopTime {
  // Lat, lon
  currentLocation: [number, number];
  heading: number;
}

function processClosestStopTimes(
  feed: UpdatingGtfsFeed,
  closestStopTimes: ClosestStopTime[],
  time: Date,
): StopTimesWithLocation[] {
  // Make pairs based on before and after closest stop times
  const stopTimePairs: [ClosestStopTime, ClosestStopTime][] = [];
  let i = 1;
  while (i < closestStopTimes.length - 1) {
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

  const timeOfDaySecs = unixTimestampToSecondsOfDay(
    time.getTime() / 1000,
    "America/Toronto",
  );

  return stopTimePairs.map(([beforeStopTime, afterStopTime]) => {
    const beforeStopLocation = feed.getStopLocation(beforeStopTime.stop_id);
    const afterStopLocation = feed.getStopLocation(afterStopTime.stop_id);

    // Interpolate the current location based on time
    const timeDiff =
      HHMMSSToSeconds(afterStopTime.arrival_time) -
      HHMMSSToSeconds(beforeStopTime.arrival_time);
    const currentTimeDiff =
      timeOfDaySecs - HHMMSSToSeconds(beforeStopTime.arrival_time);
    const interpolationFactor = currentTimeDiff / timeDiff;

    const currentLocation: [number, number] = [
      beforeStopLocation[0] +
        interpolationFactor * (afterStopLocation[0] - beforeStopLocation[0]),
      beforeStopLocation[1] +
        interpolationFactor * (afterStopLocation[1] - beforeStopLocation[1]),
    ];

    // Calculate the direction (heading) in degrees
    const direction =
        Math.atan2(
            afterStopLocation[1] - beforeStopLocation[1],
            afterStopLocation[0] - beforeStopLocation[0],
        ) *
        (180 / Math.PI);

    // Ensure the direction is within the range [0, 360)
    const normalizedDirection = (direction + 360) % 360;

    return { ...beforeStopTime, currentLocation, heading: normalizedDirection };
  });
}

function convertClosesStopTimeToVehiclePositions(
  db: UpdatingGtfsFeed,
  st: StopTimesWithLocation,
): VehiclePositionOutput {
  const routeid: string = db.getTrips({ trip_id: st.trip_id }, ["route_id"])[0][
    "route_id"
  ];
  const trip_headsign: string = db.getTrips({ trip_id: st.trip_id }, [
    "trip_headsign",
  ])[0]["trip_headsign"];
  const vid = "scheduled";

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
  };
}

export async function getScheduledVehicleLocations(
  agency: string,
  time: number,
): Promise<VehiclePositionOutput[]> {
  // Use the scheduled GTFS feed to get the positions of all vehicles at a given time.
  // You don't need to fill out VID, status, secsSinceReport, stopId, or label.

  const feed = await UpdatingGtfsFeed.getFeed(agency);

  if (!feed.db) throw new Error("No db");

  const gtfsDatabase = feed.db;

  const closestStopTimes = getClosestStopTimes(gtfsDatabase, new Date(time));
  const stopTimesWithLocation = processClosestStopTimes(
    feed,
    closestStopTimes,
    new Date(time),
  );

  const positions = stopTimesWithLocation.map((st) =>
    convertClosesStopTimeToVehiclePositions(feed, st),
  );

  // Assert that trip_id is unique
  const tripIds = new Set(positions.map((p) => p.tripId));
  if (tripIds.size !== positions.length) {
    throw new Error("Trip IDs are not unique");
  }
  return positions;
}

// console.log("start1")
// console.log(await getScheduledVehicleLocations("brampton", Date.now()))
