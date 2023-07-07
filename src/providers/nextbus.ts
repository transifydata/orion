import axios from 'axios'


interface VehiclePosition {
    rid: number;
    vid: number;
    lat: number;
    lon: number;
    heading: number | null;
    did: string;
    secsSinceReport: number;
    leadingVid?: string;
}

export function getVehicles(config) {
    if (!config.nextbus_agency_id) {
        throw new Error("nextbus config missing nextbus_agency_id");
    }

    const url = 'http://retro.umoiq.com//service/publicJSONFeed?command=vehicleLocations&t=0&a=' + config.nextbus_agency_id;
    console.log('fetching vehicles from ' + url);
    return axios.get(url)
        .then((response) => {
            const data = response.data;
            const vehicles = data.vehicle;
            if (!vehicles) {
                return [];
            } else if (vehicles.id) { // one vehicle
                return [makeVehicle(vehicles)];
            } else {
                return vehicles.map(nextbusObject => makeVehicle(nextbusObject));
            }
        });
}

function makeVehicle(nextbusObject): VehiclePosition {
    // Nextbus JSON API returns vehicles like this:
    // {"id":"2034","lon":"-122.397728","routeTag":"N","predictable":"true","speedKmHr":"0","dirTag":"N____O_F00","leadingVehicleId":"2036","heading":"219","lat":"37.773411","secsSinceReport":"50"}
    // note: speedKmHr, predictable currently ignored

    const {
        id,
        routeTag,
        lat,
        lon,
        heading,
        dirTag,
        secsSinceReport,
        leadingVehicleId,
    } = nextbusObject;

    var latFloat = parseFloat(lat);
    var lonFloat = parseFloat(lon)
    var headingInt = parseInt(heading, 10);
    var secsSinceReportInt = parseInt(secsSinceReport, 10);

    return {
        rid: routeTag,
        vid: id,
        lat: latFloat,
        lon: lonFloat,
        heading: isNaN(headingInt) ? null : headingInt,
        did: dirTag,
        secsSinceReport: secsSinceReportInt,
        leadingVid: leadingVehicleId,
    };
}
