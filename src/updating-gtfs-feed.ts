import fs from "fs";
import {
  closeDb,
  getRoutes,
  getShapesAsGeoJSON,
  getStops,
  getStoptimes,
  getTrips,
  openDb as openDb_internal,
} from "gtfs";
import axios from "axios";
import { Database } from "better-sqlite3";
import {formatDate, getCurrentFormattedDate} from "./transify-api-connector";
import {Feature, FeatureCollection, Geometry, LineString} from "@turf/helpers";
import {Shape} from "./shape";

const config = {
  sqlitePath: undefined,
  agencies: []
};

function openDb(config, agency: string, time: number) {
    config.sqlitePath = getFilepath(agency, time);
    return openDb_internal(config);
}

function getFilepath(agency: string, time: number): string {
    const formatted_date = formatDate(new Date(time));
    return `gtfs-${agency}-${formatted_date}.db`;
}



async function downloadFromGtfsService(agency: string, time: number) {
    const response = await axios({
        method: 'get',
        url: `https://staging-api.transify.ca/api/gtfs/db?agency=${agency}&date=${formatDate(new Date(time))}`,
        responseType: 'stream', // Important to handle the response as a stream
    });

    if (response.status !== 200) {
        throw new Error("Could not download GTFS" + response.status + response.statusText)
    }
    const writer = fs.createWriteStream(getFilepath(agency, time));
    response.data.pipe(writer);

    // Handle the completion of the download

    console.log("Waiting for GTFS download...")
    await new Promise(resolve => {
        writer.on('finish', () => {
            resolve(void 0);
        });
    });
}

async function waitForLock(db) {
    let iters = 0;

    while (iters <= 5) {
        try {
            db.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;")
            return;
        } catch (SqliteError) {
            iters++;
            console.log("Waiting for lock...", iters)
            await new Promise(resolve => setTimeout(resolve, 800 *( iters ** 2)));
        }
    }
    throw new Error("Could not get lock")
}

export class GtfsList {
    private inner: Array<UpdatingGtfsFeed> = [];

    constructor() {}

    public find(agency: string, time: number): UpdatingGtfsFeed | undefined {
        const date = formatDate(new Date(time));
        const index = this.inner.findIndex((feed) => feed.agency === agency && feed.formatted_date === date);
        if (index === -1) {
            return undefined
        } else {
            return this.inner[index];
        }
    }

    public push(feed: UpdatingGtfsFeed) {
        this.inner.push(feed);
    }
}

export class UpdatingGtfsFeed {

    private static AGENCY_MAP: GtfsList = new GtfsList();

    private shapes_cache: Record<string, Shape>;
    agency: string;
    formatted_date: string;
    db: Database;

    private constructor(agency: string, db: Database, time: number) {
        this.shapes_cache = {}
        this.agency = agency;
        this.db = db;
        this.formatted_date = formatDate(new Date(time));
    }

    static async initializeAll() {
        // TODO: remove
        // for (const agency of ["brampton", "barrie", "go_transit"]) {
        //     try {
        //         UpdatingGtfsFeed.AGENCY_MAP[agency] = await UpdatingGtfsFeed.openWait(agency);
        //     } catch (err) {
        //         console.error("Could not open", agency, err)
        //     }
        // }
    }


    static async openWait(agency: string, time: number): Promise<UpdatingGtfsFeed> {
        // If file doesn't exist, then download it
        const filepath = getFilepath(agency, time);
        console.log("Opening ", agency, filepath, "...")

        const existsButEmpty = fs.existsSync(filepath) && fs.statSync(filepath).size === 0;
        const doesntExist = !fs.existsSync(filepath);
        if (existsButEmpty || doesntExist) {
            console.log("Downloading GTFS...", agency)
            try {
                await downloadFromGtfsService(agency, time);
            } catch (err) {
                console.error("Could not download GTFS", agency, err)
                throw err;
            }
        }
        let max_iters = 0;
        while (max_iters <= 5) {
            max_iters += 1;
            try {
                const db = openDb(config, agency, time);
                console.log("Successfully opened", agency)

                // The index should already have been created on all new GTFS by transify-api,
                // but for old GTFS files, we need to create this index to speed up querying vehicle positions
                db.exec("create index if not exists idx_stop_times_trip_id on stop_times (trip_id, stop_sequence);")

                return new UpdatingGtfsFeed(agency, db, time);
            } catch (err: any) {
                if (err?.code === 'SQLITE_BUSY') {
                    console.log("Locked waiting for db...", agency)
                } else {
                    console.log('err is', err)
                    throw err
                }
            }
        }
        throw new Error("Could not open db--too many attempts waiting for lock")
    }


    static async getFeed(agency: string, time: number): Promise<UpdatingGtfsFeed> {
        const found = UpdatingGtfsFeed.AGENCY_MAP.find(agency, time);

        console.log("Returning feed for", agency, found?.formatted_date)
        if (found === undefined) {
            const newFeed = await UpdatingGtfsFeed.openWait(agency, time);
            UpdatingGtfsFeed.AGENCY_MAP.push(newFeed);
            return newFeed;
        } else {
            return found;
        }
    }

    async update() {
        // TODO: remove
        return
        // console.log("Locking database...", this.agency)
        // await waitForLock(this.db);
        // console.log("Lock successful!", this.agency);
        // await downloadFromGtfsService(this.agency);
        //
        // closeDb(this.db);
        // this.db = openDb(config, this.agency);
    }

    static async updateAll() {
        // TODO: remove
        console.log("Resetting", UpdatingGtfsFeed.AGENCY_MAP)
        for (const agency in UpdatingGtfsFeed.AGENCY_MAP) {
            await UpdatingGtfsFeed.AGENCY_MAP[agency].update();
        }
    }

    getTerminalDepartureTime(trip_id: string): string {
        // Returns the departure time of the last stop in a trip
        const statement = this.db.prepare("SELECT departure_time FROM stop_times WHERE trip_id=@trip_id ORDER BY stop_sequence ASC LIMIT 1");
        const row = statement.get({trip_id: trip_id});
        // @ts-ignore
        return row.departure_time;
    }
    getShapesAsGeoJSON(query: Record<string, any>) {
        return getShapesAsGeoJSON(query, {db: this.db});
    }
    getShapeByTripID(trip_id: string): Shape {
        if (this.shapes_cache[trip_id]) {
            return this.shapes_cache[trip_id]
        }

        const query = this.db.prepare(
            `SELECT s.* FROM trips t INNER JOIN shapes s ON t.shape_id = s.shape_id WHERE
                t.trip_id = @trip_id ORDER BY CAST(s.shape_pt_sequence as integer) ASC
                `)
        const rows: any[] = query.all({trip_id: trip_id})

        const coordinates: [number, number][] = []
        for (const row of rows) {
            coordinates.push([row.shape_pt_lon, row.shape_pt_lat])
        }

        this.shapes_cache[trip_id] = new Shape({
            type: "LineString",
            coordinates
        })
        return this.shapes_cache[trip_id]
    }

    getRoutes(query: Record<string, any>, fields: Array<string>) {
        return getRoutes(query, fields, undefined, {db: this.db})
    }

    getStops(query: Record<string, any>, fields: Array<string>) {
        return getStops(query, fields, undefined, {db: this.db})
    }

    getStopLocation(stop_id: string): [number, number] {
        // Returns a tuple of lat, lon coordinates for a stop_id
        const ret = this.getStops({stop_id: stop_id}, ['stop_lat', 'stop_lon'])[0];
        return [parseFloat(ret.stop_lat),parseFloat(ret.stop_lon)];
    }
    getStoptimes(query: Record<string, any>, fields: Array<string>) {
        return getStoptimes(query, fields, undefined, {db: this.db})
    }

    getTrips(query: Record<string, any>, fields: Array<string>) {
        return getTrips(query, fields, undefined, {db: this.db})
    }

    close() {
        closeDb(this.db);
    }
}

