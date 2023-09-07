import {Feature, FeatureCollection, Geometry} from "@turf/helpers";
import axios from "axios";

import {Route as JSRoute, Stop} from './gtfs-parser';
interface Agency {
    agency_id: string;
    agency_name: string;
}

interface FeedVersion {
    fetched_at: string; // You might want to use a suitable date string format
    md5: string;
}

interface Route {
    agency: Agency;
    feed_version: FeedVersion;
    route_color?: string | null;
    route_desc?: string | null;
    route_id: string;
    route_long_name: string;
    route_short_name: string;
    route_text_color?: string | null;
    route_type?: string | null;
    route_url?: string | null;
}

export function convertApiRouteToRoute(feature: Feature<Geometry, Route>, stops: FeatureCollection<Geometry, Stop>): JSRoute {
  return {
    id: feature.properties.route_id,
    short_name: feature.properties.route_short_name,
    long_name: feature.properties.route_long_name,
    shape: {
      type: "Feature",
      geometry: feature.geometry,
      properties: {}
    },
    stops
  }
}

export function getCurrentFormattedDate() {
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}
export async function downloadRoutesFromTransifyApi(agency: string): Promise<FeatureCollection<Geometry, Route>> {
    const start = performance.now();
    const response = await axios({
        method: 'get',
        url: `https://staging-api.transify.ca/api/routes?agency=${agency}&date=${getCurrentFormattedDate()}`,
    });

    if (response.status !== 200) {
        throw new Error("Could not download GTFS" + response.status + response.statusText)
    }

    const end = performance.now();
    console.log(`Downloaded routes in ${end - start}ms`);
    return response.data;
}
