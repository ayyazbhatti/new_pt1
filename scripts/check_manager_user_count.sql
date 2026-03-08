-- How many users will this manager see on the admin users page?
-- Replace 'ayyazbhatti39@gmail.com' with the manager's email if needed.
-- Run: psql $DATABASE_URL -f scripts/check_manager_user_count.sql
-- Or paste into any PostgreSQL client (DBeaver, pgAdmin, etc.).

WITH manager_email AS (
  SELECT 'ayyazbhatti39@gmail.com'::text AS email
),
manager_user AS (
  SELECT u.id AS user_id
  FROM users u
  CROSS JOIN manager_email me
  WHERE u.email = me.email AND u.deleted_at IS NULL
),
manager_row AS (
  SELECT m.id AS manager_id
  FROM managers m
  JOIN manager_user u ON m.user_id = u.user_id
),
manager_tags AS (
  SELECT ta.tag_id
  FROM tag_assignments ta
  JOIN manager_row mr ON ta.entity_id = mr.manager_id
  WHERE ta.entity_type = 'manager'
),
allowed_groups AS (
  SELECT DISTINCT ta.entity_id AS group_id
  FROM tag_assignments ta
  JOIN manager_tags mt ON ta.tag_id = mt.tag_id
  WHERE ta.entity_type = 'group'
)
SELECT
  (SELECT COUNT(*) FROM manager_user) AS manager_account_found,
  (SELECT COUNT(*) FROM manager_row) AS manager_row_found,
  (SELECT COUNT(*) FROM manager_tags) AS tags_on_manager,
  (SELECT COUNT(*) FROM allowed_groups) AS allowed_groups_count,
  (SELECT COUNT(*) FROM users u
   WHERE u.deleted_at IS NULL
     AND u.group_id IN (SELECT group_id FROM allowed_groups)) AS users_visible_on_admin_page;
