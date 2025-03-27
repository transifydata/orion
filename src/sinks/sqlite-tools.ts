import sqlite3 from "sqlite3";
import {Database, open} from "sqlite";
import fs, {rmSync} from "fs";
import AWS from "aws-sdk";
import {TimeTz} from "../Date";
import zlib from "zlib";

import {IS_PROD} from "orion-lambda/config";

export const orionBackupS3Bucket = "orion-db-snapshots";
const databasePath = (process.env["ORION_DATABASE_PATH"] || ".") + "/orion-database.db";
let lastPruned = 0;

export async function openDb(path: string = databasePath, readOnly = false): Promise<Database> {
    /* Opens a database using the *sqlite3* library at `path`. */
    const {OPEN_READONLY, OPEN_READWRITE, OPEN_CREATE} = sqlite3;
    const mode = readOnly ? OPEN_READONLY : OPEN_READWRITE | OPEN_CREATE;

    try {
        return open({
            filename: path,
            mode,
            driver: sqlite3.cached.Database,
        });
    } catch (e) {
        console.error("Error opening database:", e);
        throw e;
    }
}

export async function migrateDbs() {
    console.log("Starting migrations...");
    const db = await openDb();
    console.log("Migrating...");
    await db.migrate();

    await db.run("PRAGMA journal_mode = WAL;");
}

export async function pruneDb(db: Database, currentTime: number) {
    // Prune the database every 24 hours
    if (currentTime - lastPruned > 24 * 3600 * 1000) {
        console.log("Pruning...");
        lastPruned = currentTime;
        // // Prune all records older than 120 days ago
        // const prunePast = currentTime - 120 * 24 * 3600 * 1000;
        // const deletedRows1 = await db.run(`DELETE FROM trip_update WHERE server_time < ${prunePast}`);
        // const deletedRows2 = await db.run(`DELETE FROM vehicle_position WHERE server_time < ${prunePast}`);
        //
        // console.log("Pruned ", deletedRows1.changes, deletedRows2.changes);

        await snapshotDb(db);
    }
}

async function copyTable(source: Database, destSchema: string, table: string, startTime: number, endTime: number) {
    /*
    Copies a table from `source` to `destSchema` with the same name.
    REQUIRES that destSchema is already attached to the database via ATTACH command.
     */

    // Truncate the backup table if it exists, because we are reusing this same backup db for snapshots.
    await source.run(`DELETE FROM ${destSchema}.${table}`);

    const rowEstimate = (await source.get(`SELECT COUNT(*) as count FROM ${table} WHERE server_time >= ? AND server_time <= ?`, startTime, endTime)).count;
    console.log("Copying table", table, "to", destSchema, "with", rowEstimate, "rows");

    await source.run(`INSERT INTO ${destSchema}.${table} SELECT * FROM ${table} WHERE server_time >= ? AND server_time <= ?`, startTime, endTime);

}

const s3 = new AWS.S3();

async function uploadToS3(bucket: string, key: string, filename: string): Promise<AWS.S3.ManagedUpload.SendData | undefined> {
    // Create a read stream for the local file
    const fileStream = fs.createReadStream(filename);

    // Create a gzip stream
    const gzipStream = zlib.createGzip();

    // Chain the file stream into the gzip stream
    fileStream.pipe(gzipStream);

    // Prepare parameters for the S3 upload
    const params: AWS.S3.PutObjectRequest = {
        Bucket: bucket,
        Key: key,
        Body: gzipStream // Use the gzip stream as the Body
    };

    const uploadPromise = s3.upload(params).promise();

    let data: AWS.S3.ManagedUpload.SendData | undefined = undefined;
    try {
        console.log("Uploading to S3...")
        data = await uploadPromise;
        console.log("File uploaded successfully. S3 location:", data.Location);
        return data;
    } catch (err) {
        console.error("Error uploading file to S3:", err);
    }

}

function removeIfExists(filename: string) {
    try {
        rmSync(filename);
    } catch (e) {
        // Ignore
    }
}
export async function snapshotDb(db: Database, startTime: number | undefined = undefined, endTime: number | undefined = undefined): Promise<AWS.S3.ManagedUpload.SendData | undefined> {
    /*
    Snapshots the orion-database to S3. If `startTime` is not provided, the default is the last 24 hours.
    By default, it's run every 24 hours as part of the pruneDb function.
     */
    if (startTime === undefined) {
        // Default snapshot is last 24 hours
        startTime = Date.now() - 24 * 3600 * 1000;
        endTime = Date.now()
    } else {
        endTime = endTime || Date.now();
    }


    const backupName = `backup_${startTime}_${endTime}_${Date.now()}`;
    const backupDb = await openDb(backupName)
    await backupDb.migrate();

    await db.run(`ATTACH DATABASE ? AS ${backupName}`, backupName);

    await copyTable(db, backupName, "vehicle_position", startTime, endTime);
    await copyTable(db, backupName, "trip_update", startTime, endTime);
    await db.run(`DETACH DATABASE ${backupName}`);


    const currentDate = new TimeTz(startTime, "America/Toronto");

    // Only upload to S3 if we are prod
    if (IS_PROD) {
        const uploadData = await uploadToS3(orionBackupS3Bucket, `orion-backup-${currentDate.dayAsYYYYMMDD()}-${startTime}-${endTime}.db.gz`, backupName);
        fs.rmSync(backupName);

        return uploadData;
    }
}