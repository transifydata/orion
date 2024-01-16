import { Feature, LineString, Point } from "@turf/helpers";
import assert from "assert";
import length from "@turf/length";
import { along, feature } from "@turf/turf";

export class Shape {
  private inner: LineString;
  private length: number;

  constructor(ls: LineString) {
    this.inner = ls;

    const feat = feature(ls);
    this.length = length(feat);
  }

  interpolate(ratio: number): [number, number] {
    assert(ratio >= 0.0 && ratio <= 1.0, `ratio must be between 0 and 1, got ${ratio}`);

    const interp_distance = this.length * ratio;

    return along(this.inner, interp_distance).geometry.coordinates as [number, number];
  }
}