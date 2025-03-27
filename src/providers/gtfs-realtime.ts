import type {Agency} from "orion-lambda/types";

import axios from "axios";

import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import {UpdatingGtfsFeed} from "../updating-gtfs-feed";
import type {ScheduledStatus} from "../get-scheduled-vehicle-locations";

async function getTripUpdates(config: Agency): Promise<GtfsRealtimeBindings.transit_realtime.TripUpdate[]> {
    const url = config.tripUpdatesUrl;

    if (!url) throw Error("No trip updates URL provided");

    const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000, // 30 seconds total timeout
    });

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
    
    if (!url) throw Error("No GTFS realtime URL provided");

    const gtfsFeed = await UpdatingGtfsFeed.getFeed(config.id, Date.now());

    try {
        const response = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 30000, // 30 seconds total timeout
        });

        if (response.status === 200) {
            let feed: any = decodeFeedMessage(response.data);

            if (feed === null) {
                return [];
            }

            const vehicles: VehiclePosition[] = [];
            const feedTimestamp = Date.now();
            feed.entity.forEach((entity: { vehicle: any; }) => {
                const gtfsVehiclePosition = entity.vehicle;
                if (isVehicle(gtfsVehiclePosition)) {
                    vehicles.push(makeVehicle(gtfsFeed, gtfsVehiclePosition, feedTimestamp));
                }
            });
            return vehicles;
        } else {
            throw new Error(`HTTP ${response.status} fetching gtfs-realtime feed from ${url}`);
        }
    } catch (error) {
        throw error;
    }
}

export type Value = number | string;

export interface VehiclePosition {
    rid: string;
    vid: string;
    lat: number;
    lon: number;
    heading: number;
    tripId: string;
    stopIndex: number;
    status: string | number;
    secsSinceReport: number | null;
    stopId?: Value;
    label?: Value;
    blockId?: string;
    route_short_name?: string;
}

export interface VehiclePositionOutput extends VehiclePosition {
    delay?: number;
    calculatedDelay?: number;
    trip_headsign?: string;
    server_time: number;
    source: string;
    terminalDepartureTime: string;
    distanceAlongRoute: number;
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
        blockId = gtfsFeed.getTrip(trip.tripId, ['block_id'])?.block_id || undefined;
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
