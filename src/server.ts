import express from "express";
import morgan from "morgan";

import cors from "cors";
import {
  getAllRoutesWithShapes,
  Route,
} from "./gtfs-parser";
import getVehicleLocations from "./get-vehicle-locations";
import {migrateDbs} from "./sinks/sqlite-tools";

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

app.get('/', async (req, res) => {
    res.sendStatus(200);
})

app.get('/reset', async (req, res) => {
    res.sendStatus(204);
})


function errorHandler (err, req, res, next) {
    res.json({ error: err.message })
}
function logErrors (err, req, res, next) {
    console.error("ERROR", err.stack, err)
    next(err)
}

app.use(logErrors)
app.use(errorHandler)
app.listen(4000,() => {
    console.log(`[server]: Server is running at http://localhost:4000`);
})

