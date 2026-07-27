-- M7: RBAC group-scoping. NULL (the default, and every existing user) means unscoped — sees/acts on
-- every device regardless of group, no behavior change for anyone until this is explicitly set. A
-- non-empty JSON array of group ids restricts the user to devices in those groups (see
-- assertGroupAccess, src/api/middleware/auth.ts).
ALTER TABLE users ADD COLUMN scoped_group_ids JSONB;
