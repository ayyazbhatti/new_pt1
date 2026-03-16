-- Per-group setting: when true, hide the Leverage collapse in the user trading terminal for users in this group.
ALTER TABLE user_groups
  ADD COLUMN IF NOT EXISTS hide_leverage_in_terminal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_groups.hide_leverage_in_terminal IS 'When true, users in this group do not see the Leverage section in the trading terminal right panel.';
