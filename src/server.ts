import {parseGTFS} from "./gtfs-parser";
import express from 'express'

import * as sql from './sinks/sqlite-sink'
import cors from 'cors'
import * as fs from "fs";


const app = express();

app.use(cors())

// Uncomment to load the GTFS (it's currently loaded and already exists in gtfs.db
// parseGTFS().catch(e => {
//     console.log("Got error!", e)
//     throw e
// })

app.get('/positions/:agency', async (req, res) => {
    const agency = req.params.agency;

    if (agency === 'brampton') {
        res.json(await sql.getVehicleLocations(agency))
    } else {
        throw Error("Unsupported agency " + agency)
    }
});

app.listen(3001, () => {
    console.log(`[server]: Server is running at http://localhost:3001`);
})