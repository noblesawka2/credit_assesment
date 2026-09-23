CREATE SCHEMA nobles_security;
REVOKE ALL ON SCHEMA nobles_security FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE nobles_security.sessions (
  hash text PRIMARY KEY CHECK (hash ~ '^[a-f0-9]{64}$'),
  actor_id uuid NOT NULL,
  ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX security_sessions_actor ON nobles_security.sessions(actor_id);
CREATE TABLE nobles_security.revocations (
  actor_id uuid PRIMARY KEY,
  revoked_at timestamptz NOT NULL
);
CREATE TABLE nobles_security.rate_limits (
  key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  hits bigint NOT NULL CHECK (hits > 0),
  expires_at timestamptz NOT NULL
);
CREATE TABLE nobles_security.events (
  id uuid PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('LOGIN_SUCCESS','LOGIN_FAILURE','SIGN_OUT','SESSION_REJECTED','PASSWORD_RESET_REQUESTED','PASSWORD_RESET_DELIVERY_FAILED','PASSWORD_RESET_STARTED','PASSWORD_RESET_SUCCESS','PASSWORD_RESET_FAILURE','AUTHORIZATION_DENIED','RATE_LIMITED','SENSITIVE_ACCESS')),
  actor_id uuid,
  correlation_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION nobles_security.deny_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_SECURITY_EVENT';
END;
$$;
REVOKE ALL ON FUNCTION nobles_security.deny_event_mutation() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER security_events_immutable BEFORE UPDATE OR DELETE ON nobles_security.events FOR EACH ROW EXECUTE FUNCTION nobles_security.deny_event_mutation();
CREATE TRIGGER security_events_no_truncate BEFORE TRUNCATE ON nobles_security.events FOR EACH STATEMENT EXECUTE FUNCTION nobles_security.deny_event_mutation();
REVOKE ALL ON ALL TABLES IN SCHEMA nobles_security FROM PUBLIC, anon, authenticated, service_role;
