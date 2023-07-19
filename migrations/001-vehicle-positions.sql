--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE vehicle_position (
      rid TEXT NOT NULL ,
      vid TEXT NOT NULL,
      lat TEXT NOT NULL,
      lon TEXT NOT NULL,
      heading REAL NOT NULL,
      tripId TEXT NOT NULL,
      stopIndex INTEGER NOT NULL,
      status TEXT NOT NULL,
      secsSinceReport INTEGER NOT NULL,
      stopId TEXT,
      label TEXT,
      agency_id TEXT NOT NULL,
      server_date TEXT NOT NULL,
      server_time INTEGER NOT NULL
    );


CREATE TABLE nb_vehicle_position (
    rid INTEGER NOT NULL,
    vid INTEGER NOT NULL,
    lat TEXT NOT NULL,
    lon TEXT NOT NULL,
    heading INTEGER NOT NULL,
    did TEXT,
    secsSinceReport INTEGER,
    leadingVid TEXT,
    agency_id TEXT NOT NULL,
    server_date TEXT NOT NULL,
    server_time INTEGER NOT NULL
);


CREATE UNIQUE INDEX unique_vehicle_position on vehicle_position (
    agency_id, rid, vid, heading, tripId, stopIndex, lat, lon, server_date
);

CREATE UNIQUE INDEX unique_nb_vehicle_position on nb_vehicle_position (
    agency_id, rid, vid, did, lat, lon, server_date
);
--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------
DROP TABLE vehicle_position;
DROP TABLE nb_vehicle_position;