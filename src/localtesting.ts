import { UpdatingGtfsFeed } from "./updating-gtfs-feed";
import {testing} from "./sinks/sqlite-sink";
import getVehicleLocations from "./get-vehicle-locations";
import {getScheduledVehicleLocations} from "./get-scheduled-vehicle-locations";
import {openDb, snapshotDb} from "./sinks/sqlite-tools";

const positions = {
  "scheduled": {
    "rid": "30-343",
        "vid": "Could not find corresponding real-time bus",
        "lat": 43.74805154963973,
        "lon": -79.70183924753296,
        "heading": 126.73648788122728,
        "tripId": "23760319-240108-MULTI-Sunday-01",
        "stopIndex": 16,
        "trip_headsign": "30 AIRPORT ROAD SOUTH",
        "status": 2,
        "secsSinceReport": 0,
        "server_time": 1708925903001,
        "source": "scheduled",
        "terminalDepartureTime": "20:16:00",
        "distanceAlongRoute": 8126.220613144084
  },
  "live": {
    "rid": "30-343",
        "vid": "615",
        "lat": 43.74781,
        "lon": -79.70165,
        "heading": 135,
        "tripId": "23760319-240108-MULTI-Sunday-01",
        "stopIndex": 25,
        "status": "2",
        "trip_headsign": "30 AIRPORT ROAD SOUTH",
        "secsSinceReport": 67,
        "stopId": "18030505",
        "label": "615",
        "delay": 0,
        "server_time": 1708911282452,
        "source": "live",
        "terminalDepartureTime": "20:16:00",
        "calculatedDelay": -86.24583928755852,
        "distanceAlongRoute": 8156.09681847487
  }
}

async function testmain() {
  const feed = await UpdatingGtfsFeed.getFeed("brampton", new Date().getTime());
  const shape = feed.getShapeByTripID("23821650-240108-MULTI-Weekday-03");

  const live = positions.live;
  const scheduled = positions.scheduled;
}
async function testdump() {
    const orion = await openDb();
    await snapshotDb(orion);
}

/*
LATE BUS DETECTED {
  rid: '01240424-18',
  vid: '8488',
  lat: 43.31313,
  lon: -79.85587,
  heading: 0,
  tripId: '20240226-18-18941',
  stopIndex: 0,
  status: 2,
  secsSinceReport: 2563,
  stopId: '00180',
  label: '18  - Hamilton GO',
  blockId: 'MDDS5148'
}

 */
async function test2() {
  console.log(await getVehicleLocations("go_transit",1709014952103, false));
                                                                  1709012365219
}
// await test2();

const date = new Date();
console.log(date);
await testdump();
