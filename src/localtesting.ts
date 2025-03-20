// import { UpdatingGtfsFeed } from "./updating-gtfs-feed";
// import { testing } from "./sinks/sqlite-sink";
// import getVehicleLocations from "./get-vehicle-locations";
// import { getClosestStopTimes, getScheduledVehicleLocations, HHMMSSToSeconds } from "./get-scheduled-vehicle-locations";
// import { openDb, snapshotDb } from "./sinks/sqlite-tools";
// import { getLiveVehicleLocations, validateVehiclePosition } from "./get-live-vehicle-locations";
// import { TimeTz } from "./Date";

// // Vehicle ID = 2079;  501 ZUM QUEEN WESTBOUND
// // 12:28PM

// const positions = {
//   "scheduled": {
//     "rid": "511",
//     "vid": "Could not find corresponding real-time bus",
//     "lat": 43.708896572622976,
//     "lon": -79.68594143640338,
//     "heading": 48.53406562637838,
//     "tripId": "24377838-250106-MULTI-Weekday-01",
//     "stopIndex": 8,
//     "trip_headsign": "511C ZUM STEELES EAST",
//     "status": 2,
//     "secsSinceReport": 0,
//     "server_time": 1740508133907,
//     "source": "scheduled",
//     "terminalDepartureTime": "12:59:00",
//     "distanceAlongRoute": 8301.250968197144,
//     "blockId": "1138015",
//     "scheduledStatus": "running",
//     "matchKey": "24377838-250106-MULTI-Weekday-01"
// },
// "live": {
//     "rid": "511",
//     "vid": "1161",
//     "lat": 43.72341,
//     "lon": -79.6693,
//     "heading": 30,
//     "tripId": "24377838-250106-MULTI-Weekday-01",
//     "stopIndex": 10,
//     "status": "2",
//     "trip_headsign": "511C ZUM STEELES EAST",
//     "secsSinceReport": 17,
//     "stopId": "00051112",
//     "label": "1161",
//     "delay": 0,
//     "server_time": 1740508125275,
//     "source": "live",
//     "terminalDepartureTime": "12:59:00",
//     "calculatedDelay": -324,
//     "distanceAlongRoute": 10397.168153898107,
//     "blockId": "1138015",
//     "matchKey": "24377838-250106-MULTI-Weekday-01"
// }
// };

// async function testmain() {
//   const r = positions.live;

//   const feed = await UpdatingGtfsFeed.getFeed("brampton", Date.now());

//   const tripAttr = feed.getTrip(r.tripId, ["direction_id", "trip_headsign", "block_id"]);
//   if (!tripAttr) {
//     console.warn("No trip attr for", r.tripId);
//   }

//   if (!r.blockId) {
//     // blockId field is null for vehicle positions before the deploy
//     r.blockId = tripAttr?.block_id;
//   }

//   const stopId = feed
//     .getShapeByTripID(r.tripId, true)
//     .projectDistanceToStopID(r.distanceAlongRoute);

//   let vp = validateVehiclePosition({
//     ...r,
//     source: "live",
//     lat: r.lat,
//     lon: r.lon,
//     terminalDepartureTime: feed.getTerminalDepartureTime(r.tripId),
//     trip_headsign: tripAttr?.trip_headsign,
//     distanceAlongRoute: r.distanceAlongRoute,
//     stopId: stopId || r.stopId,
//   });
//   const busRecordTime = new TimeTz(1740508140000, "America/Toronto").offsetSecs(-1 * (r.secsSinceReport || 0));

//   let scheduledLocation;
//   if (vp.stopId) {
//     console.log('Getting closest stop times for', vp.tripId, vp.vid, vp.stopId);
//     scheduledLocation = getClosestStopTimes(feed.db, busRecordTime, vp.tripId, vp.stopId);
//   } else {
//     console.log('No stopId for', vp.tripId, vp.vid);
//   }

//   const calcDelayFromDistances = () => {
//     return 10000.0;
//     // We can calculate the delay by comparing the scheduled distance along the route with the actual distance along the route
//     // Then use the average bus speed (estimated at 35 km/hr) to calculate the delay in seconds
//     const AVG_BUS_SPEED_METERS_PER_SEC = 35 * 1000 / 3600; // 35 km/h * 1000 m/km / 3600 s/h (get m/s)
//     if (isDefined(scheduledDistanceAlongRoute) && isDefined(actualDistanceAlongRoute)) {
//       const distanceDelta = scheduledDistanceAlongRoute - actualDistanceAlongRoute;

//       // time delta in seconds
//       const timeDelta = distanceDelta / AVG_BUS_SPEED_METERS_PER_SEC;

//       // If the bus is ahead of schedule, the time delta will be negative
//       return timeDelta;
//     }
//     return null;
//   };

//   if (scheduledLocation && scheduledLocation.length >= 1) {
//     console.log("SCHEDULED LOCATION", scheduledLocation)
//     // Only works if scheduled stop_time is within +/- 30-min of busRecordTime.
//     // TODO - look into that.

//     const scheduledTime = scheduledLocation[0].departure_time;
//     let busRecordTimeSeconds = busRecordTime.secondsOfDay();
//     let scheduledTimeSeconds = HHMMSSToSeconds(scheduledTime);

//     // Adjust due to HHMMSS going past 24-hours (e.g. 25:30).
//     if (scheduledTimeSeconds > 60 * 60 * 21 && busRecordTimeSeconds < 60 * 60 * 3) {
//       busRecordTimeSeconds += 60 * 60 * 24;
//     }
//     const delay = busRecordTimeSeconds - scheduledTimeSeconds;

//     const distanceDelay = calcDelayFromDistances();

//     if (distanceDelay !== null && Math.abs(distanceDelay) <= 60) {
//       // Rely on the distances to estimate the delay if the actual and scheduled
//       // vehicles are close to each other.
//       // This is because:
//       // 1) In some cases it will be more accurate as schedule runtimes can jump at
//       // timepoints
//       // 2) To address the instance where a vehicle laying over at the start of
//       // its trip before it's scheduled to depart is reported as very early.
//       vp.calculatedDelay = distanceDelay;
//     } else {
//       vp.calculatedDelay = delay;
//     }
//   } else {
//     console.log("No scheduled stop time found for", vp.tripId, vp.stopId, vp.vid, busRecordTime.secondsOfDay());
//     // We want to show the bus delay in seconds
//     vp.calculatedDelay = calcDelayFromDistances() || undefined;
//   }

//   console.log(vp)

// }
// async function testdump() {
//   const orion = await openDb();
//   await snapshotDb(orion);
// }

// /*
// LATE BUS DETECTED {
//   rid: '01240424-18',
//   vid: '8488',
//   lat: 43.31313,
//   lon: -79.85587,
//   heading: 0,
//   tripId: '20240226-18-18941',
//   stopIndex: 0,
//   status: 2,
//   secsSinceReport: 2563,
//   stopId: '00180',
//   label: '18  - Hamilton GO',
//   blockId: 'MDDS5148'
// }

//  */
// async function test2() {
//   console.log(await getVehicleLocations("go_transit", 1709014952103, false));
//   1709012365219
// }
// // await test2();

// async function testmain1() {
//   const results = (await getLiveVehicleLocations("brampton", 1740407256000)).filter(vp => vp.vid === "1152");
  
//   console.log(results)
// }

// await testmain1();
