import {
    getRoutes,
    getShapesAsGeoJSON,
    getStops,
    getStopsAsGeoJSON,
    getStoptimes,
    getTrips,
    importGtfs,
    openDb
} from 'gtfs'
import {FeatureCollection, Feature, Geometry, Position} from '@turf/helpers'
import moment from 'moment-timezone'
import fs from 'fs';


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

export function getRouteByRouteId(routeId: string) {
    const ret = getRoutes({
        route_id: routeId
    }, ['route_long_name', 'route_short_name'], [])
    return ret[0];
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

export function getClosestScheduledStopTime(delays: Record<string, number>, tripId: string, timestamp: number) {
    // We have a list of delays for each stopID, but don't know what stop the bus is currently at.
    // Iterate through all stops and find the *next* stop that the bus will arrive to.

    const stop_times = getStoptimes({trip_id: tripId})
    const timeOfDay = unixTimestampToSecondsOfDay(timestamp, "America/Toronto");

    let lastDelay = 0;
    for (const st of stop_times) {
        const stopDelay = delays[st.stop_id];
        lastDelay = stopDelay ? stopDelay : lastDelay;
        if (HHMMSSToSeconds(st.departure_time) + lastDelay >= timeOfDay) {
            return st;
        }
    }

    console.warn(`Could not find appropriate stop time for ${tripId} with ${timestamp} ${timeOfDay}. Trip probably already ended?`)
    return undefined;
}

export function getTripDetails(tripId: string) {
    return getTrips({trip_id: tripId}, ['direction_id', 'trip_headsign'])[0]
}


function fileExists(filename) {
    try {
        const stats = fs.statSync(filename);
        if (stats.isFile() && stats.size > 0) {
            return true;
        }
    } catch (err) {
        // Handle any errors, e.g., file not found
    }
    return false;
}

const gtfsDatabasePath = (process.env['ORION_DATABASE_PATH'] || '.') + '/gtfs.db';
const config = {
    sqlitePath: gtfsDatabasePath,
    agencies: [
        {
            url: 'https://www.brampton.ca/EN/City-Hall/OpenGov/Open-Data-Catalogue/Documents/Google_Transit.zip',
            prefix: undefined
        },
        {
            // Peterborough
            url: 'http://pt.mapstrat.com/current/google_transit.zip',
            // To avoid ID conflicts with other agencies
            // the library stores all the GTFS items in a single SQLite table
            prefix: 'peterborough'
        },
        {
            url: 'https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip',
        }
    ],
};


export async function resetGtfs() {
    console.log("Resetting GTFS...");
    await parseGTFS(true);
}

export async function parseGTFS(forceReset = false) {
    console.log("Using GTFS database: ", gtfsDatabasePath)

    if (!fileExists(gtfsDatabasePath) || forceReset) {
        console.log("Creating new GTFS...")
        await importGtfs(config);
    } else {
        console.log("Found existing GTFS...")
    }
}

async function getShapeForRoute(routeId: string, properties: Record<string, any>): Promise<Feature> {
    const shapes = await getShapesAsGeoJSON({route_id: routeId});

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

async function getAllRoutes(): Promise<Array<{id: string, short_name: string, long_name: string}>> {
    const routes = await getRoutes({}, [ 'route_id', 'route_short_name', 'route_long_name']);
    return routes.map(r => {
        return {
            id: r.route_id,
            short_name: r.route_short_name,
            long_name: r.route_long_name
        }
    });
}

export async function getAllRoutesWithShapes(): Promise<Array<Route>> {
    const routes = await getAllRoutes();

    return await Promise.all(routes.map(async r => {
        return {
            ...r,
            shape: await getShapeForRoute(r.id, r),
            stops: await getStopByRoute(r.id)
        }
    }));
}

async function getStopByRoute(routeId: string): Promise<FeatureCollection<Geometry, Stop>> {
    const stops = await getStops({route_id: routeId});

    const features: Array<Feature<Geometry, Stop>> = await Promise.all(stops.map(async stop => {
        const props = {
            id: stop.stop_id,
            name: stop.stop_name,
            lat: stop.stop_lat,
            lon: stop.stop_lon,
            route_id: routeId
        };
        return {
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [stop.stop_lon, stop.stop_lat]
            },
            properties: {
                ...props
            }
        }
    }))

    return {
        type: "FeatureCollection",
        features: features
    }
}
const _db = openDb(config);
