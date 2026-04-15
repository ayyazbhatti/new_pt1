-- Remove legacy mock_forex provider entry from admin integrations JSON (synthetic feed removed from platform).

UPDATE platform_data_provider_integrations
SET
  config_json = jsonb_set(
    config_json,
    '{providers}',
    COALESCE(
      (
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements(config_json -> 'providers') AS elem
        WHERE elem ->> 'type' IS DISTINCT FROM 'mock_forex'
      ),
      '[]'::jsonb
    )
  ),
  updated_at = NOW()
WHERE singleton_id = 1;
