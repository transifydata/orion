import {Agency} from "./index";

export const config: {agencies: Agency[]; s3_bucket: string} = {
    s3_bucket: "orion-vehicles",
    agencies: [
        {
            id: "brampton",
            provider: "gtfs-realtime",
            gtfs_realtime_url: "https://nextride.brampton.ca:81/API/VehiclePositions?format=gtfs.proto",
            tripUpdatesUrl: "https://nextride.brampton.ca:81/API/TripUpdates?format=gtfs.proto",
        },
        // {
        //     "id": "ttc",
        //     "provider": "nextbus",
        //     "nextbus_agency_id": "ttc"
        // },
        //{
        //     "id": "grt",
        //     "provider": "gtfs-realtime",
        //     "gtfs_realtime_url": "http://webapps.regionofwaterloo.ca/api/grt-routes/api/vehiclepositions",
        //     "tripUpdatesUrl": "https://webapps.regionofwaterloo.ca/api/grt-routes/api/tripupdates"
        //},
        // {
        //     "id": "peterborough",
        //     "provider": "gtfs-realtime",
        //     "gtfs_realtime_url": "http://pt.mapstrat.com/current/gtfrealtime_VehiclePositions.bin"
        // },
        {
             id: "barrie",
             provider: "gtfs-realtime",
             gtfs_realtime_url: "http://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb",
        },
        {
            id: "metro-mn",
            provider: "gtfs-realtime",
            tripUpdatesUrl: "https://svc.metrotransit.org/mtgtfs/tripupdates.pb",
            gtfs_realtime_url: "https://svc.metrotransit.org/mtgtfs/vehiclepositions.pb",
        },
        //{
        //     id: "go_transit",
        //     provider: "gtfs-realtime",
        //     tripUpdatesUrl: "https://api.openmetrolinx.com/OpenDataAPI/api/V1/Gtfs/Feed/TripUpdates?key=30021152",
        //     gtfs_realtime_url:
        //         "https://api.openmetrolinx.com/OpenDataAPI/api/V1/Gtfs/Feed/VehiclePosition?key=30021152",
        // },
        // Add new agencies here:
    ],
};
export const IS_PROD = process.env.NODE_ENV === "production";