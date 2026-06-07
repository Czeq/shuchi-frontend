-- SQL Migration: Add Influencer & Payout fields to the discounts table.
-- Please run this script in your Supabase project's SQL Editor (https://supabase.com/dashboard/project/_/sql).

-- Add phone column (for influencer contact)
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS phone TEXT;

-- Add passcode column (for influencer dashboard login authentication)
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS passcode TEXT;

-- Add payouts column (for tracking payouts made to influencers, default to an empty JSON array)
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS payouts JSONB DEFAULT '[]'::jsonb;

-- Optional: Comments to describe the fields for developers
COMMENT ON COLUMN discounts.phone IS 'Phone number associated with the influencer';
COMMENT ON COLUMN discounts.passcode IS '4-digit PIN/passcode for secure influencer login';
COMMENT ON COLUMN discounts.payouts IS 'Array of payout transaction logs: [{"date": "ISOString", "amount": number, "ref": "string"}]';
