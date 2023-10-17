// Resets the GTFS every night at 3AM to make sure the most recent GTFS is pulled and used


import {resetGtfs} from "./gtfs-parser";

let isBetween2Am3Am = false;
let dayCounter = 0;

export async function resetGtfsIfNeeded() {
    const currentDateUTC = new Date();
    const torontoTimeOptions = { timeZone: 'America/Toronto', hour: '2-digit', hourCycle: "h24" };
    // @ts-ignore
    let currentHourInToronto = parseInt(currentDateUTC.toLocaleString('en-US', torontoTimeOptions));

    if (currentHourInToronto === 2) {
        isBetween2Am3Am = true;
    }

    if (isBetween2Am3Am && currentHourInToronto >= 3) {
        // Just passed 3am, reset GTFS
        isBetween2Am3Am = false;
        dayCounter += 1;
    }

    // Reset only every thirty days
    if (dayCounter % 30 == 0) {
        return resetGtfs();
    }
}