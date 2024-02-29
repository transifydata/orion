import {LineString} from "@turf/helpers";
import assert from "assert";
import length from "@turf/length";
import {along, feature, nearestPointOnLine, Point} from "@turf/turf";

export class Shape {
    private readonly inner: LineString;
    readonly length: number;

    constructor(ls: LineString) {
        this.inner = ls;

        const feat = feature(ls);
        this.length = length(feat, {units: "meters"});
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

    geojson(): LineString {
        return this.inner;
    }
}
