-- ========================================================
-- Migration: Fix Cart Status Available & Total Devices Calculation
-- ========================================================

-- 1. Create function & trigger to auto-sync carts.total_devices when devices are inserted/updated/deleted
CREATE OR REPLACE FUNCTION sync_cart_total_devices()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE carts
    SET total_devices = (
      SELECT COUNT(*)::INT FROM devices WHERE cart_id = OLD.cart_id AND deleted_at IS NULL
    )
    WHERE id = OLD.cart_id;
    RETURN OLD;
  ELSE
    UPDATE carts
    SET total_devices = (
      SELECT COUNT(*)::INT FROM devices WHERE cart_id = NEW.cart_id AND deleted_at IS NULL
    )
    WHERE id = NEW.cart_id;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_cart_total_devices ON devices;
CREATE TRIGGER trg_sync_cart_total_devices
AFTER INSERT OR UPDATE OR DELETE ON devices
FOR EACH ROW EXECUTE FUNCTION sync_cart_total_devices();

-- 2. Sync all existing carts total_devices right now to match actual registered devices count
UPDATE carts c
SET total_devices = COALESCE((
  SELECT COUNT(*)::INT FROM devices d WHERE d.cart_id = c.id AND d.deleted_at IS NULL
), 0);

-- 3. Re-create cart_status VIEW cleanly
DROP VIEW IF EXISTS public.cart_status CASCADE;

CREATE VIEW public.cart_status AS
SELECT
  c.id,
  c.name,
  c.display_name,
  c.location,
  COUNT(d.id)::INT AS total_devices,
  COUNT(d.id)::INT AS registered_devices,
  COUNT(dl.id)::INT AS active_loans,
  GREATEST(0, (COUNT(d.id)::INT - COUNT(dl.id)::INT)) AS available_devices,
  c.deleted_at,
  c.allow_manual_entry,
  c.enable_charge_tracking
FROM public.carts c
LEFT JOIN public.devices d ON c.id = d.cart_id AND d.deleted_at IS NULL
LEFT JOIN public.device_loans dl ON dl.device_id = d.id AND dl.status = 'active' AND dl.checkin_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.name, c.display_name, c.location, c.deleted_at, c.allow_manual_entry, c.enable_charge_tracking;
