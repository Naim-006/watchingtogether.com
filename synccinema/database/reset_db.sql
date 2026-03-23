-- WARNING: THIS WILL DELETE ALL EXISTING ROOMS AND MESSAGES
-- RUN THIS IN YOUR SUPABASE SQL EDITOR TO FIX THE PERSISTENCE ISSUE

-- 1. Drop existing tables to start fresh
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.room_videos CASCADE;
DROP TABLE IF EXISTS public.room_members CASCADE;
DROP TABLE IF EXISTS public.rooms CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- 2. Create Users table
CREATE TABLE public.users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    online BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    avatar_url TEXT
);
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

-- 3. Create Rooms table
CREATE TABLE public.rooms (
    id TEXT PRIMARY KEY,
    room_code TEXT UNIQUE NOT NULL,
    host_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    is_locked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.rooms DISABLE ROW LEVEL SECURITY;

-- 4. Create Room members table
CREATE TABLE public.room_members (
    id TEXT PRIMARY KEY,
    room_id TEXT REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('host', 'viewer')) DEFAULT 'viewer',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(room_id, user_id)
);
ALTER TABLE public.room_members DISABLE ROW LEVEL SECURITY;

-- 5. Create Room video state table
CREATE TABLE public.room_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT REFERENCES public.rooms(id) ON DELETE CASCADE,
    video_type TEXT CHECK (video_type IN ('mp4', 'youtube', 'upload')),
    video_url TEXT NOT NULL,
    set_by TEXT REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.room_videos DISABLE ROW LEVEL SECURITY;

-- 6. Create Messages table
CREATE TABLE public.messages (
    id TEXT PRIMARY KEY,
    room_id TEXT REFERENCES public.rooms(id) ON DELETE CASCADE,
    sender_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    content TEXT,
    type TEXT CHECK (type IN ('text', 'image', 'voice')) DEFAULT 'text',
    file_url TEXT,
    reply_to TEXT REFERENCES public.messages(id),
    seen_by JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;

-- 7. Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
