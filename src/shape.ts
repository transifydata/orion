import {LineString} from "@turf/helpers";
import assert from "assert";
import length from "@turf/length";
import {along, feature, nearestPointOnLine, Point} from "@turf/turf";
import { Stop } from "./stop";


export class Shape {
    private readonly inner: LineString;
    readonly length: number;
    readonly tripId: string;
    readonly stops: Stop[];

    constructor(ls: LineString, tripId: string, stops: Stop[]) {
        this.inner = ls;
        this.tripId = tripId;
        this.stops = stops;
        const feat = feature(ls);
        this.length = length(feat, {units: "meters"});

        this.stops.forEach(stop => {
            stop.distance = this.project(
                {type: "Point", coordinates: [stop.lon, stop.lat]}
            );
        });
        this.stops.sort((a, b) => a.distance! - b.distance!);

    }

    interpolate(ratio: number): [number, number] {
        if (Number.isNaN(ratio)) {
            ratio = 0.0;
        }
        if (ratio > 1.0) {
            // This happens for Barrie or all agencies that fill their shape_dist_travelled field in GTFS
            // Divide it by length to match our own interpretation of shape_dist_travelled (as a ratio)
            ratio = ratio / this.length;
        }
        if (ratio >= 1.0 && ratio < 1.1) {
            ratio = 1.0;
        }
        assert(ratio >= 0.0 && ratio <= 1.0, `ratio must be between 0 and 1, got ${ratio}`);

        const interp_distance = this.length * ratio;

        const [x, y] = along(this.inner, interp_distance, {units: "meters"}).geometry.coordinates;
        const lon = y;
        const lat = x;
        return [lon, lat];
    }

    project(point: Point): number {
        // Reverse of interpolate -- given a point, find how far it is along the line
        // The point does not have to be *on* the line--we will find the closest point
        // on the line to the given point.

        const nearest_point = nearestPointOnLine(this.inner, point, {
            units: "meters",
        });
        if (nearest_point.properties.location === undefined) {
            throw Error("nearest_point.properties.location is undefined");
        }
        return nearest_point.properties.location / this.length;
    }

    projectDistanceToStopID(distance_meters: number): string | null {
        const distance_ratio = distance_meters / this.length;
        // Find the stop with the largest distance that is still less than or equal to our projected distance
        if (this.stops.length === 0) {
            return null;
        }
        let bestStop = this.stops[0];
        for (const stop of this.stops) {
            if (stop.distance === undefined) {
                continue;
            }
            if (stop.distance <= distance_ratio && (!bestStop.distance || stop.distance > bestStop.distance)) {
                bestStop = stop;
            }
        }
        return bestStop.id;
    }

    geojson(): LineString {
        return this.inner;
    }
}
