import {Agency} from "../index.js";

import request from "request";
import axios from "axios";

import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import {UpdatingGtfsFeed} from "../updating-gtfs-feed";
import {ScheduledStatus} from "../get-scheduled-vehicle-locations";

async function getTripUpdates(config: Agency): Promise<GtfsRealtimeBindings.transit_realtime.TripUpdate[]> {
    const url = config.tripUpdatesUrl;

    if (!url) throw Error("No trip updates URL provided");

    console.log("fetching trip updates from " + url);

    const response = await axios.get(url, {responseType: "arraybuffer"});

    const feed = decodeFeedMessage(response.data);

    if (!feed) {
        return [];
    }

    return feed.entity.map(item => {
        if (!item.tripUpdate) {
            throw new Error("Unexpected FeedEntity in TripUpdates - " + JSON.stringify(item));
        }
        return new GtfsRealtimeBindings.transit_realtime.TripUpdate(item.tripUpdate);
    });
}

function decodeFeedMessage(body) {
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(body);
}

function isVehicle(gtfsVehiclePosition) {
    return (
        gtfsVehiclePosition && gtfsVehiclePosition.trip && gtfsVehiclePosition.position && gtfsVehiclePosition.vehicle
    );
}

async function getVehicles(config: Agency) {
    const url = config.gtfs_realtime_url;
    console.log("fetching vehicles from " + url);
    const requestSettings = {
        method: "GET",
        url: url,
        encoding: null,
    };

    const gtfsFeed = await UpdatingGtfsFeed.getFeed(config.id, Date.now());


    return new Promise((resolve, reject) => {
        request(requestSettings, function (error, response, body) {
            if (error) {
                reject(error);
            } else if (response.statusCode === 200) {
                let feed: any = decodeFeedMessage(body);

                if (feed === null) {
                    resolve([]);
                    return;
                }

                const vehicles: VehiclePosition[] = [];
                const feedTimestamp = Date.now();
                feed.entity.forEach(function (entity) {
                    const gtfsVehiclePosition = entity.vehicle;
                    if (isVehicle(gtfsVehiclePosition)) {
                        vehicles.push(makeVehicle(gtfsFeed, gtfsVehiclePosition, feedTimestamp));
                    }
                });
                resolve(vehicles);
            } else {
                reject(new Error("HTTP " + response.statusCode + " fetching gtfs-realtime feed from " + url));
            }
        });
    });
}

export type Value = number | string;

export interface VehiclePosition {
    rid: string;
    vid: string;
    lat: Value;
    lon: Value;
    heading: number;
    tripId: string;
    stopIndex: number;
    status: Value;
    secsSinceReport: number | null;
    stopId?: Value;
    label?: Value;
    blockId: string;
}

export interface VehiclePositionOutput extends VehiclePosition {
    delay?: number;
    calculatedDelay?: number;
    trip_headsign: string;
    server_time: number;
    source: string;
    terminalDepartureTime: string;
    distanceAlongRoute: number;

    // Scheduled only
    scheduledStatus?: ScheduledStatus;
}

function makeVehicle(gtfsFeed: UpdatingGtfsFeed, gtfsVehiclePosition, feedTimestamp): VehiclePosition {
    // GTFS-Realtime API returns vehicles like this:
    // VehiclePosition {
    //   trip: TripDescriptor { tripId: '9420711', routeId: '190' },
    //   position:
    //    Position {
    //      latitude: 45.52998733520508,
    //      longitude: -122.66744232177734,
    //      bearing: 121 },
    //   currentStopSequence: 10,
    //   currentStatus: 1,
    //   timestamp: 1571000916,
    //   stopId: '11507',
    //   vehicle: VehicleDescriptor { id: '230', label: 'Yellow Line to City Ctr/Milw' } }
    const {trip, position, stopId, vehicle, timestamp, currentStopSequence, currentStatus} = gtfsVehiclePosition;

    const getSecsSinceReport = (feedTimestamp, timestamp) => {
        // Timestamps might be in milliseconds if derived from date.now or from
        // seconds if from the GTFS-RT feed.
        if (feedTimestamp == null || timestamp == null || timestamp == 0) {
            return null;
        }
        if (feedTimestamp > 2147483647) {
            feedTimestamp = Math.round(feedTimestamp / 1000);
        }
        if (timestamp > 2147483647) {
            timestamp = Math.round(timestamp / 1000);
        }
        return Math.max(0, feedTimestamp - timestamp);
    };

    let blockId: string | undefined = undefined;
    if (gtfsFeed) {
        blockId = gtfsFeed.getTrip(trip.tripId, ['block_id'])?.block_id || "no block id";
    }
    const orionVehicle = {
        rid: trip.routeId,
        vid: vehicle.id,
        lat: Math.round(position.latitude * 100000) / 100000, // 14 digits of lat/lon precision is a bit overkill :0 https://xkcd.com/2170/
        lon: Math.round(position.longitude * 100000) / 100000,
        heading: position.bearing,
        tripId: trip.tripId,
        stopIndex: currentStopSequence,
        status: currentStatus,
        secsSinceReport: getSecsSinceReport(feedTimestamp, timestamp),
        stopId: undefined,
        label: undefined,
        blockId
    };

    if (stopId != "") {
        orionVehicle.stopId = stopId;
    }
    if (vehicle.label != "") {
        orionVehicle.label = vehicle.label;
    }

    return orionVehicle;
}

export default {
    getVehicles, getTripUpdates
}
