import express from "express";
import morgan from "morgan";

import cors from "cors";
import {getAllRoutesWithShapes, Route} from "./gtfs-parser";
import getVehicleLocations from "./get-vehicle-locations";
import {migrateDbs, openDb, snapshotDb} from "./sinks/sqlite-tools";
import {IS_PROD} from "./config";

const app = express();

app.use(cors())

await migrateDbs();

let ROUTES_CACHE: Record<string, Route[]> = {};

app.use(morgan("tiny"));
app.get('/routes/:agency', async (req, res, next) => {
    try {
        const agency = req.params.agency;

        if (ROUTES_CACHE[agency] === undefined) {
            ROUTES_CACHE[agency] = await getAllRoutesWithShapes(agency);
            res.json(ROUTES_CACHE[agency]);
        } else {
            res.json(ROUTES_CACHE[agency]);
        }
    } catch (e) {
        next(e);
    }
});


app.get('/positions/:agency', async (req, res, next) => {
    try {
      const agency = req.params.agency;
      let time = Date.now();

      if (req.query.time && typeof req.query.time === "string") {
        time = parseInt(req.query.time); // Parse the "time" parameter as an integer
      }

        const response = await getVehicleLocations(agency, time);

      res.json(response);
    } catch (e) {
        next(e)
    }
});

console.log("IS_PROD", IS_PROD)
app.get('/snapshot', async (req, res) => {
    const auth = req.headers.authorization;
    if (IS_PROD && auth !== process.env.SNAPSHOT_AUTH) {
        res.sendStatus(401);
        return;
    }
    const startTime: number | undefined = typeof req.query.startTime === "string" ? parseInt(req.query.startTime) : undefined
    const endTime: number | undefined = typeof req.query.endTime === "string" ? parseInt(req.query.endTime) : undefined

    try {
        const uploadData = await snapshotDb(await openDb(), startTime, endTime)
        res.json(uploadData);
    } catch (e) {
        console.error("Error taking snapshot: ", e)
        res.status(500).json({error: e.message})
    }
})

app.get('/', async (req, res) => {
    res.sendStatus(200);
})

app.get('/reset', async (req, res) => {
    res.sendStatus(204);
})


function errorHandler (err, req, res, next) {
    console.log("error handler")
    res.json({ error: err.message })
}
function logErrors (err, req, res, next) {
    console.error("ERROR1", err.stack, err)
    next(err)
}

app.use(logErrors)
app.use(errorHandler)
app.listen(4000,() => {
    console.log(`[server]: Server is running at http://localhost:4000`);
})

