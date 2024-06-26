import {Feature, FeatureCollection, Geometry} from "@turf/helpers";
import {UpdatingGtfsFeed} from "./updating-gtfs-feed";
import {convertApiRouteToRoute, downloadRoutesFromTransifyApi} from "./transify-api-connector";

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
    stops: FeatureCollection<Geometry, Stop>;
}

export async function getAllRoutesWithShapes(agency: string): Promise<Route[]> {
    const routes1 = await downloadRoutesFromTransifyApi(agency);

    // TODO: fix this--routes may change as we change the time.
    const feed = await UpdatingGtfsFeed.getFeed(agency, Date.now());

    return routes1.features.map(feature => {
        const route_obj: Route = convertApiRouteToRoute(feature, getStopByRoute(feed, feature.properties.route_id));
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
            route_id: routeId,
        };
        const feat: Feature<Geometry, Stop> = {
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [stop.stop_lon, stop.stop_lat],
            },
            properties: {
                ...props,
            },
        };
        return feat;
    });

    return {
        type: "FeatureCollection",
        features: features,
    };
}
