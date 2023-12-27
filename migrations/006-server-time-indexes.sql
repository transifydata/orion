--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------


CREATE INDEX idx_vehicle_position_server_time ON vehicle_position (
    server_time
);

CREATE INDEX idx_trip_update_server_time ON trip_update (
    server_time
);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------
DROP INDEX idx_vehicle_position_server_time;
DROP INDEX idx_trip_update_server_time;
