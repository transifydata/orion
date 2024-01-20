--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------


ALTER TABLE vehicle_position ADD COLUMN scheduledDistanceAlongRoute REAL;
ALTER TABLE vehicle_position ADD COLUMN actualDistanceAlongRoute REAL;

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

ALTER TABLE vehicle_position DROP COLUMN scheduledDistanceAlongRoute;
ALTER TABLE vehicle_position DROP COLUMN actualDistanceAlongRoute;