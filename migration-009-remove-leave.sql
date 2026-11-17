DELETE FROM wf_forms WHERE id = 'f3';
DELETE FROM wf_routes WHERE id = 'r2' AND NOT EXISTS (SELECT 1 FROM wf_forms WHERE route_id = 'r2');
