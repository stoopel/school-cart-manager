ALTER TABLE carts ADD COLUMN IF NOT EXISTS display_name text;
DROP VIEW IF EXISTS cart_status;
CREATE VIEW cart_status AS
SELECT c.id, c.name, c.display_name, c.location, c.total_devices, COUNT(d.id) AS registered_devices, SUM(CASE WHEN d.status = 'active' THEN 1 ELSE 0 END) AS active_loans, (c.total_devices - SUM(CASE WHEN d.status = 'active' THEN 1 ELSE 0 END)) AS available_devices FROM carts c LEFT JOIN devices d ON c.id = d.cart_id GROUP BY c.id, c.name, c.display_name, c.location, c.total_devices;