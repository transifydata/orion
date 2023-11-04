--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------


create index idx_trip_update_agency_id_server_time_vehicle_id
    on trip_update (agency_id, server_time, vehicle_id);

DROP INDEX idx_vehicle_position_agency_id;

create index idx_vehicle_position_agency_id_vid
    on vehicle_position (agency_id, server_time, vid);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------
DROP INDEX idx_trip_update_agency_id_server_time_vehicle_id;
