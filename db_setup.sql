-- SQL Migration: Add Creator & Payout fields to the discounts table.
-- Please run this script in your Supabase project's SQL Editor (https://supabase.com/dashboard/project/_/sql).

-- Add phone column (for creator contact)
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS phone TEXT;

-- Add passcode column (for creator dashboard login authentication)
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS passcode TEXT;

-- Add payouts column (for tracking payouts made to creators, default to an empty JSON array)
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS payouts JSONB DEFAULT '[]'::jsonb;

-- Optional: Comments to describe the fields for developers
COMMENT ON COLUMN discounts.phone IS 'Phone number associated with the creator';
COMMENT ON COLUMN discounts.passcode IS '4-digit PIN/passcode for secure creator login';
COMMENT ON COLUMN discounts.payouts IS 'Array of payout transaction logs: [{"date": "ISOString", "amount": number, "ref": "string"}]';
