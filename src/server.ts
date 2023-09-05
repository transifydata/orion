import express from "express";
import morgan from "morgan";

import * as sql from "./sinks/sqlite-sink.js";
import cors from "cors";
import { getAllRoutesWithShapes, resetGtfs, Route } from "./gtfs-parser";
import { UpdatingGtfsFeed } from "./updating-gtfs-feed";

const app = express();

app.use(cors())

await UpdatingGtfsFeed.initializeAll();


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
    res.json(await sql.getVehicleLocations(agency))
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