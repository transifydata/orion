import { LineString } from "@turf/helpers";
import assert from "assert";
import length from "@turf/length";
import { along, feature, nearestPointOnLine, Point } from "@turf/turf";

export class Shape {
  private inner: LineString;
  readonly length: number;

  constructor(ls: LineString) {
    this.inner = ls;

    const feat = feature(ls);
    this.length = length(feat, { units: "meters" });
  }

  interpolate(ratio: number): [number, number] {
    if (Number.isNaN(ratio)) {
      ratio = 0.0;
    }
    assert(
      ratio >= 0.0 && ratio <= 1.0,
      `ratio must be between 0 and 1, got ${ratio}`,
    );

    const interp_distance = this.length * ratio;

    const [x, y] = along(this.inner, interp_distance).geometry.coordinates;
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
    assert(nearest_point.properties.location !== undefined);
    return nearest_point.properties.location / this.length;
  }
}
