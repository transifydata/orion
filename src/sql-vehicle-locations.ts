// Various SQL scripts for getting vehicle locations from the database

import { SQLVehiclePosition } from "./get-live-vehicle-locations";
import { Database } from "sqlite";
import BetterSqlite3 from "better-sqlite3";
import {ClosestStopTime} from "./get-scheduled-vehicle-locations";

export async function sqlVehicleLocations(
  db: Database,
  time: number,
  agency: string,
) {
  const startTimeBuffer = time - 5 * 60 * 1000;

  const rows: SQLVehiclePosition[] = await db.all(
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
  return rows;
}

function getDayOfWeekColumnName(date: Date): string {
  const dayOfWeek = date.getDay();
  const dayColumnNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  return dayColumnNames[dayOfWeek];
}

function getDateAsString(date: Date): string {
  // Returns a date in YYYYMMDD format

  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0"); // Months are zero-based
  const day = date.getDate().toString().padStart(2, "0");

  return `${year}${month}${day}`;
}

export function getScheduledVehicleLocationsSQL(
  time: Date,
  db: BetterSqlite3.Database,
  timeOfDay: string,
  timeOfDayBefore: string,
  timeOfDayAfter: string,
): ClosestStopTime[] {
  const query = `
WITH eligible_trips AS (
  SELECT DISTINCT t.trip_id
  FROM trips t
    INNER JOIN calendar c ON t.service_id = c.service_id
  WHERE c.${getDayOfWeekColumnName(
    time,
  )} = 1 AND c.start_date <= @date AND c.end_date >= @date
),
after_stops AS (
  SELECT ROWID, trip_id, MIN(arrival_time) AS first_stop_after_selected_time
  FROM stop_times
  WHERE arrival_time >= @timeOfDay
    AND arrival_time < @timeOfDayAfter
    AND trip_id IN (SELECT trip_id FROM eligible_trips)
  GROUP BY trip_id
),
before_stops AS (
  SELECT ROWID, trip_id, MIN(arrival_time) AS first_stop_before_selected_time
  FROM stop_times
  WHERE arrival_time <= @timeOfDay
    AND arrival_time > @timeOfDayBefore
    AND trip_id IN (SELECT trip_id FROM eligible_trips)
  GROUP BY trip_id
)

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

  // @ts-ignore
  return statement.all({
    date: getDateAsString(time), // YYYYMMDD format (e.g. "20231001")
    timeOfDay: timeOfDay,
    timeOfDayBefore: timeOfDayBefore,
    timeOfDayAfter: timeOfDayAfter,
  });
}