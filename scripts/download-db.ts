import {UpdatingGtfsFeed} from "../src/updating-gtfs-feed"
import {TimeTz} from "../src/Date"
import AWS from "aws-sdk";

import sqlite3 from "sqlite3";

import {openDb, orionBackupS3Bucket} from "../src/sinks/sqlite-tools"

export class DatabaseChunk {
    sqlitePath: string;
    startTime: TimeTz;
    endTime: TimeTz;

    private db: sqlite3.Database
    
    private constructor(sqlitePath: string, startTime: TimeTz, endTime: TimeTz, db: sqlite3.Database) {
        this.sqlitePath = sqlitePath;
        this.startTime = startTime;
        this.endTime = endTime;
        this.db = db;
    }


    static async create(sqlitePath: string, startTime: TimeTz, endTime: TimeTz) {
        const db = await openDb(sqlitePath, false)
        await db.migrate({
        });

        return new DatabaseChunk(sqlitePath, startTime, endTime, db)
    }
    
    async mergeInto(other: DatabaseChunk) {
        await this.db.exec( `
        ATTACH '${other.sqlitePath}' AS other;
        INSERT OR IGNORE INTO vehicle_position SELECT * FROM other.vehicle_position;
        INSERT OR IGNORE INTO trip_update SELECT * FROM other.trip_update;
        DETACH DATABASE other;
            `)
    }
}

export interface S3Info {
    date: string
    startTime: TimeTz
    endTime: TimeTz
}

const TMP_PATH = "/tmp"

const s3 = new AWS.S3();

function parseS3Name(s3Name: string): S3Info {
    const regex = /orion-backup-(\d+)-(\d+)-(\d+)\.db\.gz/;
    const match = s3Name.match(regex);
    if (match && match.length === 4) {
      const [, date, startTimeString, endTimeString] = match;
      const startTime = new TimeTz(parseInt(startTimeString), "America/Toronto");
      const endTime = new TimeTz(parseInt(endTimeString), "America/Toronto");
      return { date, startTime, endTime };
    } else {
      throw new Error('Invalid S3 object key format');
    }
}

async function listFilesInRange(startDate: TimeTz, endDate: TimeTz): Promise<string[]> {
    const prefix = 'orion-backup-';
    const startAfter = `orion-backup-${startDate.dayAsYYYYMMDD()}-`;
    const params = {
        Bucket: orionBackupS3Bucket,
        StartAfter: startAfter,
        Prefix: prefix
    };

    const response = await s3.listObjectsV2(params).promise();

    const endDayYYYYMMDD = endDate.dayAsYYYYMMDD()
    const validFiles: string[] = []
    for (const file of response.Contents!) {
        const {date} = parseS3Name(file.Key!)
        if (date > endDayYYYYMMDD) {
            break;
        }

        validFiles.push(file.Key!)
    }

    return validFiles;
}

async function getDbChunk(s3Name: string): Promise<DatabaseChunk> {
    const params = {
      Bucket: orionBackupS3Bucket, // Replace 'your-bucket-name' with your S3 bucket name
      Key: s3Name // The name of the file you want to download from S3
    };
  
    try {
      const data = await s3.getObject(params).promise();
      const regex = /orion-backup-(\d+)-(\d+)-(\d+)\.db\.gz/;
      const match = s3Name.match(regex);
      if (match && match.length === 4) {
        const sqlitePath = TMP_PATH + "/" + s3Name
        const {startTime, endTime} = parseS3Name(s3Name)

        return await DatabaseChunk.create( sqlitePath, startTime, endTime );
      } else {
        throw new Error('Invalid S3 object key format');
      }
    } catch (error) {
      console.error('Error downloading file from S3:', error);
      throw error;
    }
}

async function downloadDatabaseChunks(startDate: TimeTz, endDate: TimeTz) {
    const files = await listFilesInRange(startDate, endDate);
    const databaseChunks: DatabaseChunk[] = [];

    for (const file of files) {
        const databaseChunk = await getDbChunk(file);
        databaseChunks.push(databaseChunk);
    }

    return databaseChunks;
}

async function joinDatabaseChunks(chunks: Array<DatabaseChunk>): Promise<DatabaseChunk> {
    if (chunks.length === 0) {
        throw Error("No chunks found!")
    }
    
    const mainChunk = chunks[0];
    
    for (let i = 1; i < chunks.length; i++) {
        const curChunk = chunks[i];

        mainChunk.mergeInto(curChunk)
    }

    return mainChunk
}

// Parse command line arguments
const args = process.argv.slice(2);
const startDate = new TimeTz(parseInt(args[0]), "America/Toronto");
const endDate = new TimeTz(parseInt(args[1]), "America/Toronto");

// Run the script
downloadDatabaseChunks(startDate, endDate)
    .then(databaseChunks => {
        return joinDatabaseChunks(databaseChunks)
    }).then(joined => {
        console.log("Joined database chunk!", joined)
    })
    .catch(error => {
        console.error('Error:', error);
    });

// const databaseChunks = [
//     await DatabaseChunk.create("o10", new TimeTz(Date.now(), "America/Toronto"), new TimeTz(Date.now(), "America/Toronto")),
//     await DatabaseChunk.create("o1", new TimeTz(Date.now(), "America/Toronto"), new TimeTz(Date.now(), "America/Toronto")),
//     await DatabaseChunk.create("o2", new TimeTz(Date.now(), "America/Toronto"), new TimeTz(Date.now(), "America/Toronto")),
//     await DatabaseChunk.create("o3", new TimeTz(Date.now(), "America/Toronto"), new TimeTz(Date.now(), "America/Toronto")),
//     await DatabaseChunk.create("o4", new TimeTz(Date.now(), "America/Toronto"), new TimeTz(Date.now(), "America/Toronto")),
//     await DatabaseChunk.create("o5", new TimeTz(Date.now(), "America/Toronto"), new TimeTz(Date.now(), "America/Toronto")),
// ]
//
// await joinDatabaseChunks(databaseChunks)