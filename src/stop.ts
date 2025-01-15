import { Shape } from "./shape";

export class Stop {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  distance: number | undefined;

  constructor(id: string, lat: number, lon: number) {
      this.id = id;
      this.lat = lat;
      this.lon = lon;
  }

  setDistance(shape: Shape) {
    this.distance = shape.project(
        {type: "Point", coordinates: [this.lon, this.lat]}
    );
  }
}
