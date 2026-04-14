// =============================================================
//  supabase.js — OWOJ Supabase Integration Layer
//  Ganti nilai SUPABASE_URL dan SUPABASE_ANON_KEY dengan milik Anda
//  dari: https://supabase.com/dashboard → Project Settings → API
// =============================================================

const SUPABASE_URL  = "https://nmwbvqqnkeahfetxxtkz.supabase.co";   
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5td2J2cXFua2VhaGZldHh4dGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMzYzNjAsImV4cCI6MjA5MTcxMjM2MH0.faabMIV6ytpQAZcuHtLjpNp7TokkcE4VMTBT_WBTuYo"; 

// Helper: semua request ke Supabase REST API
async function sbFetch(path, options = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        "Prefer": options.prefer || "return=representation",
        ...(options.headers || {})
    };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Supabase error [${res.status}]: ${err}`);
    }
    // DELETE dan beberapa PATCH tidak mengembalikan body
    const text = await res.text();
    return text ? JSON.parse(text) : [];
}

// =============================================================
//  TABEL YANG DIBUTUHKAN DI SUPABASE
//  Jalankan SQL ini di Supabase → SQL Editor:
//
//  -- Tabel peserta
//  create table owoj_users (
//    id        bigint primary key,
//    name      text not null,
//    start_juz int  not null
//  );
//
//  -- Tabel completion (centang selesai per minggu per user)
//  create table owoj_completions (
//    week_index int    not null,
//    user_id    bigint not null,
//    primary key (week_index, user_id)
//  );
//
//  -- Tabel config (menyimpan start_date program)
//  create table owoj_config (
//    key   text primary key,
//    value text not null
//  );
//
//  -- Matikan RLS (Row Level Security) untuk ketiga tabel
//  -- agar bisa diakses dengan anon key:
//  alter table owoj_users        disable row level security;
//  alter table owoj_completions  disable row level security;
//  alter table owoj_config       disable row level security;
//
//  -- Seed baris config awal (opsional, bisa diisi lewat app)
//  insert into owoj_config (key, value)
//  values ('start_date', '2026-01-01')
//  on conflict (key) do nothing;
// =============================================================


// ---- USERS ----

export async function fetchUsers() {
    const rows = await sbFetch("owoj_users?select=*&order=id.asc");
    // Konversi snake_case → camelCase agar kompatibel dengan app.js
    return rows.map(r => ({ id: r.id, name: r.name, startJuz: r.start_juz }));
}

export async function insertUser(user) {
    // user = { id, name, startJuz }
    const rows = await sbFetch("owoj_users", {
        method: "POST",
        body: JSON.stringify({ id: user.id, name: user.name, start_juz: user.startJuz })
    });
    const r = rows[0];
    return { id: r.id, name: r.name, startJuz: r.start_juz };
}

export async function deleteUserDb(userId) {
    await sbFetch(`owoj_users?id=eq.${userId}`, {
        method: "DELETE",
        prefer: "return=minimal"
    });
}


// ---- COMPLETIONS ----

export async function fetchCompletions() {
    const rows = await sbFetch("owoj_completions?select=*");
    // Ubah array [{week_index, user_id}] → objek {week0_user123: true}
    const obj = {};
    rows.forEach(r => {
        obj[`week${r.week_index}_user${r.user_id}`] = true;
    });
    return obj;
}

export async function setCompletion(weekIndex, userId) {
    await sbFetch("owoj_completions", {
        method: "POST",
        prefer: "return=minimal",
        headers: { "Prefer": "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ week_index: weekIndex, user_id: userId })
    });
}

export async function unsetCompletion(weekIndex, userId) {
    await sbFetch(
        `owoj_completions?week_index=eq.${weekIndex}&user_id=eq.${userId}`,
        { method: "DELETE", prefer: "return=minimal" }
    );
}


// ---- CONFIG (start_date) ----

export async function fetchStartDate() {
    const rows = await sbFetch("owoj_config?key=eq.start_date&select=value");
    return rows.length ? rows[0].value : null;
}

export async function saveStartDate(dateStr) {
    // Upsert: update jika sudah ada, insert jika belum
    await sbFetch("owoj_config", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key: "start_date", value: dateStr })
    });
}