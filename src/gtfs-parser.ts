import {getRoutes, getTrips, importGtfs, openDb} from 'gtfs'


export function getRouteByRouteId(routeId: string) {
    const ret = getRoutes({
        route_id: routeId
    }, ['route_long_name', 'route_short_name'], [])
    return ret[0];
}


export function getTripDetails(tripId: string) {
    return getTrips({trip_id: tripId}, ['direction_id', 'trip_headsign'])[0]
}
const config = {
    sqlitePath: 'gtfs.db',
    agencies: [
        {
            url: 'https://www.brampton.ca/EN/City-Hall/OpenGov/Open-Data-Catalogue/Documents/Google_Transit.zip',
            exclude: ['shapes', 'stop_times'],
        },
    ],
};
export async function parseGTFS() {
    await importGtfs(config);



}


const db = openDb(config);

console.log(getRoutes({}, ['route_id', 'route_long_name'], // Only return these fields
    []))
