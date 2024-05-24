import {VehiclePosition} from "../providers/gtfs-realtime.js";

import {Database, open} from "sqlite";
import sqlite3 from "sqlite3";
import {Agency} from "../index";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import Long from "long";
import {UpdatingGtfsFeed} from "../updating-gtfs-feed";
import {
    calculateDistanceAlongRoute,
    DistanceAlongRoute,
    getClosestScheduledStopTime,
} from "../get-scheduled-vehicle-locations";
import {openDb, pruneDb} from "./sqlite-tools";
import TripUpdate = GtfsRealtimeBindings.transit_realtime.TripUpdate;
import ScheduleRelationship = GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship;

async function writeValue(db: Database, value: VehiclePosition, time: number, agency: Agency) {
    const rowObject = {};
    for (const key in value) {
        let v: any;
        if (key == "lat" || key == "lon") {
            v = (value[key] as number).toFixed(7);
        } else {
            v = value[key];
        }
        rowObject[":" + key] = v;
    }

    const serverDate = new Date().toISOString().slice(0, 10);

    rowObject[":agency_id"] = agency.id;

    // server_date is unused column right now
    rowObject[":server_date"] = serverDate;
    rowObject[":server_time"] = time;

    const column_expr = Object.keys(rowObject).join(",");
    const column_names = Object.keys(rowObject)
        .map(x => x.slice(1))
        .join(",");

    const table_name = map_provider_to_table_name(agency.provider);
    try {
        // Automatic duplicate checking, so use INSERT OR IGNORE...
        const query = `INSERT OR IGNORE INTO ${table_name} (${column_names}) VALUES (${column_expr})`;
        await db.run(query, rowObject);
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

export async function fixData(gtfs: UpdatingGtfsFeed, agency_id: string, data: VehiclePosition) {
    // Right now only implemented for Peterborough
    // Adds `rid` field if it's null
    if (data.rid === "") {
        if (data.tripId === "") {
            throw new Error("Unexpected...route id and trip id is both null");
        }
        const trip = gtfs.getTrip(data.tripId, ["route_id"]);

        data.rid = trip?.route_id.replace(agency_id, "");
    }
}

export async function writeToSink(
    gtfs: UpdatingGtfsFeed,
    agency: Agency,
    unixTime: number,
    data: VehiclePosition[],
) {
    const db = await openDb();

    data.forEach(v => fixData(gtfs, agency.id, v));

    const dataWithDistance: Array<VehiclePosition & DistanceAlongRoute> = data.map(vp => {
        let distances: DistanceAlongRoute = {scheduledDistanceAlongRoute: -1, actualDistanceAlongRoute: -1};
        try {
            distances = calculateDistanceAlongRoute(unixTime, gtfs, vp);
        } catch (e) {
            console.error("Error calculating distance along route", e);
        }
        return {...vp, ...distances};
    });

    await Promise.all(dataWithDistance.map(v => writeValue(db, v, unixTime, agency)));
}

export async function testing() {
    const vehiclePosition: VehiclePosition = {
        rid: "4-343",
        vid: "2079",
        lat: 43.6735000,
        lon: -79.7908100,
        heading: 315.0,
        tripId: "23756996-240108-MULTI-Saturday-01",
        stopIndex: 16,
        status: 2,
        secsSinceReport: 74,
        stopId: "00015670",
        label: "2079",
        blockId: "240108",
    };

    const feed = await UpdatingGtfsFeed.getFeed("brampton", Date.now());

    console.log("LENGTH", feed.getShapeByTripID('23834827-240108-MULTI-Holiday1-01').length);
    // const res = calculateDistanceAlongRoute(1707615780105, feed, vehiclePosition);
    // console.log(res)
}

function convertToSQL(
    feed: UpdatingGtfsFeed,
    tripUpdate: GtfsRealtimeBindings.transit_realtime.TripUpdate,
    run_time: number,
    agency_id: string,
): string {
    const {trip, stopTimeUpdate, vehicle, timestamp} = tripUpdate;
    let delay = tripUpdate.delay;

    const tripId = trip.tripId as string;
    const startTime = trip.startTime;
    const startDate = trip.startDate;
    const routeId = trip.routeId;
    const vehicleId = vehicle?.id;

    const st = Object.fromEntries(
        stopTimeUpdate.map(a => {
            return [a.stopId, a.departure?.delay];
        }),
    );

    // Unused because we are using calculatedDelay (via scheduledDistanceAlongRoute and actualDistanceAlongRoute)
    // const stopTime = getClosestScheduledStopTime(feed, st, tripId, (timestamp as Long).toInt() * 1000);
    // const nextStop = stopTimeUpdate.find(a => {
    //     return a.stopId == stopTime?.stop_id;
    // });
    //
    // if (delay === 0 && nextStop?.departure?.delay) {
    //     delay = nextStop.departure.delay;
    // }

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

