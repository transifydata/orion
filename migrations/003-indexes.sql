--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------


CREATE INDEX idx_nb_vehicle_position_agency_id ON nb_vehicle_position (
    agency_id, time1
);

CREATE INDEX idx_vehicle_position_agency_id ON vehicle_position (
    agency_id, time1
);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------
DROP INDEX idx_nb_vehicle_position_agency_id;
DROP INDEX idx_vehicle_position_agency_id;
