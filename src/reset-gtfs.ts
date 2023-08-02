import {resetGtfs} from "./gtfs-parser";

let isBetween2Am3Am = false;

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
        return resetGtfs();
    }
}