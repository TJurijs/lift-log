-- Table/function grants alone do not permit the operational service role to
-- address a private-schema object. Browser roles retain their existing grants.
grant usage on schema private to service_role;
