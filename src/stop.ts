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
}
