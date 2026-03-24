-- Run these commands in your Supabase SQL Editor to fix the room_videos table

-- 1. Rename the set_by column to added_by
ALTER TABLE public.room_videos 
RENAME COLUMN set_by TO added_by;

-- 2. Add the title and thumbnail_url columns
ALTER TABLE public.room_videos 
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Verify the changes
-- SELECT * FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'room_videos';
