// app.js — OWOJ dengan Supabase
// Import semua fungsi dari supabase.js
import {
    fetchUsers, insertUser, deleteUserDb,
    fetchCompletions, setCompletion, unsetCompletion,
    fetchStartDate, saveStartDate
} from './supabase.js';

const { createApp, ref, computed, onMounted } = Vue;

createApp({
    setup() {
        const parseLocalDate = (dateStr) => {
            const [y, m, d] = dateStr.split('-').map(Number);
            return new Date(y, m - 1, d);
        };

        // --- Konfigurasi ---
        const ADMIN_PASSWORD = "pekanqu";

        // --- State Utama ---
        const users       = ref([]);
        const completions = ref({});
        const startDate   = ref(new Date().toISOString().split('T')[0]);
        const viewDate    = ref(new Date().toISOString().split('T')[0]);

        // Loading state — dipakai untuk disable tombol & tampilkan spinner
        const isLoading   = ref(false);
        const isSyncing   = ref(false); // indikator sync ringan (toggle checkbox, dll)

        // --- Motivasi Harian ---
        const motivasiHarian = ref("");

        const loadMotivasiHarian = async () => {
            try {
                const res  = await fetch('./motivasi.json');
                const list = await res.json();
                // Gunakan tanggal sebagai seed agar konsisten seharian
                const today     = new Date();
                const seed      = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
                const idx       = seed % list.length;
                motivasiHarian.value = list[idx];
            } catch (e) {
                console.warn("Gagal memuat motivasi.json:", e);
            }
        };

        // UI State
        const showAdmin           = ref(false);
        const isAdminAuthenticated = ref(false);
        const adminPasswordInput  = ref("");
        const showStatsModal      = ref(false);
        const openJuz             = ref(null);
        const searchQuery         = ref("");

        // Form State
        const newUser       = ref({ name: "", startJuz: "" });
        const startDateInput = ref("");

        // --- Computed Dates & Weeks ---

        const currentWeekIndex = computed(() => {
            const start   = parseLocalDate(startDate.value);
            const current = parseLocalDate(viewDate.value);
            if (current < start) return 0;
            const diffDays = Math.floor((current - start) / (1000 * 60 * 60 * 24));
            return Math.floor(diffDays / 7);
        });

        const currentWeekNum = computed(() => currentWeekIndex.value + 1);

        const currentMonthName = computed(() => {
            const date = parseLocalDate(viewDate.value);
            return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        });

        const hijriDate = computed(() => {
            const date = parseLocalDate(viewDate.value);
            return new Intl.DateTimeFormat('id-ID-u-ca-islamic', {
                day: 'numeric', month: 'long', year: 'numeric'
            }).format(date);
        });

        // --- Logic OWOJ ---

        const getCurrentJuzForUser = (userStartJuz) => {
            const shift = currentWeekIndex.value;
            return (parseInt(userStartJuz) + shift - 1) % 30 + 1;
        };

        const getUsersForJuz = (juzNumber) =>
            users.value.filter(u => getCurrentJuzForUser(u.startJuz) === juzNumber);

        const getCompletionKey = (userId) =>
            `week${currentWeekIndex.value}_user${userId}`;

        const isCompleted = (userId) =>
            !!completions.value[getCompletionKey(userId)];

        // --- Warna & Statistik Juz ---

        const getJuzStats = (juz, weekIdx = currentWeekIndex.value) => {
            const readers = users.value.filter(u => {
                return ((parseInt(u.startJuz) + weekIdx - 1) % 30 + 1) === juz;
            });
            const total = readers.length;
            if (total === 0) return { total: 0, done: 0, percent: 0 };
            let done = 0;
            readers.forEach(u => {
                if (completions.value[`week${weekIdx}_user${u.id}`]) done++;
            });
            return { total, done, percent: (done / total) * 100 };
        };

        const getJuzClass = (juz) => {
            const s = getJuzStats(juz);
            if (s.total === 0)      return 'bg-white border-slate-200';
            if (s.percent === 100)  return 'bg-emerald-50 border-emerald-200';
            if (s.percent > 0)      return 'bg-amber-50 border-amber-200';
            return 'bg-white border-slate-200';
        };

        // --- Ringkasan Progress Pekan Ini ---

        const weekSummary = computed(() => {
            const totalPeserta = users.value.length;
            if (totalPeserta === 0)
                return { totalPeserta: 0, sudahSelesai: 0, percent: 0, juzSelesai: 0, juzAktif: 0 };

            let sudahSelesai = 0;
            users.value.forEach(u => {
                if (completions.value[getCompletionKey(u.id)]) sudahSelesai++;
            });

            let juzSelesai = 0, juzAktif = 0;
            for (let j = 1; j <= 30; j++) {
                const s = getJuzStats(j);
                if (s.total > 0) {
                    juzAktif++;
                    if (s.percent === 100) juzSelesai++;
                }
            }
            return {
                totalPeserta, sudahSelesai,
                percent: Math.round((sudahSelesai / totalPeserta) * 100),
                juzSelesai, juzAktif
            };
        });

        // --- Hasil Pencarian Peserta ---

        const searchResults = computed(() => {
            const q = searchQuery.value.trim().toLowerCase();
            if (!q) return [];
            return users.value
                .filter(u => u.name.toLowerCase().includes(q))
                .map(u => ({
                    ...u,
                    juzSaatIni: getCurrentJuzForUser(u.startJuz),
                    selesai: !!completions.value[getCompletionKey(u.id)]
                }));
        });
        // --- Jadwal Tadabbur Harian ---

        const tadabburSchedule = computed(() => {
            if (users.value.length === 0) return [];
            const sorted = [...users.value].sort((a, b) => a.id - b.id);
            const total = sorted.length;
            const base  = parseLocalDate(startDate.value);
            const today = parseLocalDate(viewDate.value);
            const diffDays = Math.floor((today - base) / (1000 * 60 * 60 * 24));

            const schedule = [];
            for (let i = 0; i < 6; i++) {
                const dayOffset  = diffDays + i;
                const userIndex  = ((dayOffset % total) + total) % total;
                const targetDate = new Date(base);
                targetDate.setDate(base.getDate() + dayOffset);
                schedule.push({
                    user: sorted[userIndex],
                    date: targetDate.toISOString().split('T')[0],
                    isToday: i === 0
                });
            }
            return schedule;
        });

        const tadabburToday = computed(() => tadabburSchedule.value[0] ?? null);
        const showTadabburModal = ref(false);

        // --- Statistik Bulanan & Khatam ---

        const getWeeksInCurrentMonth = computed(() => {
            const targetDate  = parseLocalDate(viewDate.value);
            const targetMonth = targetDate.getMonth();
            const targetYear  = targetDate.getFullYear();
            const weekIndices = [];
            const start       = parseLocalDate(startDate.value);
            const tempDate    = new Date(targetYear, targetMonth, 1);

            while (tempDate.getMonth() === targetMonth) {
                const diffDays = Math.floor((tempDate - start) / (1000 * 60 * 60 * 24));
                const wIdx = Math.floor(diffDays / 7);
                if (tempDate >= start && !weekIndices.includes(wIdx))
                    weekIndices.push(wIdx);
                tempDate.setDate(tempDate.getDate() + 1);
            }
            return weekIndices;
        });

        const monthlyKhatamCount = computed(() => {
            let totalKhatam = 0;
            getWeeksInCurrentMonth.value.forEach(wIdx => {
                const results = [];
                for (let j = 1; j <= 30; j++) {
                    const s = getJuzStats(j, wIdx);
                    if (s.total > 0) results.push(s.percent === 100 ? 1 : 0);
                }
                if (results.length > 0 && results.every(v => v === 1)) totalKhatam++;
            });
            return totalKhatam;
        });

        const monthlyStats = computed(() => {
            const weeks = getWeeksInCurrentMonth.value;
            return users.value
                .map(user => {
                    const count = weeks.filter(wIdx =>
                        completions.value[`week${wIdx}_user${user.id}`]
                    ).length;
                    return { name: user.name, count };
                })
                .sort((a, b) => b.count - a.count);
        });

        // --- Actions ---

        // ✅ DIUBAH: toggle completion → sync ke Supabase
        const toggleCompletion = async (userId) => {
            const key  = getCompletionKey(userId);
            const wIdx = currentWeekIndex.value;
            isSyncing.value = true;
            try {
                if (completions.value[key]) {
                    delete completions.value[key];
                    await unsetCompletion(wIdx, userId);
                } else {
                    completions.value[key] = true;
                    await setCompletion(wIdx, userId);
                }
            } catch (e) {
                console.error("Gagal sync completion:", e);
                alert("Gagal menyimpan ke server. Periksa koneksi.");
                // Rollback state lokal
                if (completions.value[key]) delete completions.value[key];
                else completions.value[key] = true;
            } finally {
                isSyncing.value = false;
            }
        };

        const toggleJuz   = (juz) => openJuz.value = openJuz.value === juz ? null : juz;

        const toggleAdmin = () => {
            showAdmin.value = !showAdmin.value;
            if (!showAdmin.value) isAdminAuthenticated.value = false;
        };

        const verifyAdmin = () => {
            if (adminPasswordInput.value.trim() === ADMIN_PASSWORD) {
                isAdminAuthenticated.value = true;
                adminPasswordInput.value = "";
            } else {
                alert("Password Salah!");
                adminPasswordInput.value = "";
            }
        };

        // ✅ DIUBAH: tambah user → simpan ke Supabase
        const addUser = async () => {
            if (!newUser.value.name || !newUser.value.startJuz)
                return alert("Lengkapi data nama dan juz.");

            const namaTrim = newUser.value.name.trim();
            if (users.value.some(u => u.name.toLowerCase() === namaTrim.toLowerCase()))
                return alert(`Peserta "${namaTrim}" sudah terdaftar.`);

            const juzDiinginkan    = parseInt(newUser.value.startJuz);
            const weekNow          = currentWeekIndex.value;
            const startJuzTerhitung = ((juzDiinginkan - weekNow - 1) % 30 + 30) % 30 + 1;
            const id               = Date.now();

            isLoading.value = true;
            try {
                const saved = await insertUser({ id, name: namaTrim, startJuz: startJuzTerhitung });
                users.value.push(saved);
                newUser.value = { name: "", startJuz: "" };
            } catch (e) {
                console.error("Gagal tambah peserta:", e);
                alert("Gagal menyimpan ke server. Periksa koneksi.");
            } finally {
                isLoading.value = false;
            }
        };

        // ✅ DIUBAH: hapus user → hapus dari Supabase
        const deleteUser = async (id) => {
            if (!confirm("Hapus peserta ini?")) return;
            isLoading.value = true;
            try {
                await deleteUserDb(id);
                users.value = users.value.filter(u => u.id !== id);
            } catch (e) {
                console.error("Gagal hapus peserta:", e);
                alert("Gagal menghapus dari server. Periksa koneksi.");
            } finally {
                isLoading.value = false;
            }
        };

        // ✅ DIUBAH: ubah tanggal mulai → simpan ke Supabase
        const updateStartDate = async () => {
            if (!confirm("Ubah tanggal mulai program?")) {
                startDateInput.value = startDate.value;
                return;
            }
            isLoading.value = true;
            try {
                await saveStartDate(startDateInput.value);
                startDate.value = startDateInput.value;
            } catch (e) {
                console.error("Gagal simpan tanggal mulai:", e);
                alert("Gagal menyimpan ke server. Periksa koneksi.");
            } finally {
                isLoading.value = false;
            }
        };

        // ✅ DIUBAH: loadData → ambil dari Supabase, localStorage sebagai fallback
const loadData = async () => {
    isLoading.value = true;
    try {
        const [fetchedUsers, fetchedCompletions, fetchedStartDate] = await Promise.all([
            fetchUsers(),
            fetchCompletions(),
            fetchStartDate()
        ]);
        users.value       = fetchedUsers;
        completions.value = fetchedCompletions;
        if (fetchedStartDate) startDate.value = fetchedStartDate;
    } catch (e) {
        console.error("Gagal mengambil data dari Supabase:", e);
        alert("Gagal memuat data dari server. Periksa koneksi internet Anda.");
    } finally {
        startDateInput.value = startDate.value;
        isLoading.value = false;
    }
};

        const copyRecap = () => {
            let text = `*LAPORAN OWOJ+ BACA ARTI PEKAN KE-${currentWeekNum.value}*\n`;
            text += ` ${hijriDate.value}\n\n`;
            let totalSelesai = 0;
            for (let j = 1; j <= 30; j++) {
                const readers = getUsersForJuz(j);
                if (readers.length > 0) {
                    text += `*Juz ${j}*\n`;
                    readers.forEach(u => {
                        const done = isCompleted(u.id);
                        if (done) totalSelesai++;
                        text += `- ${u.name} : ${done ? "Alhamdulillah selesai" : "Belum laporan selesai"}\n`;
                    });
                    text += `\n`;
                }
            }
            text += ` Progress: ${totalSelesai}/${users.value.length} Peserta.\nKeep Istiqomah!`;
            navigator.clipboard.writeText(text).then(() => alert("sip!!"));
        };

        onMounted(() => {
            loadData();
            loadMotivasiHarian();
        });

        return {
            users, startDate, viewDate, currentWeekNum,
            showAdmin, isAdminAuthenticated, adminPasswordInput,
            openJuz, newUser, startDateInput, showStatsModal,
            isLoading, isSyncing,
            toggleJuz, toggleAdmin, verifyAdmin,
            addUser, deleteUser, getUsersForJuz,
            isCompleted, toggleCompletion, copyRecap,
            updateStartDate, getJuzClass, tadabburToday, tadabburSchedule, showTadabburModal,
            monthlyStats, hijriDate, currentMonthName, monthlyKhatamCount,
            weekSummary, searchQuery, searchResults, getCurrentJuzForUser,
            motivasiHarian
        };
    }
}).mount('#app');
