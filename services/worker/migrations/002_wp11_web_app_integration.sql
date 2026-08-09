-- WP11 Web App Integration — Database migration
-- Adds business_name, target_url columns to lifecycle_audits for history display.
-- Safe to run on existing databases — uses IF NOT EXISTS.

-- Add columns for web application history display
ALTER TABLE prysm.lifecycle_audits
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS target_url TEXT;

-- Update existing rows with null-safe defaults (web app handles missing values)
UPDATE prysm.lifecycle_audits
  SET business_name = COALESCE(business_name, ''),
      target_url = COALESCE(target_url, '')
  WHERE business_name IS NULL OR target_url IS NULL;
