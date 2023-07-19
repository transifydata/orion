--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE trip_update (
  trip_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  start_date TEXT NOT NULL,
  schedule_relationship TEXT,
  direction_id INT,
  delay INT,
  stop_time_updates JSON,
  timestamp INT NOT NULL,
    server_time INT NOT NULL,
    agency_id TEXT NOT NULL,
  vehicle_id TEXT
);

CREATE UNIQUE INDEX unique_trip_update on trip_update (
    agency_id, trip_id, start_time, start_date, timestamp
);
--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------
DROP TABLE trip_update;
DROP TABLE unique_trip_update;