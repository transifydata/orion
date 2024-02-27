import fs from "fs";
import {getStops, getStoptimes, getTrips, openDb as openDb_internal} from "gtfs";
import axios from "axios";
import {Shape} from "./shape";
import BetterSqlite3, {Database} from "better-sqlite3";
import {formatDate} from "./transify-api-connector";

const config = {
    sqlitePath: undefined,
    agencies: [],
};

function openDb(config, filepath: string) {
    config.sqlitePath = filepath;
    return openDb_internal(config);
}

function getFilepath(agency: string, id: number): string {
    // Theoretically, only ID should be necessary, but we include agency in the filename for debugging purposes
    return `gtfs-${agency}-${id}.db`;
}

export interface GtfsFeedInfoResponse {
    zip_s3_url: string;
    db_s3_url: string;
    valid_start: Date;
    valid_end: Date;
    id: number;
}
async function getFeedInfoFromGtfsService(agency: string, time: number): Promise<GtfsFeedInfoResponse> {
    const response = await axios({
        method: "get",
        url: `https://staging-api.transify.ca/api/gtfs/urls?agency=${agency}&date=${formatDate(new Date(time))}`,
    });

    const data = response.data;
    return {
        zip_s3_url: data.zip_s3_url,
        db_s3_url: data.db_s3_url,
        valid_start: new Date(data.valid_start),
        valid_end: new Date(data.valid_end),
        id: data.id,
    } as GtfsFeedInfoResponse;
}

async function downloadFromGtfsService(agency: string, time: number, filepath: string) {
    const tempFilePath = filepath + ".temp";

    const response = await axios({
        method: "get",
        url: `https://staging-api.transify.ca/api/gtfs/db?agency=${agency}&date=${formatDate(new Date(time))}`,
        responseType: "stream",
        onDownloadProgress: progressEvent => {
            if (!progressEvent.total) {
                return;
            }

            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            console.log(`Downloading... ${percentCompleted}% ${progressEvent.loaded} / ${progressEvent.total}`);
        },
    });

    if (response.status !== 200) {
        throw new Error("Could not download GTFS: " + response.status + response.statusText);
    }

    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);

    console.log("Waiting for GTFS download...");

    await new Promise((resolve, reject) => {
        writer.on("finish", () => {
            resolve(void 0);
        });

        writer.on("error", err => {
            console.error("GTFS Download resulted in err", err);
            reject(err);
        });
    });

    // Rename the temporary file upon successful download
    fs.renameSync(tempFilePath, filepath);
    console.log("GTFS download completed successfully.");
}

function asNumber(x: any): number {
    if (typeof x === "number") {
        return x;
    } else if (typeof x === "string") {
        return parseFloat(x);
    } else {
        throw new Error(`asInt: invalid type ${x} ${typeof x}`);
    }
}
export class GtfsList {
    private inner: Array<UpdatingGtfsFeed> = [];

    constructor() {}

    public find(agency: string, time: number): UpdatingGtfsFeed | undefined {
        const date = new Date(time);
        const index = this.inner.findIndex(feed => feed.agency === agency && feed.date_contains(date));
        if (index === -1) {
            return undefined;
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
    valid_start: Date;
    valid_end: Date;
    id: number;
    db: Database;

    private constructor(agency: string, db: Database, valid_start: Date, valid_end: Date, id: number) {
        this.shapes_cache = {};
        this.agency = agency;
        this.db = db;
        this.valid_end = valid_end;
        this.valid_start = valid_start;
        this.id = id;
    }

    private static async openWait(agency: string, time: number): Promise<UpdatingGtfsFeed> {
        // If file doesn't exist, then download it
        const feedInfo = await getFeedInfoFromGtfsService(agency, time);
        const filepath = getFilepath(agency, feedInfo.id);
        console.log("Opening ", agency, filepath, "...");

        const existsButEmpty = fs.existsSync(filepath) && fs.statSync(filepath).size === 0;
        const doesntExist = !fs.existsSync(filepath);

        let downloaded = false;
        if (existsButEmpty || doesntExist) {
            downloaded = true;
            console.log("Downloading GTFS...", agency);
            try {
                await downloadFromGtfsService(agency, time, filepath);
            } catch (err) {
                console.error("Could not download GTFS", agency, err);
                throw err;
            }
        }
        let max_iters = 0;
        while (max_iters <= 5) {
            max_iters += 1;
            try {
                const db = openDb(config, filepath);

                if (downloaded) {
                    this.fix_gtfs_files(db);
                }
                console.log("Successfully opened", agency);

                return new UpdatingGtfsFeed(agency, db, feedInfo.valid_start, feedInfo.valid_end, feedInfo.id);
            } catch (err: any) {
                if (err?.code === "SQLITE_BUSY") {
                    console.log("Locked waiting for db...", agency);
                } else {
                    console.log("err is", err);
                    throw err;
                }
            }
        }
        throw new Error("Could not open db--too many attempts waiting for lock");
    }

    private static fix_gtfs_files(db: BetterSqlite3.Database) {
        // Some GTFS files don't follow the format we specify (e.g. missing tables)
        // Fix these files here. All the queries are idempotent (they use "IF NOT EXISTS" syntax) and are quick to run.

        // The index should already have been created on all new GTFS by transify-api,
        // but for old GTFS files, we need to create this index to speed up querying vehicle positions
        db.exec("create index if not exists idx_stop_times_trip_id on stop_times (trip_id, stop_sequence);");

        db.exec(
            "create index if not exists idx_stop_times_trip_id_arrival_time on stop_times (trip_id, arrival_time);",
        );

        db.exec("create index if not exists idx_trips_trip_id on trips (trip_id);");

        // Some GO-Transit GTFS files don't have a calendar.txt file, so fix it here
        db.exec(`create table if not exists calendar
                    (
                        service_id TEXT,
                        monday     TEXT,
                        tuesday    TEXT,
                        wednesday  TEXT,
                        thursday   TEXT,
                        friday     TEXT,
                        saturday   TEXT,
                        sunday     TEXT,
                        start_date TEXT,
                        end_date   TEXT
                    );
                `);
    }

    static async getFeed(agency: string, time: number): Promise<UpdatingGtfsFeed> {
        const found = UpdatingGtfsFeed.AGENCY_MAP.find(agency, time);

        console.log("Returning feed for", agency, "found?: ", found?.valid_start, "ID", found?.id);
        if (found === undefined) {
            const newFeed = await UpdatingGtfsFeed.openWait(agency, time);
            UpdatingGtfsFeed.AGENCY_MAP.push(newFeed);
            return newFeed;
        } else {
            return found;
        }
    }

    getTerminalDepartureTime(trip_id: string): string {
        // Returns the departure time of the last stop in a trip
        const statement = this.db.prepare(
            "SELECT departure_time FROM stop_times WHERE trip_id=@trip_id ORDER BY stop_sequence ASC LIMIT 1",
        );

        const row = statement.get({trip_id: trip_id});
        // @ts-ignore
        return row.departure_time;
    }
    getShapeByTripID(trip_id: string): Shape {
        if (this.shapes_cache[trip_id]) {
            return this.shapes_cache[trip_id];
        }

        const query = this.db.prepare(
            `SELECT s.* FROM trips t INNER JOIN shapes s ON t.shape_id = s.shape_id WHERE
                t.trip_id = @trip_id ORDER BY CAST(s.shape_pt_sequence as integer) ASC
                `,
        );
        const rows: any[] = query.all({trip_id: trip_id});

        const coordinates: [number, number][] = [];

        if (rows.length == 0) {
            const error = new Error("Couldn't find any shapes for trip");
            console.error(error, trip_id);
            throw new Error(error + ":" + trip_id);
        }

        for (const row of rows) {
            coordinates.push([asNumber(row.shape_pt_lon), asNumber(row.shape_pt_lat)]);
        }

        this.shapes_cache[trip_id] = new Shape({
            type: "LineString",
            coordinates,
        });
        return this.shapes_cache[trip_id];
    }

    getStops(query: Record<string, any>, fields: Array<string>) {
        return getStops(query, fields, undefined, {db: this.db});
    }

    getStopLocation(stop_id: string): [number, number] {
        // Returns a tuple of lat, lon coordinates for a stop_id
        const ret = this.getStops({stop_id: stop_id}, ["stop_lat", "stop_lon"])[0];
        return [parseFloat(ret.stop_lat), parseFloat(ret.stop_lon)];
    }

    getStoptimes(query: Record<string, any>, fields: Array<string>) {
        return getStoptimes(query, fields, undefined, {db: this.db});
    }

    getTrips(query: Record<string, any>, fields: Array<string>) {
        return getTrips(query, fields, undefined, {db: this.db});
    }

    date_contains(date: Date): boolean {
        return this.valid_start <= date && this.valid_end >= date;
    }
}
