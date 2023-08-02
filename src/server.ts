import express from 'express'

import * as sql from './sinks/sqlite-sink.js'
import cors from 'cors'
import {FeatureCollection} from "@turf/helpers";
import {getAllRoutesWithShapes, parseGTFS, Route} from "./gtfs-parser";


const app = express();

app.use(cors())


await parseGTFS();


let ROUTES_CACHE: Route[] | undefined = undefined;

// app.get('/test', async (req, res) => {
//     const routes = await getAllRoutesWithShapes();
// })

app.get('/routes/brampton', async (req, res) => {
    if (ROUTES_CACHE === undefined || true) {
        ROUTES_CACHE = await getAllRoutesWithShapes();
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
app.listen(4000,() => {
    console.log(`[server]: Server is running at http://localhost:4000`);
})