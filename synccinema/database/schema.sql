-- SyncCinema Database Schema

-- Users table (extends Supabase Auth users)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    online BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    avatar_url TEXT
);

-- Rooms table
CREATE TABLE IF NOT EXISTS public.rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code TEXT UNIQUE NOT NULL,
    host_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    is_locked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Room members table
CREATE TABLE IF NOT EXISTS public.room_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('host', 'viewer')) DEFAULT 'viewer',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(room_id, user_id)
);

-- Room video state table
CREATE TABLE IF NOT EXISTS public.room_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    video_type TEXT CHECK (video_type IN ('mp4', 'youtube', 'upload')),
    video_url TEXT NOT NULL,
    set_by UUID REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    content TEXT,
    type TEXT CHECK (type IN ('text', 'image', 'voice')) DEFAULT 'text',
    file_url TEXT,
    reply_to UUID REFERENCES public.messages(id),
    seen_by JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Storage Buckets (Run these in Supabase Dashboard or via API)
-- insert into storage.buckets (id, name, public) values ('videos', 'videos', true);
-- insert into storage.buckets (id, name, public) values ('images', 'images', true);
-- insert into storage.buckets (id, name, public) values ('voice', 'voice', true);
