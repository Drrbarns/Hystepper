-- Warehouse fulfillment steps between processing and shipped.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'packed';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'packaging_for_delivery';
