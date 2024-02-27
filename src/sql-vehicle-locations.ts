// Various SQL scripts for getting vehicle locations from the database

import {Database} from "sqlite";
import BetterSqlite3 from "better-sqlite3";
import {ClosestStopTime} from "./get-scheduled-vehicle-locations";

export async function sqlVehicleLocations(db: Database, time: number, agency: string) {
    const startTimeBuffer = time - 5 * 60 * 1000;

    return await db.all(
        `
WITH latest_vehicle_positions AS
( SELECT
        vp.*
        FROM vehicle_position vp
        INNER JOIN (
          SELECT vid, MAX(server_time) AS max_time, agency_id
          FROM vehicle_position
          WHERE server_time BETWEEN :start_time AND :end_time AND agency_id=:agency_id
          GROUP BY vid
        ) latest ON vp.vid = latest.vid AND vp.server_time = latest.max_time AND vp.agency_id = latest.agency_id),

    latest_trip_updates AS
   (SELECT
        tu.*
        FROM trip_update tu
        INNER JOIN (
          SELECT vehicle_id, MAX(server_time) AS max_time, agency_id
          FROM trip_update
          WHERE server_time BETWEEN :start_time AND :end_time AND agency_id=:agency_id
          GROUP BY vehicle_id
        ) latest ON tu.vehicle_id = latest.vehicle_id AND tu.server_time = latest.max_time and tu.agency_id = latest.agency_id)

        SELECT *, vp.server_time
        FROM latest_vehicle_positions vp
        LEFT OUTER JOIN latest_trip_updates tu
            ON tu.vehicle_id = vp.vid AND tu.trip_id=vp.tripId;`,
        {
            ":start_time": startTimeBuffer,
            ":end_time": time,
            ":agency_id": agency,
        },
    );
}

interface CalendarExceptionRow {
    service_id: string;
    exception_type: string;
}

interface CalendarException {
    // Specially enabled service_ids that will run on this day. We want to include this service_id in eligible trips
    enabled: string[];
    // Exclude these service_ids from eligible trips
    disabled: string[];
}

function parseCalendarException(rows: CalendarExceptionRow[]): CalendarException {
    const enabled = rows.filter(x => x.exception_type === "1").map(x => x.service_id);
    const disabled = rows.filter(x => x.exception_type === "2").map(x => x.service_id);
    return {enabled, disabled};
}

function singleQuote(s: string): string {
    return `'${s}'`;
}

export function getScheduledVehicleLocationsSQL(
    db: BetterSqlite3.Database,
    YYYYMMDD: string,
    dayOfWeek: string,
    timeOfDay: string,
    timeOfDayBefore: string,
    timeOfDayAfter: string,
    // Optional tripId to filter by. Used when we only care about scheduled locations for a specific trip (in calculateDistanceAlongRoute)
    tripIdFilter?: string,
): ClosestStopTime[] {
    let allFilters: string;

    const formattedDate = YYYYMMDD;

    if (tripIdFilter === undefined) {
        // No specific tripId, so we need to find all tripIds that are active today
        const exceptionServiceIdsEnabled: CalendarExceptionRow[] = db
            .prepare(`SELECT service_id, exception_type FROM calendar_dates WHERE date = ${formattedDate}`)
            .all() as CalendarExceptionRow[];

        const exceptionServiceIds = parseCalendarException(exceptionServiceIdsEnabled);
        console.log("Exception service ids: ", exceptionServiceIds);

        const serviceIdValidToday = "c.start_date <= @date AND c.end_date >= @date";
        // Default WHERE clause for filtering trips by day of the week
        const defaultDayOfWeekFilter = `
    (c.${dayOfWeek} = 1 AND c.start_date <= @date AND c.end_date >= @date)`;

        const enabledExceptionFilter = `t.service_id IN (${exceptionServiceIds.enabled.map(singleQuote).join(", ")})`;
        const disabledExceptionFilter = `t.service_id NOT IN (${exceptionServiceIds.disabled
            .map(singleQuote)
            .join(", ")})`;

        /* Rationale for why a tripId is active:
        1. The service_id has to be valid for today's date AND
        2. Exclude all trips that are an exception with type disabled AND
        3. The service_id has to be AND
            a. Explicitly enabled for today's date via exception OR
            b. the day of the week has to match the current date
         */
        const activeServiceIds = `(
            ${disabledExceptionFilter} AND 
            (
                (${defaultDayOfWeekFilter} AND ${serviceIdValidToday}) OR 
                (${enabledExceptionFilter})
            )
        ) `;

        // Some agencies don't use calendar feature in GTFS, so we assume trips with service_id = null runs on all days
        const nullFilter = "t.service_id IS NULL";

        /* Rationale:
        1. The service_id can be designated as "active" by activeServiceIds
        2. The service_id is null, which means it runs on all days (assumption)
         */
        allFilters = `(${activeServiceIds} OR ${nullFilter})`;
    } else {
        // We only care about a specific trip. Ignore all the service_id filters
        allFilters = `(t.trip_id = ${singleQuote(tripIdFilter)})`;
    }

    // SQL query to get the closest stop times before and after the current time
    // Once we have two stop_times that "surround" the current time, we can interpolate exactly where the bus is
    const query = `
WITH eligible_trips AS (
  SELECT DISTINCT t.trip_id
  FROM trips t
    LEFT JOIN calendar c ON t.service_id = c.service_id
  WHERE ${allFilters}
),

-- stop_times after the current time
after_stops AS (
  SELECT ROWID, trip_id, MIN(arrival_time) AS first_stop_after_selected_time
  FROM stop_times
  WHERE arrival_time >= @timeOfDay
    AND arrival_time <= @timeOfDayAfter
    AND trip_id IN (SELECT trip_id FROM eligible_trips)
  GROUP BY trip_id
),

-- stop_times before the current time
before_stops AS (
  SELECT ROWID, trip_id, MAX(departure_time) AS first_stop_before_selected_time
  FROM stop_times
  WHERE departure_time <= @timeOfDay
    AND departure_time >= @timeOfDayBefore
    AND trip_id IN (SELECT trip_id FROM eligible_trips)
  GROUP BY trip_id
)

-- use '1after' and '0before' so we can sort the results lexicographically

SELECT stop_times.*, '1after' as source
FROM stop_times
INNER JOIN after_stops ON stop_times.ROWID = after_stops.ROWID

UNION

SELECT stop_times.*, '0before' as source
FROM stop_times
INNER JOIN before_stops ON stop_times.ROWID = before_stops.ROWID

ORDER BY trip_id, source;
  `;

    const statement = db.prepare(query);

    const queryParams = {
        date: YYYYMMDD,
        timeOfDay: timeOfDay,
        timeOfDayBefore: timeOfDayBefore,
        timeOfDayAfter: timeOfDayAfter,
    };

    // @ts-ignore
    const results: ClosestStopTime[] = statement.all(queryParams);

    results.forEach((x: any) => (x.shape_dist_traveled = parseFloat(x.shape_dist_traveled)));

    return results;
}
