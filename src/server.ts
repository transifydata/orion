import express from 'express'

import * as sql from './sinks/sqlite-sink.js'
import cors from 'cors'


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

app.get('/', async (req, res) => {
    res.sendStatus(200);
})
app.listen(4000,() => {
    console.log(`[server]: Server is running at http://localhost:4000`);
})