import {VehiclePosition} from "../providers/gtfs-realtime.js";

import {Database, open} from 'sqlite'
import sqlite3 from "sqlite3";
import {Agency} from "../index";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import {getClosestScheduledStopTime, getRouteByRouteId, getTripDetails} from "../gtfs-parser.js";
import TripUpdate = GtfsRealtimeBindings.transit_realtime.TripUpdate;
import ScheduleRelationship = GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship;
import Long from "long";

const databasePath = (process.env['ORION_DATABASE_PATH'] || '.') + '/orion-database.db';

let lastPruned = 0;

console.log("Using database ", databasePath)
async function openDb() {
    return open({
        filename: databasePath,
        driver: sqlite3.cached.Database
    })
}

export async function migrateDbs() {
    const db = await openDb();
    await db.migrate()
    await db.run( 'PRAGMA journal_mode = WAL;' );
    await pruneDb(db, Date.now());

    console.log("Finished migrations")
}

async function writeValue(db: Database, value: VehiclePosition, time: number, server_date: string, agency: Agency) {
    const colon = {}
    for (const key in value) {

        let v: any;
        if (key == 'lat' || key == 'lon') {
            v = (value[key] as number).toFixed(7);
        } else {
            v = value[key];
        }
        colon[`:${key}`] = v;
    }

    colon[':agency_id'] = agency.id
    colon[':server_date'] = server_date;
    colon[':server_time'] = time;

    const column_expr = Object.keys(colon).join(',')

    const table_name = map_provider_to_table_name(agency.provider)
    try {
        // Automatic duplicate checking, so use INSERT OR IGNORE...
        await db.run(`INSERT OR IGNORE INTO ${table_name} VALUES (${column_expr})`, colon)
    } catch (e) {
        console.error("Error inserting " + e + " " + JSON.stringify(value))
        throw e;
    }
}


function map_provider_to_table_name(provider: string) {
    switch(provider) {
        case 'nextbus':
            return 'nb_vehicle_position';
        case 'gtfs-realtime':
            return 'vehicle_position';
        default:
            throw new Error("Unknown agency provider: " + provider)
    }
}
export async function writeToSink(agency: Agency, currentTime: number, data: VehiclePosition[]) {
    const db = await openDb();

    const currentDate = new Date().toISOString().slice(0, 10);

    await Promise.all(data.map(v => writeValue(db, v, currentTime, currentDate, agency)))
}

export interface SQLVehiclePosition extends VehiclePosition, TripUpdate {
    lat: string;
    lon: string;
    server_time: number;
}

export async function getVehicleLocations(agency: string): Promise<VehiclePosition[]> {
    const db = await openDb();
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    const rows: SQLVehiclePosition[] = await db.all(`
WITH latest_vehicle_positions AS
( SELECT
        vp.*
        FROM vehicle_position vp
        INNER JOIN (
          SELECT vid, MAX(server_time) AS max_time
          FROM vehicle_position
          GROUP BY vid
        ) latest ON vp.vid = latest.vid AND vp.server_time = latest.max_time AND vp.agency_id = :agency_id),

    latest_trip_updates AS
   (SELECT
        tu.*
        FROM trip_update tu
        INNER JOIN (
          SELECT vehicle_id, MAX(server_time) AS max_time
          FROM trip_update
          GROUP BY vehicle_id
        ) latest ON tu.vehicle_id = latest.vehicle_id AND tu.ROWID AND tu.server_time = latest.max_time AND tu.agency_id = :agency_id)

        SELECT *
        FROM latest_vehicle_positions vp
        INNER JOIN latest_trip_updates tu
            ON tu.vehicle_id = vp.vid AND tu.trip_id=vp.tripId
        WHERE vp.server_time >= :server_time;`, {':server_time': fiveMinutesAgo, ':agency_id': agency})

    return rows.map(r => {
        const routeAttr = getRouteByRouteId(r.rid);
        const tripAttr = getTripDetails(r.tripId);
        console.log(tripAttr.trip_headsign, r.vid, r.delay)
        return {...r, lat: parseFloat(r.lat), lon: parseFloat(r.lon), ...routeAttr, ...tripAttr}
    });
}


function convertToSQL(tripUpdate: GtfsRealtimeBindings.transit_realtime.TripUpdate, run_time: number, agency_id: string): string {
    const {
        trip,
        stopTimeUpdate,
        vehicle,
        timestamp,
    } = tripUpdate;
    let delay = tripUpdate.delay;

    const tripId = trip.tripId as string;
    const startTime = trip.startTime;
    const startDate = trip.startDate;
    const routeId = trip.routeId;
    const vehicleId = vehicle?.id;

    const st = Object.fromEntries(stopTimeUpdate.map(a => {
        return [a.stopId, a.departure?.delay];
    }));

    const stopTime = getClosestScheduledStopTime(st, tripId, (timestamp as Long).toInt());
    const nextStop = stopTimeUpdate.find(a => {
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

export async function writeTripUpdatesToSink(agency: Agency, currentTime: number, data: TripUpdate[]) {
    const db = await openDb();

    await pruneDb(db, currentTime);

    for (const update of data) {
        const sql = convertToSQL(update, currentTime, agency.id);

        try {
            // Automatic duplicate checking, so use INSERT OR IGNORE...
            await db.run(`INSERT OR IGNORE INTO trip_update ${sql};`)
        } catch (e) {
            console.error("Error inserting " + e + " " + JSON.stringify(update))
            throw e;
        }
    }
}

async function pruneDb(db, currentTime: number) {
    // Run approximately every 5 hours
    if (currentTime - lastPruned > 5 * 3600 * 1000) {
        lastPruned = currentTime;
        // Delete records older than 5 hours
        const prunePast = currentTime - 5 * 3600 * 1000;
        const deletedRows1 = await db.run(`DELETE FROM trip_update WHERE server_time < ${prunePast}`)
        const deletedRows2 = await db.run(`DELETE FROM vehicle_position WHERE server_time < ${prunePast}`)

        console.log("Pruned ", deletedRows1.changes, deletedRows2.changes)
    }
}