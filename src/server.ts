import express from 'express'

import * as sql from './sinks/sqlite-sink.js'
import cors from 'cors'
import {parseGTFS} from "./gtfs-parser";


const app = express();

app.use(cors())



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