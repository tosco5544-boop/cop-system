DELETE FROM wf_forms WHERE id = 'f4';
DELETE FROM wf_routes WHERE id = 'r3' AND NOT EXISTS (SELECT 1 FROM wf_forms WHERE route_id = 'r3');
