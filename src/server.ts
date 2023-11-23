import express from "express";
import morgan from "morgan";

import { migrateDbs } from "./sinks/sqlite-sink.js";
import cors from "cors";
import {
  getAllRoutesWithShapes,
  resetGtfs,
  Route,
} from "./gtfs-parser";
import { UpdatingGtfsFeed } from "./updating-gtfs-feed";
import { getLiveVehicleLocations } from "./get-live-vehicle-locations";
import {getScheduledVehicleLocations} from "./get-scheduled-vehicle-locations";
import getVehicleLocations from "./get-vehicle-locations";

const app = express();

app.use(cors())

await UpdatingGtfsFeed.initializeAll();
await migrateDbs();

let ROUTES_CACHE: Record<string, Route[]> = {};

app.use(morgan("tiny"));
app.get('/routes/:agency', async (req, res) => {
    const agency = req.params.agency;
    
    if (ROUTES_CACHE[agency] === undefined) {
        ROUTES_CACHE[agency] = await getAllRoutesWithShapes(agency);
        res.json(ROUTES_CACHE[agency]);
    } else {
        res.json(ROUTES_CACHE[agency]);
    }
});


app.get('/positions/:agency', async (req, res) => {
    const agency = req.params.agency;
    let time = Date.now();

    if (req.query.time && typeof req.query.time === 'string') {
        time = parseInt(req.query.time); // Parse the "time" parameter as an integer
    }

    if (req.query.live === 'true') {
        res.json(await getVehicleLocations(agency, time))
        return;
    } else {
        res.json(await getLiveVehicleLocations(agency, time))
    }
});

app.get('/', async (req, res) => {
    res.sendStatus(200);
})

app.get('/reset', async (req, res) => {
    await resetGtfs();
    res.sendStatus(204);
})
app.listen(4000,() => {
    console.log(`[server]: Server is running at http://localhost:4000`);
})