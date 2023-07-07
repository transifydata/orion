import {getRoutes, getStoptimes, getTrips, importGtfs, openDb} from 'gtfs'


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
function unixTimestampToSecondsOfDay(unixTimestamp) {
    // Create a new Date object with the Unix timestamp in milliseconds
    // TODO: handle timezone (we're lucky because server's also running in ET)
    const date = new Date(unixTimestamp * 1000);

    // Extract the hours, minutes, and seconds from the Date object
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    // Calculate the total number of seconds
    return hours * 3600 + minutes * 60 + seconds;
}
export function getClosestStopTime(delays: Record<string, number>, tripId: string, timestamp: number) {

    const stop_times = getStoptimes({trip_id: tripId})
    const timeOfDay = unixTimestampToSecondsOfDay(timestamp);

    let lastDelay = 0;
    for (const st of stop_times) {
        const stopDelay = delays[st.stop_id];
        lastDelay = stopDelay ? stopDelay : lastDelay;
        if(HHMMSSToSeconds(st.departure_time) + lastDelay >= timeOfDay) {
            return st;
        }
    }

    console.warn(`Could not find appropriate stop time for ${tripId} with ${timestamp} ${timeOfDay}. Trip probably already ended?`)
    return undefined;
}
export function getTripDetails(tripId: string) {
    return getTrips({trip_id: tripId}, ['direction_id', 'trip_headsign'])[0]
}
const config = {
    sqlitePath: 'gtfs.db',
    agencies: [
        {
            url: 'https://www.brampton.ca/EN/City-Hall/OpenGov/Open-Data-Catalogue/Documents/Google_Transit.zip',
            exclude: ['shapes'],
        },
    ],
};
export async function parseGTFS() {
    console.log("Importing GTFS...")
    await importGtfs(config);
}


const db = openDb(config);

