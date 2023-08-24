import express from 'express'
import morgan from 'morgan'

import * as sql from './sinks/sqlite-sink.js'
import cors from 'cors'
import {getAllRoutesWithShapes, resetGtfs, Route} from "./gtfs-parser";
import {UpdatingGtfsFeed} from "./updating-gtfs-feed";


const app = express();

app.use(cors())

await UpdatingGtfsFeed.initializeAll();


let ROUTES_CACHE: Route[] | undefined = undefined;

app.use(morgan("tiny"));
app.get('/routes/brampton', async (req, res) => {
    if (ROUTES_CACHE === undefined) {
        ROUTES_CACHE = await getAllRoutesWithShapes('brampton');
        res.json(ROUTES_CACHE);
    } else {
        res.json(ROUTES_CACHE);
    }
});


app.get('/positions/:agency', async (req, res) => {
    const agency = req.params.agency;

    if (agency === 'brampton') {
        res.json(await sql.getVehicleLocations(agency))
    } else {
        throw Error("Unsupported agency " + agency)
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