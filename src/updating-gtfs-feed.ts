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
import {getCurrentFormattedDate} from "./transify-api-connector";

const config = {
  sqlitePath: undefined as string | undefined,
  agencies: [
    {
      url: "https://www.brampton.ca/EN/City-Hall/OpenGov/Open-Data-Catalogue/Documents/Google_Transit.zip",
      prefix: undefined,
    },
    {
      // Peterborough
      url: "http://pt.mapstrat.com/current/google_transit.zip",
      // To avoid ID conflicts with other agencies
      // the library stores all the GTFS items in a single SQLite table
      prefix: "peterborough",
    },
    {
      url: "https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip",
    },
  ],
};

function openDb(config, agency) {
    config.sqlitePath = getFilepath(agency);
    return openDb_internal(config);
}

function getFilepath(agency): string {
    return `gtfs-${agency}.db`;
}



async function downloadFromGtfsService(agency: string) {
    const response = await axios({
        method: 'get',
        url: `https://staging-api.transify.ca/api/gtfs/db?agency=${agency}&date=${getCurrentFormattedDate()}`,
        responseType: 'stream', // Important to handle the response as a stream
    });

    if (response.status !== 200) {
        throw new Error("Could not download GTFS" + response.status + response.statusText)
    }
    const writer = fs.createWriteStream(getFilepath(agency));
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

export class UpdatingGtfsFeed {

    static AGENCY_MAP: Record<string, UpdatingGtfsFeed> = {};

    agency: string;
    db: Database | undefined;

    private constructor(agency, db) {
        this.agency = agency;
        this.db = db;
    }

    static async initializeAll() {
        for (const agency of ["brampton", "barrie", "go_transit"]) {
            UpdatingGtfsFeed.AGENCY_MAP[agency] = await UpdatingGtfsFeed.openWait(agency);
        }
    }

    static async openWait(agency: string): Promise<UpdatingGtfsFeed> {
        // If file doesn't exist, then download it
        console.log("Opening ", agency, "...")
        if (!fs.existsSync(getFilepath(agency))) {
            console.log("Downloading GTFS...", agency)
            await downloadFromGtfsService(agency);
        }
        let max_iters = 0;
        while (max_iters <= 5) {
            max_iters += 1;
            try {
                const db = openDb(config, agency);
                console.log("Successfully opened", agency)

                return new UpdatingGtfsFeed(agency, db);
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


    static async getFeed(agency: string): Promise<UpdatingGtfsFeed> {
        if (UpdatingGtfsFeed.AGENCY_MAP[agency] === undefined) {
            UpdatingGtfsFeed.AGENCY_MAP[agency] = await UpdatingGtfsFeed.openWait(agency);
            await UpdatingGtfsFeed.AGENCY_MAP[agency].update();
        }
        console.log("Returning feed for", agency)
        return UpdatingGtfsFeed.AGENCY_MAP[agency];
    }

    async update() {
        console.log("Locking database...", this.agency)
        await waitForLock(this.db);
        console.log("Lock successful!", this.agency);
        await downloadFromGtfsService(this.agency);
        closeDb(this.db);

        this.db = openDb(config, this.agency);
    }

    static async updateAll() {
        console.log("Resetting", UpdatingGtfsFeed.AGENCY_MAP)
        for (const agency in UpdatingGtfsFeed.AGENCY_MAP) {
            await UpdatingGtfsFeed.AGENCY_MAP[agency].update();
        }
    }

    getShapesAsGeoJSON(query: Record<string, any>) {
        return getShapesAsGeoJSON(query, {db: this.db});
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

