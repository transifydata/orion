import { VehiclePosition } from "../providers/gtfs-realtime.js";

import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { Agency } from "../index";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import Long from "long";
import { UpdatingGtfsFeed } from "../updating-gtfs-feed";
import TripUpdate = GtfsRealtimeBindings.transit_realtime.TripUpdate;
import ScheduleRelationship = GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship;
import { getClosestScheduledStopTime } from "../get-scheduled-vehicle-locations";

const databasePath =
  (process.env["ORION_DATABASE_PATH"] || ".") + "/orion-database.db";

let lastPruned = 0;

export async function openDb() {
  return open({
    filename: databasePath,
    driver: sqlite3.cached.Database,
  });
}

export async function migrateDbs() {
  console.log("Starting migrations...");
  const db = await openDb();
  console.log("Migrating...")
  await db.migrate();

  await db.run("PRAGMA journal_mode = WAL;");

  await pruneDb(db, Date.now());

  console.log("Finished migrations");
}

async function writeValue(
  db: Database,
  value: VehiclePosition,
  time: number,
  server_date: string,
  agency: Agency,
) {
  const colon = {};
  for (const key in value) {
    let v: any;
    if (key == "lat" || key == "lon") {
      v = (value[key] as number).toFixed(7);
    } else {
      v = value[key];
    }
    colon[`:${key}`] = v;
  }

  colon[":agency_id"] = agency.id;
  colon[":server_date"] = server_date;
  colon[":server_time"] = time;

  const column_expr = Object.keys(colon).join(",");

  const table_name = map_provider_to_table_name(agency.provider);
  try {
    // Automatic duplicate checking, so use INSERT OR IGNORE...
    await db.run(
      `INSERT OR IGNORE INTO ${table_name} VALUES (${column_expr})`,
      colon,
    );
  } catch (e) {
    console.error("Error inserting " + e + " " + JSON.stringify(value));
    throw e;
  }
}

function map_provider_to_table_name(provider: string) {
  switch (provider) {
    case "nextbus":
      return "nb_vehicle_position";
    case "gtfs-realtime":
      return "vehicle_position";
    default:
      throw new Error("Unknown agency provider: " + provider);
  }
}

// function getTripsWithAgency(agency_id: string, trip_ids: string[]) {
//     return getTrips({trip_id: trip_ids}, ['route_id']);
// }

export async function fixData(
  gtfs: UpdatingGtfsFeed,
  agency_id: string,
  data: VehiclePosition,
) {
  // Right now only implemented for Peterborough
  // Adds `rid` field if it's null
  if (data.rid === "") {
    if (data.tripId === "") {
      throw new Error("Unexpected...route id and trip id is both null");
    }
    const trip = gtfs.getTrips({ trip_id: data.tripId }, ["route_id"])[0];

    data.rid = trip.route_id.replace(agency_id, "");
  }
}

export async function writeToSink(
  gtfs: UpdatingGtfsFeed,
  agency: Agency,
  currentTime: number,
  data: VehiclePosition[],
) {
  const db = await openDb();

  data.forEach((v) => fixData(gtfs, agency.id, v));

  const currentDate = new Date().toISOString().slice(0, 10);

  await Promise.all(
    data.map((v) => writeValue(db, v, currentTime, currentDate, agency)),
  );
}

function convertToSQL(
  feed: UpdatingGtfsFeed,
  tripUpdate: GtfsRealtimeBindings.transit_realtime.TripUpdate,
  run_time: number,
  agency_id: string,
): string {
  const { trip, stopTimeUpdate, vehicle, timestamp } = tripUpdate;
  let delay = tripUpdate.delay;

  const tripId = trip.tripId as string;
  const startTime = trip.startTime;
  const startDate = trip.startDate;
  const routeId = trip.routeId;
  const vehicleId = vehicle?.id;

  const st = Object.fromEntries(
    stopTimeUpdate.map((a) => {
      return [a.stopId, a.departure?.delay];
    }),
  );

  const stopTime = getClosestScheduledStopTime(
    feed,
    st,
    tripId,
    (timestamp as Long).toInt(),
  );
  const nextStop = stopTimeUpdate.find((a) => {
    return a.stopId == stopTime?.stop_id;
  });

  if (delay === 0 && nextStop?.departure?.delay) {
    delay = nextStop.departure.delay;
  }

  let scheduleRelationship = "unknown";
  if (trip.scheduleRelationship) {
    scheduleRelationship = ScheduleRelationship[trip.scheduleRelationship];
  }
  const directionId = trip.directionId;

  const stopTimeUpdates = JSON.stringify(stopTimeUpdate); // Convert stopTimeUpdate to JSON string

  return `(trip_id, start_time, start_date, route_id, delay, stop_time_updates, timestamp, server_time, agency_id, schedule_relationship, direction_id, vehicle_id)
    VALUES ('${tripId}', '${startTime}', '${startDate}', '${routeId}', ${delay}, '${stopTimeUpdates}', ${timestamp}, ${run_time}, '${agency_id}', '${scheduleRelationship}', ${directionId}, '${vehicleId}')`;
}

export async function writeTripUpdatesToSink(
  feed: UpdatingGtfsFeed,
  agency: Agency,
  currentTime: number,
  data: TripUpdate[],
) {
  const db = await openDb();

  await pruneDb(db, currentTime);

  for (const update of data) {
    const sql = convertToSQL(feed, update, currentTime, agency.id);

    // Automatic duplicate checking, so use INSERT OR IGNORE...
    await db.run(`INSERT OR IGNORE INTO trip_update ${sql};`);
  }
}

async function pruneDb(db, currentTime: number) {
  if (currentTime - lastPruned > 10 * 3600 * 1000) {
    console.log("Pruning...");
    lastPruned = currentTime;
    // Prune all records older than 50 days ago
    const prunePast = currentTime - 50 * 24 * 3600 * 1000;
    const deletedRows1 = await db.run(
      `DELETE FROM trip_update WHERE server_time < ${prunePast}`,
    );
    const deletedRows2 = await db.run(
      `DELETE FROM vehicle_position WHERE server_time < ${prunePast}`,
    );

    console.log("Pruned ", deletedRows1.changes, deletedRows2.changes);
  }
}
