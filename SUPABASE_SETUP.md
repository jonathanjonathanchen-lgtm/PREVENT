# Supabase + Vercel Setup Guide

## Step 1 — Install the Supabase client

In your project folder, run:
```
npm install @supabase/supabase-js
```

---

## Step 2 — Create a Supabase project

1. Go to https://supabase.com and sign up (free)
2. Click **New project**, give it a name (e.g. "biomechanics"), choose a region close to you
3. Wait ~2 minutes for it to provision

---

## Step 3 — Run the database schema

In your Supabase project, go to **SQL Editor** and run this:

```sql
-- Jobs (shared across all team members)
create table jobs (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
alter table jobs enable row level security;
create policy "authenticated full access" on jobs
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- File records (metadata only — raw files go to Storage)
create table job_files (
  id uuid default gen_random_uuid() primary key,
  job_id uuid references jobs(id) on delete cascade,
  file_type text not null check (file_type in ('mvnx','loadsol','force')),
  file_name text not null,
  storage_path text not null,
  metadata jsonb default '{}',
  sort_order int default 0,
  created_at timestamptz default now()
);
alter table job_files enable row level security;
create policy "authenticated full access" on job_files
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Per-job settings (force offset, panels, etc.)
create table job_settings (
  job_id uuid references jobs(id) on delete cascade primary key,
  force_offset float default 0,
  extend_duration float default 0,
  force_blocks jsonb default '[]',
  joint_panels jsonb default '[{"jointKey":0,"planes":1}]',
  loadsol_pairings jsonb default '{}',
  updated_at timestamptz default now()
);
alter table job_settings enable row level security;
create policy "authenticated full access" on job_settings
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
```

---

## Step 4 — Create the storage bucket

1. In Supabase, go to **Storage** → **New bucket**
2. Name it exactly: `biomechanics-files`
3. Leave it as **Private**
4. Go to **Policies** for this bucket and run:

```sql
create policy "authenticated upload" on storage.objects
  for insert with check (bucket_id = 'biomechanics-files' and auth.role() = 'authenticated');

create policy "authenticated download" on storage.objects
  for select using (bucket_id = 'biomechanics-files' and auth.role() = 'authenticated');

create policy "authenticated delete" on storage.objects
  for delete using (bucket_id = 'biomechanics-files' and auth.role() = 'authenticated');
```

---

## Step 5 — Get your API keys

In Supabase go to **Settings → API**. Copy:
- **Project URL** (looks like `https://abcxyz.supabase.co`)
- **anon / public key** (long string starting with `eyJ...`)

Open `biomechanics_dashboard.jsx` and replace the two placeholders near the top:

```js
const SUPABASE_URL  = "https://YOUR_PROJECT_ID.supabase.co";   // ← paste here
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";                      // ← paste here
```

---

## Step 6 — Enable email auth

In Supabase go to **Authentication → Providers → Email** — make sure it is enabled (it is by default).

To invite teammates: they go to your deployed URL and click **Register** to create their own account.

---

## Step 7 — Deploy to Vercel

1. Push your project to a GitHub repository
2. Go to https://vercel.com, sign up, click **Add New Project**
3. Import the GitHub repo
4. Vercel will auto-detect the framework. If using Vite, it works automatically.
5. Deploy — you'll get a URL like `https://yourapp.vercel.app`

Share that URL with your colleagues. They register with their email and immediately have access to all shared jobs.

---

## Notes

- **File size limit**: Supabase free tier allows 50 MB per file and 1 GB total storage — more than enough for MVNX and CSV files.
- **Users**: Free tier supports unlimited users.
- **Data ownership**: All jobs are shared — any team member can create, edit, or delete jobs.
- **Settings per job** (force offset, joint panels, etc.) are also shared and auto-saved.
