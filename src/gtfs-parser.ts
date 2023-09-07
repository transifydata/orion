import { Feature, FeatureCollection, Geometry } from "@turf/helpers";

import moment from "moment-timezone";
import { UpdatingGtfsFeed } from "./updating-gtfs-feed";
import {
  convertApiRouteToRoute,
  downloadRoutesFromTransifyApi,
} from "./transify-api-connector";

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
    stops: FeatureCollection<Geometry, Stop>
}


function HHMMSSToSeconds(time) {
    // Split the time string into hours, minutes, and seconds
    const [hours, minutes, seconds] = time.split(':');

    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
}

function unixTimestampToSecondsOfDay(unixTimestamp, timezone) {
    // timezone is from IANA timezone database, like "America/Toronto"
    const torontoTime = moment.unix(unixTimestamp).tz(timezone);
    return torontoTime.diff(torontoTime.clone().startOf('day'), 'seconds')
}

export function getClosestScheduledStopTime(gtfs: UpdatingGtfsFeed, delays: Record<string, number>, tripId: string, timestamp: number) {
    // We have a list of delays for each stopID, but don't know what stop the bus is currently at.
    // Iterate through all stops and find the *next* stop that the bus will arrive to.

    const stop_times = gtfs.getStoptimes({trip_id: tripId}, [])
    const timeOfDay = unixTimestampToSecondsOfDay(timestamp, "America/Toronto");

    let lastDelay = 0;
    for (const st of stop_times) {
        const stopDelay = delays[st.stop_id];
        lastDelay = stopDelay ? stopDelay : lastDelay;
        if (HHMMSSToSeconds(st.departure_time) + lastDelay >= timeOfDay) {
            return st;
        }
    }

    console.warn(`WARNING: Couldn't find stop time for ${tripId} with ${timestamp} ${timeOfDay}. Trip probably already ended?`)
    return undefined;
}


export async function resetGtfs() {
    console.log("Resetting GTFS...");
    await UpdatingGtfsFeed.updateAll();
}


export async function getAllRoutesWithShapes(agency: string): Promise<Route[]> {
    const routes1 = await downloadRoutesFromTransifyApi(agency);
    const feed = await UpdatingGtfsFeed.getFeed(agency);

    return routes1.features.map(feature => {
        console.log("Processing route", feature.properties.route_id)
        const route_obj: Route = convertApiRouteToRoute(feature, getStopByRoute(feed, feature.properties.route_id))
        return route_obj;
    });

}

function getStopByRoute(feed: UpdatingGtfsFeed, routeId: string): FeatureCollection<Geometry, Stop> {
    const stops = feed.getStops({route_id: routeId}, []);

    const features: Array<Feature<Geometry, Stop>> = stops.map(stop => {
        const props: Stop & any = {
            id: stop.stop_id,
            name: stop.stop_name,
            lat: stop.stop_lat,
            lon: stop.stop_lon,
            route_id: routeId
        };
        const feat: Feature<Geometry, Stop> = {
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [stop.stop_lon, stop.stop_lat]
            },
            properties: {
                ...props
            }
        }
        return feat;
    });

    return {
        type: "FeatureCollection",
        features: features
    }
}