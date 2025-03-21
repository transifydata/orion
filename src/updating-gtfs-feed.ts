import fs from "fs";
import {getStops, getStoptimes, getTrips, openDb as openDb_internal, SqlResults} from "gtfs";
import axios from "axios";
import {Shape} from "./shape";
import BetterSqlite3, {Database} from "better-sqlite3";
import {formatDate} from "./transify-api-connector";
import {fieldList} from "aws-sdk/clients/datapipeline";
import { Stop } from "./stop";

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
    const url = `https://api.transify.ca/api/gtfs/urls?agency=${agency}&date=${formatDate(new Date(time))}`;
    console.log("Requesting from transify api", url);
    const response = await axios({
        method: "get",
        url,
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
        url: `https://api.transify.ca/api/gtfs/db?agency=${agency}&date=${formatDate(new Date(time))}`,
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

        if (found === undefined) {
            console.log("Feed not found, opening...", agency, time);
            const newFeed = await UpdatingGtfsFeed.openWait(agency, time);
            UpdatingGtfsFeed.AGENCY_MAP.push(newFeed);
            return newFeed;
        } else {
            return found;
        }
    }

    getTerminalDepartureTime(trip_id: string): string {
        // Returns the departure time of the first stop in a trip
        const statement = this.db.prepare(
            "SELECT departure_time FROM stop_times WHERE trip_id=@trip_id ORDER BY CAST(stop_sequence AS INT) ASC LIMIT 1",
        );

        const row = statement.get({trip_id: trip_id}) as {departure_time: string};

        if (!row) {
            return "UNKNOWN TIME";
        }

        return row.departure_time;
    }

    getShapeByTripID(trip_id: string, get_stops: boolean = false): Shape | undefined {
        if (this.shapes_cache[trip_id]) {
            if (!get_stops || this.shapes_cache[trip_id].has_stops) {
                // Can only use the shapes cache if we're not getting stops, or if the shape already has stops
                return this.shapes_cache[trip_id];
            }
        }
        
        const query = this.db.prepare(
            `SELECT s.*, t.trip_id
             FROM trips t
             INNER JOIN shapes s ON t.shape_id = s.shape_id
             WHERE t.trip_id = @trip_id
             ORDER BY CAST(s.shape_pt_sequence as integer)
             ASC`
        );
        const rows: any[] = query.all({trip_id: trip_id});

        const coordinates: [number, number][] = [];

        if (rows.length == 0) {
            // console.warn( "Couldn't find any shapes for trip", trip_id);
            return undefined;
        }

        for (const row of rows) {
            coordinates.push([asNumber(row.shape_pt_lon), asNumber(row.shape_pt_lat)]);
        }

        // IDEA: get all stops of the trip_id as well and project them along the shape.
        // then - can input the live vehicle's position
        const stops: Stop[] = [];

        if (get_stops) {
            const stop_rows: any[] = this.db.prepare(
                `SELECT s.stop_id, s.stop_lat, s.stop_lon 
                FROM stops s
                INNER JOIN stop_times st ON s.stop_id = st.stop_id
                WHERE st.trip_id = @trip_id
                ORDER BY CAST(st.stop_sequence as integer)
                ASC`
            ).all({trip_id: trip_id});

            for (const stop of stop_rows) {
                stops.push(new Stop(
                    stop.stop_id,
                    asNumber(stop.stop_lat),
                    asNumber(stop.stop_lon)
                ));
            }
        }

        this.shapes_cache[trip_id] = new Shape({
            type: "LineString",
            coordinates,
        }, trip_id, stops, get_stops);

        return this.shapes_cache[trip_id];
    }

    getStops(query: Record<string, any>, fields: Array<string>): Array<Record<string, any>> {
        return getStops(query, fields, undefined, {db: this.db});
    }

    getStopLocation(stop_id: string): [number, number] {
        // Returns a tuple of lat, lon coordinates for a stop_id
        const ret = this.getStops({stop_id: stop_id}, ["stop_lat", "stop_lon"])[0];
        return [parseFloat(ret.stop_lat), parseFloat(ret.stop_lon)];
    }

    getStoptimes(query: Record<string, any>, fields: Array<string>): Array<Record<string, any>> {
        return getStoptimes(query, fields, undefined, {db: this.db});
    }
    getTrip(tripId: string, fields: Array<string>): Record<string, any> | undefined {
        const result = getTrips({trip_id: tripId}, fields, undefined, {db: this.db});
        if (result.length === 0) {
            return undefined;
        } else {
            return result[0];
        }
    }

    date_contains(date: Date): boolean {
        return this.valid_start <= date && this.valid_end >= date;
    }
}
