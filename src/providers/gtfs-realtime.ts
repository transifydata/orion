import {Agency} from "../index.js";
import type Long from "long";

import request from 'request'
import axios from 'axios'

import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const lastTimeStampCache = {}

function shouldProcessUpdate(agency: string, function_name: string, feed_timestamp: number): boolean {
    // Whether to process an update depending on if the `feed_timestamp` (when the feed was created) has changed
    const cacheKey = agency + function_name + feed_timestamp.toString();
    if (!lastTimeStampCache[cacheKey]) {
        lastTimeStampCache[cacheKey] = true;
        return true;
    } else {
        return false;
    }
}

export async function getTripUpdates(config: Agency): Promise<GtfsRealtimeBindings.transit_realtime.TripUpdate[]> {
    const url = config.tripUpdatesUrl;

    if (!url) throw Error("No trip updates URL provided")

    console.log('fetching trip updates from ' + url);

    const response = await axios.get(url, { responseType: "arraybuffer" });

    const feed = decodeFeedMessage(response.data);

    if (!feed) {
        return []
    }



    if (shouldProcessUpdate(config.id, 'getTripUpdates', (feed?.header?.timestamp as Long).toNumber())) {
        return feed.entity.map(item => {
            if (!item.tripUpdate) {
                throw new Error("Unexpected FeedEntity in TripUpdates - " + JSON.stringify(item))
            }
            return new GtfsRealtimeBindings.transit_realtime.TripUpdate(item.tripUpdate);
        })
    } else {
        return []
    }


}


function decodeFeedMessage(body) {
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(body);
}

function isVehicle(gtfsVehiclePosition) {
    return gtfsVehiclePosition
        && gtfsVehiclePosition.trip
        && gtfsVehiclePosition.position
        && gtfsVehiclePosition.vehicle;
}

export function getVehicles(config) {
    const url = config.gtfs_realtime_url;
    console.log('fetching vehicles from ' + url);

    const requestSettings = {
        method: 'GET',
        url: url,
        encoding: null
    };

    return new Promise((resolve, reject) => {
        request(requestSettings, function (error, response, body) {
            if (error) {
                reject(error);
            } else if (response.statusCode === 200) {
                let feed: any = decodeFeedMessage(body);

                if(feed === null) {
                    resolve([])
                    return;
                }

                if (shouldProcessUpdate(config.id, 'getVehicles', (feed?.header?.timestamp as Long).toNumber())) {
                    const vehicles: VehiclePosition[] = [];
                    const feedTimestamp = feed.header.timestamp;
                    feed.entity.forEach(function (entity) {
                        const gtfsVehiclePosition = entity.vehicle;
                        if (isVehicle(gtfsVehiclePosition)) {
                            vehicles.push(makeVehicle(
                                gtfsVehiclePosition,
                                feedTimestamp,
                                config.gtfs_realtime_vehicle_id,
                            ));
                        }
                    });
                    resolve(vehicles);
                } else {
                    resolve([])
                }
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
}

function makeVehicle(gtfsVehiclePosition, feedTimestamp, _vehicleIdKey): VehiclePosition {
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
    const {
        trip,
        position,
        stopId,
        vehicle,
        timestamp,
        currentStopSequence,
        currentStatus,
    } = gtfsVehiclePosition;

    const orionVehicle = {
        rid: trip.routeId,
        vid: vehicle.id,
        lat: Math.round(position.latitude * 100000) / 100000, // 14 digits of lat/lon precision is a bit overkill :0 https://xkcd.com/2170/
        lon: Math.round(position.longitude * 100000) / 100000,
        heading: position.bearing,
        tripId: trip.tripId,
        stopIndex: currentStopSequence,
        status: currentStatus,
        secsSinceReport: (feedTimestamp != null && timestamp != null) ? Math.max(0, feedTimestamp - timestamp) : null,
        stopId: undefined,
        label: undefined
    };

    if (stopId != '') {
        orionVehicle.stopId = stopId;
    }
    if (vehicle.label != '') {
        orionVehicle.label = vehicle.label;
    }

    return orionVehicle;
}

