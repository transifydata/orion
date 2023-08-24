import {Feature, FeatureCollection, Geometry, Position} from '@turf/helpers'

import moment from 'moment-timezone'
import {UpdatingGtfsFeed} from "./updating-gtfs-feed";


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

export async function getAllRoutesWithShapes(agency: string): Promise<Array<Route>> {
    const feed = await UpdatingGtfsFeed.getFeed(agency);
    const routes = feed.getRoutes({}, ['route_id', 'route_short_name', 'route_long_name']);

    return Promise.all(routes.map(async r => {
        return {
            ...r,
            shape: await getShapeForRoute(feed, r.route_id, r),
            stops: await getStopByRoute(feed, r.route_id)
        } as Route;
    }));
}

async function getShapeForRoute(feed: UpdatingGtfsFeed, routeId: string, properties: Record<string, any>): Promise<Feature> {
    console.assert(routeId !== undefined, "routeId is undefined")
    const shapes = feed.getShapesAsGeoJSON({route_id: routeId});

    // For some reason this returns a FeatureCollection of LineStrings.
    // Convert this to a MultiLineString by appending all the LineStrings together

    if (shapes.features.length > 0 && shapes.features.every(f => f.geometry.type === "LineString")) {
        const multiLineStringCoords = shapes.features.map(f => {
            return f.geometry.coordinates;
        });

        return {
            type: "Feature",
            geometry: {
                type: "MultiLineString",
                coordinates: multiLineStringCoords as Position[][][]
            },
            properties: properties
        }
    } else {
        throw new Error("Unexpected shape type: " + shapes.features[0].geometry.type)
    }
}

async function getStopByRoute(feed: UpdatingGtfsFeed, routeId: string): Promise<FeatureCollection<Geometry, Stop>> {
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