"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { upload } from "@vercel/blob/client";
import {
  Play, Pause, SkipBack, SkipForward, Search, Plus, Upload, ListMusic,
  Home, Compass, User, LogOut, Trash2, Pencil, X, Loader2, Music2,
  ShieldCheck, AlertTriangle, ListPlus, Sparkles, LogIn, UserPlus,
  ChevronRight, Volume2, Disc3, Headphones,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Config you should change before deploying                          */
/* ------------------------------------------------------------------ */
const VIBES = ["Chill", "Focus", "Hype", "Throwback", "Lo-fi", "Study", "Workout", "Happy", "Rainy Day"];
const MAX_IMAGE_MB = 8;
const MAX_AUDIO_MB = 20;

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */
function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Weak, client-side only hash for this classroom demo. This is NOT
// secure password storage. Do not reuse a real password here.
function demoHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// Resizes an image client-side before it ever leaves the browser, then
// hands back a Blob (not a data URL) ready to upload.
function resizeImageFile(file, maxSize = 500) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
        else if (height >= width && height > maxSize) { width = Math.round((width * maxSize) / height); height = maxSize; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not process that image"))), "image/jpeg", 0.85);
      };
      img.onerror = () => reject(new Error("Could not read that image"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

// Also used for the vision-moderation call, which still wants base64.
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(blob);
  });
}

/* ------------------------------------------------------------------ */
/* Uploads — straight to Vercel Blob from the browser, via a signed    */
/* token from our own /api/upload route. Real files, no size hacks.   */
/* ------------------------------------------------------------------ */
async function uploadImage(file) {
  const resized = await resizeImageFile(file);
  const blob = await upload(`covers/${uid("cover")}.jpg`, resized, {
    access: "public",
    handleUploadUrl: "/api/upload",
    clientPayload: "image",
  });
  return blob.url;
}

async function uploadAudio(file) {
  if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
    throw new Error(`That file is ${(file.size / (1024 * 1024)).toFixed(1)}MB — audio uploads are capped at ${MAX_AUDIO_MB}MB.`);
  }
  const ext = (file.name.split(".").pop() || "mp3").toLowerCase();
  const blob = await upload(`audio/${uid("song")}.${ext}`, file, {
    access: "public",
    handleUploadUrl: "/api/upload",
    clientPayload: "audio",
  });
  return blob.url;
}

async function deleteBlob(url) {
  if (!url || !url.includes("blob.vercel-storage.com")) return; // only clean up our own uploads
  try { await fetch("/api/upload", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }); }
  catch { /* best-effort cleanup */ }
}

/* ------------------------------------------------------------------ */
/* Storage layer — the shared class library lives in Redis behind our  */
/* own API route; "personal" (just-this-device) state is real          */
/* localStorage, since this is a normal deployed site now.             */
/* ------------------------------------------------------------------ */
async function getShared(key, fallback) {
  try {
    const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}`);
    if (!res.ok) return fallback;
    const data = await res.json();
    return data.value ?? fallback;
  } catch { return fallback; }
}
async function setShared(key, value) {
  try {
    const res = await fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    return res.ok;
  } catch { return false; }
}
function getPersonal(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function setPersonal(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

/* ------------------------------------------------------------------ */
/* Claude-powered "is this appropriate for school" check, proxied      */
/* through our own /api/moderate route so the API key stays server-side.*/
/* Real check, not decorative — it can block a save.                   */
/* ------------------------------------------------------------------ */
async function moderateSubmission({ title, artist, album, playlistName, coverDataUrl }) {
  try {
    const res = await fetch("/api/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, artist, album, playlistName, coverDataUrl }),
    });
    if (!res.ok) throw new Error("moderation route failed");
    return await res.json();
  } catch {
    return { checked: false, appropriate: true, reason: "Automatic check was unavailable, so please double-check this yourself." };
  }
}

/* ------------------------------------------------------------------ */
/* Root component                                                     */
/* ------------------------------------------------------------------ */
export default function MusicHub() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null); // { username, isAdmin }
  const [authMode, setAuthMode] = useState("login"); // login | signup
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [songs, setSongs] = useState({});      // id -> song
  const [playlists, setPlaylists] = useState({}); // id -> playlist
  const [recentlyPlayed, setRecentlyPlayed] = useState([]); // [{songId, by, at}], newest first
  const [songRequests, setSongRequests] = useState([]); // [{id, title, artist, by, at}]
  const [tab, setTab] = useState("home");       // home | browse | mine | admin | playlist
  const [openPlaylistId, setOpenPlaylistId] = useState(null);
  const [query, setQuery] = useState("");
  const [activeVibes, setActiveVibes] = useState([]);
  const [toast, setToast] = useState(null);

  const [showAddSong, setShowAddSong] = useState(false);
  const [showAddPlaylist, setShowAddPlaylist] = useState(false);
  const [editingSong, setEditingSong] = useState(null);
  const [showRequestSong, setShowRequestSong] = useState(false);
  const [addToPlaylistId, setAddToPlaylistId] = useState(null);

  const [queue, setQueue] = useState([]);       // array of song ids
  const [queueIndex, setQueueIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const audioRef = useRef(null);

  const flash = useCallback((text, kind = "info") => {
    setToast({ text, kind, id: uid("t") });
    window.clearTimeout(flash._t);
    flash._t = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refreshLibrary = useCallback(async () => {
    const [s, p, r, rq] = await Promise.all([
      getShared("library:songs", {}),
      getShared("library:playlists", {}),
      getShared("recent:played", []),
      getShared("song:requests", []),
    ]);
    setSongs(s);
    setPlaylists(p);
    setRecentlyPlayed(Array.isArray(r) ? r : []);
    setSongRequests(Array.isArray(rq) ? rq : []);
  }, []);

  const recordPlay = useCallback(async (songId) => {
    if (!songId || !user) return;
    const entry = { songId, by: user.username, at: Date.now() };
    // Keep the 12 most recent, and don't stack the same song back-to-back.
    const current = await getShared("recent:played", []);
    const list = Array.isArray(current) ? current : [];
    const deduped = list[0]?.songId === songId && list[0]?.by === user.username ? list.slice(1) : list;
    const next = [entry, ...deduped].slice(0, 12);
    setRecentlyPlayed(next);
    await setShared("recent:played", next);
  }, [user]);

  useEffect(() => {
    (async () => {
      const session = await getPersonal("session", null);
      if (session?.username) {
        const users = await getShared("users:directory", {});
        const u = users[session.username];
        if (u) setUser({ username: session.username, isAdmin: !!u.isAdmin });
      }
      await refreshLibrary();
      setBooting(false);
    })();
  }, [refreshLibrary]);

  useEffect(() => {
    const t = setInterval(refreshLibrary, 20000);
    return () => clearInterval(t);
  }, [refreshLibrary]);

  /* ---------------- auth ---------------- */
  async function handleAuth(e, mode, fields) {
    e.preventDefault();
    setAuthError("");
    setAuthBusy(true);
    try {
      const username = fields.username.trim().toLowerCase();
      const password = fields.password;
      if (!username || !password) { setAuthError("Enter a username and password."); return; }

      const users = await getShared("users:directory", {});

      if (mode === "signup") {
        if (users[username]) { setAuthError("That username is taken."); return; }
        let isAdmin = false;
        if (fields.adminCode) {
          const verifyRes = await fetch("/api/verify-admin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: fields.adminCode }),
          });
          const verify = await verifyRes.json().catch(() => ({ ok: false }));
          if (!verify.ok) { setAuthError("That admin code isn't right."); return; }
          isAdmin = true;
        }
        users[username] = { passwordDemo: demoHash(password), isAdmin, createdAt: Date.now() };
        await setShared("users:directory", users);
      } else {
        const u = users[username];
        if (!u || u.passwordDemo !== demoHash(password)) { setAuthError("Wrong username or password."); return; }
      }

      await setPersonal("session", { username });
      setUser({ username, isAdmin: !!users[username].isAdmin });
      await refreshLibrary();
    } finally {
      setAuthBusy(false);
    }
  }

  async function logOut() {
    await setPersonal("session", null);
    setUser(null);
    setQueue([]); setQueueIndex(-1); setIsPlaying(false);
  }

  /* ---------------- library writes ---------------- */
  async function saveSong(song) {
    const next = { ...songs, [song.id]: song };
    setSongs(next);
    await setShared("library:songs", next);
  }
  async function approveSong(id) {
    const song = songs[id];
    if (!song) return;
    const next = { ...songs, [id]: { ...song, status: "approved", reviewedBy: user.username, reviewedAt: Date.now() } };
    setSongs(next);
    await setShared("library:songs", next);
    flash("Song approved — it's public now.");
  }
  async function rejectSong(id) {
    // Rejecting removes it entirely and cleans up its uploaded files.
    await deleteSong(id);
    flash("Song rejected and removed.");
  }
  async function editSong(id, fields) {
    const song = songs[id];
    if (!song) return;
    const next = { ...songs, [id]: { ...song, ...fields, editedBy: user.username, editedAt: Date.now() } };
    setSongs(next);
    await setShared("library:songs", next);
    flash("Song updated.");
  }
  async function addSongRequest(req) {
    const entry = { id: uid("req"), title: req.title, artist: req.artist || "", by: user.username, at: Date.now() };
    const current = await getShared("song:requests", []);
    const list = Array.isArray(current) ? current : [];
    const next = [entry, ...list].slice(0, 100);
    setSongRequests(next);
    await setShared("song:requests", next);
    flash("Request sent to the admins.");
  }
  async function removeSongRequest(reqId) {
    const current = await getShared("song:requests", []);
    const list = Array.isArray(current) ? current : [];
    const next = list.filter((r) => r.id !== reqId);
    setSongRequests(next);
    await setShared("song:requests", next);
  }
  async function deleteSong(id) {
    const song = songs[id];
    const next = { ...songs };
    delete next[id];
    setSongs(next);
    await setShared("library:songs", next);
    if (song) {
      await deleteBlob(song.audioUrl);
      await deleteBlob(song.coverDataUrl);
    }
    setQueue((q) => q.filter((sid) => sid !== id));
  }
  async function savePlaylist(playlist) {
    const next = { ...playlists, [playlist.id]: playlist };
    setPlaylists(next);
    await setShared("library:playlists", next);
  }
  async function deletePlaylist(id) {
    const next = { ...playlists };
    delete next[id];
    setPlaylists(next);
    await setShared("library:playlists", next);
    if (openPlaylistId === id) { setOpenPlaylistId(null); setTab("home"); }
  }

  /* ---------------- player ---------------- */
  const currentSongId = queue[queueIndex];
  const currentSong = currentSongId ? songs[currentSongId] : null;

  const lastRecordedRef = useRef(null);
  useEffect(() => {
    if (currentSongId && currentSongId !== lastRecordedRef.current) {
      lastRecordedRef.current = currentSongId;
      recordPlay(currentSongId);
    }
  }, [currentSongId, recordPlay]);

  function playQueue(ids, startAt = 0) {
    if (!ids.length) return;
    setQueue(ids);
    setQueueIndex(startAt);
    setIsPlaying(true);
  }
  function playSingle(id) { playQueue([id], 0); }
  function addToQueue(id) {
    setQueue((q) => [...q, id]);
    flash("Added to queue.");
    if (queueIndex === -1) setQueueIndex(0);
  }
  function togglePlay() { if (currentSong) setIsPlaying((p) => !p); }
  function skip(dir) {
    setQueueIndex((i) => {
      const next = i + dir;
      if (next < 0) return 0;
      if (next >= queue.length) return i; // stop at end
      return next;
    });
    setIsPlaying(true);
  }

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !currentSong) return;
    if (el.src !== currentSong.audioUrl) el.src = currentSong.audioUrl;
    if (isPlaying) el.play().catch(() => flash("Couldn't play that track — check the audio link.", "warn"));
    else el.pause();
  }, [currentSong, isPlaying, flash]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = volume;
  }, [volume]);

  /* ---------------- derived views ---------------- */
  // A song is public only once an admin has approved it. Admin-created songs
  // are marked approved at creation, so they skip the queue.
  const allSongList = useMemo(() => Object.values(songs).sort((a, b) => b.createdAt - a.createdAt), [songs]);
  const songList = useMemo(() => allSongList.filter((s) => s.status !== "pending"), [allSongList]);
  const pendingSongs = useMemo(() => allSongList.filter((s) => s.status === "pending"), [allSongList]);
  const playlistList = useMemo(() => Object.values(playlists).sort((a, b) => b.createdAt - a.createdAt), [playlists]);

  const filteredSongs = useMemo(() => {
    return songList.filter((s) => {
      const q = query.trim().toLowerCase();
      const matchesQuery = !q || [s.title, s.artist, s.album, s.owner].some((f) => (f || "").toLowerCase().includes(q));
      const matchesVibe = activeVibes.length === 0 || (s.vibes || []).some((v) => activeVibes.includes(v));
      return matchesQuery && matchesVibe;
    });
  }, [songList, query, activeVibes]);

  const filteredPlaylists = useMemo(() => {
    return playlistList.filter((p) => {
      const q = query.trim().toLowerCase();
      const matchesQuery = !q || [p.name, p.owner].some((f) => (f || "").toLowerCase().includes(q));
      const matchesVibe = activeVibes.length === 0 || (p.vibes || []).some((v) => activeVibes.includes(v));
      return matchesQuery && matchesVibe;
    });
  }, [playlistList, query, activeVibes]);

  const myPlaylists = useMemo(
    () => playlistList.filter((p) => p.owner === user?.username),
    [playlistList, user]
  );

  /* ---------------- render ---------------- */
  if (booting) {
    return (
      <div className="min-h-screen bg-violet-100 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={handleAuth} error={authError} busy={authBusy} />;
  }

  const openedPlaylist = openPlaylistId ? playlists[openPlaylistId] : null;

  return (
    <div className="min-h-screen bg-violet-100 dither-bg text-slate-800 flex" style={{ fontFamily: "'Nunito', ui-sans-serif, system-ui" }}>
      <Sidebar
        tab={tab}
        isAdmin={user.isAdmin}
        onNav={(t) => { setTab(t); setOpenPlaylistId(null); }}
        onLogout={logOut}
        username={user.username}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          query={query}
          setQuery={setQuery}
          onAddSong={() => setShowAddSong(true)}
          onAddPlaylist={() => setShowAddPlaylist(true)}
          onRequestSong={() => setShowRequestSong(true)}
        />

        <main className="flex-1 overflow-y-auto px-5 md:px-8 pb-40 pt-4">
          {query.trim() ? (
            <SearchResults
              songs={filteredSongs}
              playlists={filteredPlaylists}
              onPlaySong={(id) => playSingle(id)}
              onQueueSong={addToQueue}
              onOpenPlaylist={(id) => { setOpenPlaylistId(id); setTab("playlist"); }}
            />
          ) : tab === "playlist" && openedPlaylist ? (
            <PlaylistDetail
              playlist={openedPlaylist}
              songs={songs}
              user={user}
              onBack={() => { setOpenPlaylistId(null); setTab("home"); }}
              onPlayAll={() => playQueue(openedPlaylist.songIds, 0)}
              onPlaySong={(id) => playQueue(openedPlaylist.songIds, openedPlaylist.songIds.indexOf(id))}
              onQueueSong={addToQueue}
              onAddSongs={() => setAddToPlaylistId(openedPlaylist.id)}
              onRemoveSong={async (songId) => {
                const next = { ...openedPlaylist, songIds: openedPlaylist.songIds.filter((id) => id !== songId) };
                await savePlaylist(next);
              }}
              onDelete={() => deletePlaylist(openedPlaylist.id)}
              onRename={async (name) => savePlaylist({ ...openedPlaylist, name })}
            />
          ) : tab === "browse" ? (
            <BrowseTab
              vibes={VIBES}
              activeVibes={activeVibes}
              setActiveVibes={setActiveVibes}
              songs={filteredSongs}
              playlists={filteredPlaylists}
              onPlaySong={playSingle}
              onQueueSong={addToQueue}
              onOpenPlaylist={(id) => { setOpenPlaylistId(id); setTab("playlist"); }}
            />
          ) : tab === "mine" ? (
            <MineTab
              playlists={myPlaylists}
              onOpenPlaylist={(id) => { setOpenPlaylistId(id); setTab("playlist"); }}
              onNewPlaylist={() => setShowAddPlaylist(true)}
            />
          ) : tab === "admin" && user.isAdmin ? (
            <AdminTab
              pendingSongs={pendingSongs}
              approvedSongs={songList}
              playlists={playlistList}
              songRequests={songRequests}
              onApprove={approveSong}
              onReject={rejectSong}
              onEdit={(song) => setEditingSong(song)}
              onDeleteSong={deleteSong}
              onDeletePlaylist={deletePlaylist}
              onDismissRequest={removeSongRequest}
              onPlay={playSingle}
            />
          ) : (
            <HomeTab
              username={user.username}
              songs={songList}
              songsById={songs}
              playlists={playlistList}
              recentlyPlayed={recentlyPlayed}
              onPlaySong={playSingle}
              onQueueSong={addToQueue}
              onOpenPlaylist={(id) => { setOpenPlaylistId(id); setTab("playlist"); }}
              onNewSong={() => setShowAddSong(true)}
              onNewPlaylist={() => setShowAddPlaylist(true)}
            />
          )}
        </main>
      </div>

      <PlayerBar
        song={currentSong}
        isPlaying={isPlaying}
        onToggle={togglePlay}
        onPrev={() => skip(-1)}
        onNext={() => skip(1)}
        hasPrev={queueIndex > 0}
        hasNext={queueIndex >= 0 && queueIndex < queue.length - 1}
        progress={progress}
        duration={duration}
        onSeek={(t) => { if (audioRef.current) audioRef.current.currentTime = t; }}
        volume={volume}
        setVolume={setVolume}
        queueCount={queue.length}
      />

      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => skip(1)}
      />

      {toast && <Toast text={toast.text} kind={toast.kind} />}

      {showAddSong && (
        <AddSongModal
          user={user}
          onClose={() => setShowAddSong(false)}
          onSaved={async (song) => { await saveSong(song); setShowAddSong(false); flash(song.status === "approved" ? "Song added to the library." : "Song submitted — an admin will review it soon."); }}
          flash={flash}
        />
      )}
      {editingSong && (
        <EditSongModal
          song={editingSong}
          onClose={() => setEditingSong(null)}
          onSave={editSong}
        />
      )}
      {showRequestSong && (
        <RequestSongModal
          onClose={() => setShowRequestSong(false)}
          onSubmit={addSongRequest}
        />
      )}
      {showAddPlaylist && (
        <AddPlaylistModal
          user={user}
          onClose={() => setShowAddPlaylist(false)}
          onSaved={async (pl) => { await savePlaylist(pl); setShowAddPlaylist(false); setOpenPlaylistId(pl.id); setTab("playlist"); flash("Playlist created."); }}
          flash={flash}
        />
      )}
      {addToPlaylistId && (
        <AddExistingSongsModal
          playlist={playlists[addToPlaylistId]}
          allSongs={songList}
          onClose={() => setAddToPlaylistId(null)}
          onSaved={async (ids) => {
            const pl = playlists[addToPlaylistId];
            const merged = Array.from(new Set([...pl.songIds, ...ids]));
            await savePlaylist({ ...pl, songIds: merged });
            setAddToPlaylistId(null);
            flash("Songs added to playlist.");
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Font loader (Fraunces for display, Inter for body)                 */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Auth screen                                                        */
/* ------------------------------------------------------------------ */
function AuthScreen({ mode, setMode, onSubmit, error, busy }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adminCode, setAdminCode] = useState("");

  return (
    <div className="min-h-screen bg-violet-100 dither-bg text-slate-800 flex items-center justify-center px-4" style={{ fontFamily: "'Nunito', ui-sans-serif, system-ui" }}>
      <div className="w-full max-w-sm">
        <div className="bg-white border-2 border-slate-800 rounded-2xl sticker-shadow px-5 py-4 mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-amber-500 mb-1">
            <Music2 className="w-4 h-4" /><Headphones className="w-4 h-4" /><Disc3 className="w-4 h-4" /><Sparkles className="w-4 h-4" />
          </div>
          <h1 className="font-display chunky-text text-4xl tracking-tight" style={{ color: "#fbbf24" }}>peanut butter</h1>
          <p className="text-xs text-slate-500 mt-1">a playlist spot for people stuck behind the school filter</p>
        </div>

        <div className="bg-white border-2 border-slate-800 rounded-2xl sticker-shadow p-6">
          <div className="flex gap-1 mb-6 bg-violet-100 rounded-lg p-1">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition ${mode === "login" ? "bg-amber-400 text-slate-950" : "text-slate-500"}`}
            >
              Log in
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition ${mode === "signup" ? "bg-amber-400 text-slate-950" : "text-slate-500"}`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={(e) => onSubmit(e, mode, { username, password, adminCode })} className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-violet-100 border-2 border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400"
                placeholder="e.g. rasya"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-violet-100 border-2 border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400"
                placeholder="Don't reuse a real password"
              />
            </div>
            {mode === "signup" && (
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Admin code (only if your teacher gave you one)</label>
                <input
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  className="w-full bg-violet-100 border-2 border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400"
                  placeholder="Optional"
                />
              </div>
            )}

            {error && (
              <div className="text-xs text-rose-500 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
              </div>
            )}

            <button
              disabled={busy}
              className="w-full bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold rounded-lg py-2.5 text-sm transition flex items-center justify-center gap-2 disabled:opacity-60 border-2 border-slate-800 sticker-shadow"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === "login" ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              {mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
        </div>

        <p className="text-[11px] text-slate-500 text-center mt-4 leading-relaxed">
          This is a classroom demo. Accounts and passwords are stored for the app only, not
          protected the way a real production login would be, so please use a throwaway password.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar / TopBar                                                   */
/* ------------------------------------------------------------------ */
function Sidebar({ tab, isAdmin, onNav, onLogout, username }) {
  const browseItems = [
    { id: "home", label: "home", icon: Home },
    { id: "browse", label: "browse by vibe", icon: Compass },
  ];
  const libraryItems = [
    { id: "mine", label: "my playlists", icon: ListMusic },
  ];
  if (isAdmin) libraryItems.push({ id: "admin", label: "admin", icon: ShieldCheck });

  function NavGroup({ label, color, items }) {
    return (
      <div className="border-2 border-slate-800 rounded-xl overflow-hidden sticker-shadow mb-4">
        <div className={`${color} text-slate-950 font-display text-sm tracking-wide px-3 py-1.5`}>{label}</div>
        <div className="bg-white divide-y divide-slate-200">
          {items.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onNav(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition ${
                tab === id ? "bg-violet-100 text-violet-900 font-semibold" : "text-slate-600 hover:bg-violet-50"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" /> {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col px-3 py-5 dither-bg border-r-2 border-slate-800 overflow-y-auto">
      <div className="flex items-center gap-1.5 px-1 mb-5">
        <Disc3 className="w-5 h-5 text-amber-500" />
        <span className="font-display text-base tracking-tight">peanut butter</span>
      </div>

      <div className="border-2 border-dashed border-slate-400 rounded-xl p-3 mb-5 bg-white/70 text-xs text-slate-600 leading-relaxed">
        Signed in as <span className="font-semibold text-slate-800">{username}</span>
        {isAdmin && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900">admin</span>}
        <br />Your library and playlists are shared with the class.
      </div>

      <NavGroup label="DISCOVER" color="bg-pink-300" items={browseItems} />
      <NavGroup label="LIBRARY" color="bg-orange-300" items={libraryItems} />

      <div className="mt-auto pt-3 border-t-2 border-dashed border-slate-400">
        <button onClick={onLogout} className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-800">
          <LogOut className="w-3.5 h-3.5" /> log out
        </button>
      </div>
    </aside>
  );
}

function TopBar({ query, setQuery, onAddSong, onAddPlaylist, onRequestSong }) {
  return (
    <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200 px-5 md:px-8 py-3 flex items-center gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs, artists, playlists..."
          className="w-full bg-white border border-slate-300 rounded-full pl-9 pr-3 py-2 text-sm outline-none focus:border-amber-400"
        />
      </div>
      <div className="ml-auto flex gap-2">
        <button
          onClick={onRequestSong}
          className="flex items-center gap-1.5 text-sm bg-white hover:bg-violet-100 border border-slate-300 rounded-full px-3 py-2 transition"
        >
          <Sparkles className="w-4 h-4" /> <span className="hidden sm:inline">Request</span>
        </button>
        <button
          onClick={onAddSong}
          className="flex items-center gap-1.5 text-sm bg-white hover:bg-violet-100 border border-slate-300 rounded-full px-3 py-2 transition"
        >
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add song</span>
        </button>
        <button
          onClick={onAddPlaylist}
          className="flex items-center gap-1.5 text-sm bg-amber-400 hover:bg-amber-300 text-slate-950 font-medium rounded-full px-3 py-2 transition"
        >
          <ListPlus className="w-4 h-4" /> <span className="hidden sm:inline">New playlist</span>
        </button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Home / Browse / Mine / Admin tabs                                  */
/* ------------------------------------------------------------------ */
function SectionHeading({ eyebrow, title, action }) {
  return (
    <div className="flex items-center justify-between mb-3 mt-7 first:mt-0 gap-3">
      <div className="bg-slate-800 border-2 border-slate-800 rounded-lg px-3.5 py-2 sticker-shadow flex-1 min-w-0">
        {eyebrow && <div className="text-[10px] uppercase tracking-widest text-amber-300 mb-0.5">{eyebrow}</div>}
        <h2 className="font-display text-white text-lg leading-none truncate">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function EmptyState({ icon: Icon = Music2, title, sub, action }) {
  return (
    <div className="border border-dashed border-slate-300 rounded-2xl py-14 px-6 text-center">
      <Icon className="w-8 h-8 text-slate-300 mx-auto mb-3" />
      <div className="text-slate-500 font-medium">{title}</div>
      {sub && <div className="text-slate-500 text-sm mt-1">{sub}</div>}
      {action}
    </div>
  );
}

function HomeTab({ username, songs, songsById, playlists, recentlyPlayed, onPlaySong, onQueueSong, onOpenPlaylist, onNewSong, onNewPlaylist }) {
  const recent = (recentlyPlayed || [])
    .filter((r) => songsById[r.songId])
    .slice(0, 8);
  return (
    <div>
      <div className="pt-2 pb-1">
        <div className="text-[11px] uppercase tracking-widest text-amber-400/80 mb-1">Welcome back</div>
        <h1 className="font-display text-3xl">Hey {username}, what's the vibe today?</h1>
      </div>

      {recent.length > 0 && (
        <>
          <SectionHeading eyebrow="Live from the class" title="Just played" />
          <div className="border-2 border-slate-800 rounded-xl bg-white divide-y divide-slate-200 overflow-hidden">
            {recent.map((r, i) => {
              const song = songsById[r.songId];
              return (
                <button
                  key={`${r.songId}-${r.at}-${i}`}
                  onClick={() => onPlaySong(r.songId)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-violet-50 text-left"
                >
                  <img src={song.coverDataUrl || FALLBACK_COVER} className="w-9 h-9 rounded object-cover shrink-0" alt="" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{song.title} <span className="text-slate-500">— {song.artist}</span></div>
                    <div className="text-xs text-slate-500 truncate">played by {r.by} · {timeAgo(r.at)}</div>
                  </div>
                  <Play className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              );
            })}
          </div>
        </>
      )}

      <SectionHeading
        eyebrow="Fresh drops"
        title="Recently added"
        action={<button onClick={onNewSong} className="text-xs text-amber-600 flex items-center gap-1 hover:underline">Add a song <ChevronRight className="w-3 h-3" /></button>}
      />
      {songs.length === 0 ? (
        <EmptyState title="No songs yet" sub="Be the first to add one — everyone in class will be able to find it." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {songs.slice(0, 10).map((s) => <SongCard key={s.id} song={s} onPlay={() => onPlaySong(s.id)} onQueue={() => onQueueSong(s.id)} />)}
        </div>
      )}

      <SectionHeading
        eyebrow="Made by the class"
        title="Playlists"
        action={<button onClick={onNewPlaylist} className="text-xs text-amber-600 flex items-center gap-1 hover:underline">New playlist <ChevronRight className="w-3 h-3" /></button>}
      />
      {playlists.length === 0 ? (
        <EmptyState icon={ListMusic} title="No playlists yet" sub="Group a few songs together and give it a name." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {playlists.slice(0, 10).map((p) => <PlaylistCard key={p.id} playlist={p} onOpen={() => onOpenPlaylist(p.id)} />)}
        </div>
      )}
    </div>
  );
}

function BrowseTab({ vibes, activeVibes, setActiveVibes, songs, playlists, onPlaySong, onQueueSong, onOpenPlaylist }) {
  function toggleVibe(v) {
    setActiveVibes((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  }
  return (
    <div>
      <SectionHeading eyebrow="Find a mood" title="Browse by vibe" />
      <div className="flex flex-wrap gap-2 mb-6">
        {vibes.map((v) => (
          <button
            key={v}
            onClick={() => toggleVibe(v)}
            className={`text-sm px-3 py-1.5 rounded-full border transition ${
              activeVibes.includes(v) ? "bg-amber-400 border-amber-400 text-slate-950 font-medium" : "border-slate-300 text-slate-500 hover:border-slate-400"
            }`}
          >
            {v}
          </button>
        ))}
        {activeVibes.length > 0 && (
          <button onClick={() => setActiveVibes([])} className="text-sm px-3 py-1.5 text-slate-500 hover:text-slate-500">Clear</button>
        )}
      </div>

      <SectionHeading title="Playlists" />
      {playlists.length === 0 ? <EmptyState icon={ListMusic} title="Nothing matches" sub="Try a different vibe." /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          {playlists.map((p) => <PlaylistCard key={p.id} playlist={p} onOpen={() => onOpenPlaylist(p.id)} />)}
        </div>
      )}

      <SectionHeading title="Songs" />
      {songs.length === 0 ? <EmptyState title="Nothing matches" sub="Try a different vibe." /> : (
        <SongTable songs={songs} onPlay={onPlaySong} onQueue={onQueueSong} />
      )}
    </div>
  );
}

function MineTab({ playlists, onOpenPlaylist, onNewPlaylist }) {
  return (
    <div>
      <SectionHeading
        eyebrow="Just you"
        title="My playlists"
        action={<button onClick={onNewPlaylist} className="text-xs text-amber-600 flex items-center gap-1 hover:underline">New playlist <ChevronRight className="w-3 h-3" /></button>}
      />
      {playlists.length === 0 ? (
        <EmptyState icon={ListMusic} title="You haven't made a playlist yet" sub="Tap New playlist to start one." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {playlists.map((p) => <PlaylistCard key={p.id} playlist={p} onOpen={() => onOpenPlaylist(p.id)} />)}
        </div>
      )}
    </div>
  );
}

function AdminTab({ pendingSongs, approvedSongs, playlists, songRequests, onApprove, onReject, onEdit, onDeleteSong, onDeletePlaylist, onDismissRequest, onPlay }) {
  return (
    <div>
      <SectionHeading eyebrow="Needs review" title={`Pending approval (${pendingSongs.length})`} />
      <div className="border-2 border-slate-800 rounded-xl bg-white divide-y divide-slate-200 mb-8 overflow-hidden">
        {pendingSongs.length === 0 && <div className="p-4 text-sm text-slate-500">Nothing waiting — you're all caught up.</div>}
        {pendingSongs.map((s) => (
          <div key={s.id} className="flex items-center gap-3 p-3">
            <img src={s.coverDataUrl || FALLBACK_COVER} className="w-11 h-11 rounded object-cover shrink-0" alt="" />
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{s.title} <span className="text-slate-500">— {s.artist}</span></div>
              <div className="text-xs text-slate-500 truncate">
                {s.album ? `${s.album} · ` : ""}{s.releaseDate ? `${s.releaseDate} · ` : ""}submitted by {s.owner} · {timeAgo(s.createdAt)}
              </div>
            </div>
            <button onClick={() => onPlay(s.id)} className="text-slate-400 hover:text-amber-600 p-1.5" title="Preview"><Play className="w-4 h-4" /></button>
            <button onClick={() => onEdit(s)} className="text-slate-400 hover:text-slate-700 p-1.5" title="Edit before approving"><Pencil className="w-4 h-4" /></button>
            <button onClick={() => onApprove(s.id)} className="flex items-center gap-1 bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-semibold rounded-full px-3 py-1.5">Approve</button>
            <button onClick={() => onReject(s.id)} className="flex items-center gap-1 bg-white border-2 border-rose-300 text-rose-500 hover:bg-rose-50 text-xs font-semibold rounded-full px-3 py-1.5">Reject</button>
          </div>
        ))}
      </div>

      <SectionHeading eyebrow="From students" title={`Song requests (${songRequests.length})`} />
      <div className="border-2 border-slate-800 rounded-xl bg-white divide-y divide-slate-200 mb-8 overflow-hidden">
        {songRequests.length === 0 && <div className="p-4 text-sm text-slate-500">No requests right now.</div>}
        {songRequests.map((r) => (
          <div key={r.id} className="flex items-center gap-3 p-3">
            <div className="w-9 h-9 rounded bg-violet-100 flex items-center justify-center shrink-0"><Music2 className="w-4 h-4 text-slate-500" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{r.title}{r.artist ? <span className="text-slate-500"> — {r.artist}</span> : ""}</div>
              <div className="text-xs text-slate-500">requested by {r.by} · {timeAgo(r.at)}</div>
            </div>
            <button onClick={() => onDismissRequest(r.id)} className="text-slate-400 hover:text-slate-700 p-2" title="Dismiss"><X className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      <SectionHeading eyebrow="Live now" title={`Public songs (${approvedSongs.length})`} />
      <div className="border-2 border-slate-800 rounded-xl bg-white divide-y divide-slate-200 mb-8 overflow-hidden">
        {approvedSongs.length === 0 && <div className="p-4 text-sm text-slate-500">No public songs yet.</div>}
        {approvedSongs.map((s) => (
          <div key={s.id} className="flex items-center gap-3 p-3">
            <img src={s.coverDataUrl || FALLBACK_COVER} className="w-10 h-10 rounded object-cover shrink-0" alt="" />
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{s.title} <span className="text-slate-500">— {s.artist}</span></div>
              <div className="text-xs text-slate-500 truncate">{s.album ? `${s.album} · ` : ""}added by {s.owner}</div>
            </div>
            <button onClick={() => onEdit(s)} className="text-slate-400 hover:text-slate-700 p-2" title="Edit"><Pencil className="w-4 h-4" /></button>
            <button onClick={() => onDeleteSong(s.id)} className="text-rose-400 hover:text-rose-500 p-2" title="Take down"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      <SectionHeading title="All playlists" />
      <div className="border-2 border-slate-800 rounded-xl bg-white divide-y divide-slate-200">
        {playlists.length === 0 && <div className="p-4 text-sm text-slate-500">No playlists yet.</div>}
        {playlists.map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3">
            <div className="w-10 h-10 rounded bg-violet-100 flex items-center justify-center shrink-0">
              <ListMusic className="w-4 h-4 text-slate-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{p.name}</div>
              <div className="text-xs text-slate-500">by {p.owner} · {p.songIds.length} songs</div>
            </div>
            <button onClick={() => onDeletePlaylist(p.id)} className="text-rose-400 hover:text-rose-500 p-2">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditSongModal({ song, onClose, onSave }) {
  const [title, setTitle] = useState(song.title || "");
  const [artist, setArtist] = useState(song.artist || "");
  const [album, setAlbum] = useState(song.album || "");
  const [releaseDate, setReleaseDate] = useState(song.releaseDate || "");
  const [coverPreview, setCoverPreview] = useState(song.coverDataUrl || "");
  const [coverBlob, setCoverBlob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleCover(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const resized = await resizeImageFile(file);
      setCoverBlob(resized);
      setCoverPreview(URL.createObjectURL(resized));
    } catch (err) { setError(err.message || "Couldn't read that image."); }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!title.trim() || !artist.trim()) { setError("Title and artist can't be empty."); return; }
    setBusy(true);
    try {
      let coverUrl = song.coverDataUrl || "";
      if (coverBlob) {
        try { coverUrl = await uploadImage(coverBlob); }
        catch { setError("The new cover didn't upload — try again."); return; }
      }
      await onSave(song.id, {
        title: title.trim(), artist: artist.trim(), album: album.trim(),
        releaseDate: releaseDate.trim(), coverDataUrl: coverUrl,
      });
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <ModalShell title="Edit song" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-3">
        <Field label="Cover art">
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="w-16 h-16 rounded-lg bg-violet-100 border border-slate-300 flex items-center justify-center overflow-hidden shrink-0">
              {coverPreview ? <img src={coverPreview} className="w-full h-full object-cover" alt="" /> : <Upload className="w-5 h-5 text-slate-500" />}
            </div>
            <span className="text-sm text-slate-500">Replace image</span>
            <input type="file" accept="image/*" onChange={handleCover} className="hidden" />
          </label>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} /></Field>
          <Field label="Artist(s)"><input value={artist} onChange={(e) => setArtist(e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Album"><input value={album} onChange={(e) => setAlbum(e.target.value)} className={inputCls} placeholder="Album" /></Field>
          <Field label="Release date"><input value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} className={inputCls} placeholder="e.g. 2024" /></Field>
        </div>
        {error && <div className="text-xs text-rose-400 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}</div>}
        <button disabled={busy} className="w-full bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <>Save changes</>}
        </button>
      </form>
    </ModalShell>
  );
}

function RequestSongModal({ onClose, onSubmit }) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) { setError("Add at least a song title."); return; }
    setBusy(true);
    try { await onSubmit({ title: title.trim(), artist: artist.trim() }); onClose(); }
    finally { setBusy(false); }
  }
  return (
    <ModalShell title="Request a song" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="text-xs text-slate-600">Can't add it yourself? Send the admins a title and they can track it down and add it.</div>
        <Field label="Song title"><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Song name" /></Field>
        <Field label="Artist (optional)"><input value={artist} onChange={(e) => setArtist(e.target.value)} className={inputCls} placeholder="Artist" /></Field>
        {error && <div className="text-xs text-rose-400 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}</div>}
        <button disabled={busy} className="w-full bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Send request
        </button>
      </form>
    </ModalShell>
  );
}

function SearchResults({ songs, playlists, onPlaySong, onQueueSong, onOpenPlaylist }) {
  return (
    <div>
      <SectionHeading eyebrow={`${songs.length + playlists.length} results`} title="Search results" />
      {playlists.length > 0 && (
        <>
          <div className="text-sm text-slate-500 mb-2">Playlists</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            {playlists.map((p) => <PlaylistCard key={p.id} playlist={p} onOpen={() => onOpenPlaylist(p.id)} />)}
          </div>
        </>
      )}
      {songs.length > 0 && (
        <>
          <div className="text-sm text-slate-500 mb-2">Songs</div>
          <SongTable songs={songs} onPlay={onPlaySong} onQueue={onQueueSong} />
        </>
      )}
      {songs.length === 0 && playlists.length === 0 && <EmptyState title="Nothing found" sub="Try a different search." />}
    </div>
  );
}

function PlaylistDetail({ playlist, songs, user, onBack, onPlayAll, onPlaySong, onQueueSong, onAddSongs, onRemoveSong, onDelete, onRename }) {
  const canEdit = user.isAdmin || user.username === playlist.owner;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(playlist.name);
  const trackList = playlist.songIds.map((id) => songs[id]).filter(Boolean);

  return (
    <div>
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700 mb-4">&larr; Back</button>
      <div className="flex items-start gap-5 mb-6">
        <div
          className="w-32 h-32 rounded-xl shrink-0 shadow-lg flex items-center justify-center text-3xl font-display"
          style={{ background: `linear-gradient(135deg, ${stringToColor(playlist.name)}, #0B0F14)` }}
        >
          <ListMusic className="w-9 h-9 text-slate-950/70" />
        </div>
        <div className="min-w-0">
          {renaming ? (
            <div className="flex gap-2 mb-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className="bg-white border border-slate-300 rounded px-2 py-1 text-lg font-display" />
              <button onClick={() => { onRename(name); setRenaming(false); }} className="text-amber-600 font-semibold text-sm">Save</button>
            </div>
          ) : (
            <h1 className="font-display text-3xl truncate">{playlist.name}</h1>
          )}
          <div className="text-sm text-slate-500 mt-1">by {playlist.owner} · {trackList.length} songs</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(playlist.vibes || []).map((v) => <span key={v} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-slate-300 text-slate-500">{v}</span>)}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={onPlayAll} disabled={!trackList.length} className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-medium rounded-full px-4 py-2 text-sm disabled:opacity-40">
              <Play className="w-4 h-4" /> Play all
            </button>
            {canEdit && (
              <>
                <button onClick={onAddSongs} className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-full px-4 py-2 text-sm hover:bg-violet-100"><Plus className="w-4 h-4" /> Add songs</button>
                <button onClick={() => setRenaming(true)} className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-full px-3 py-2 text-sm hover:bg-violet-100"><Pencil className="w-4 h-4" /></button>
                <button onClick={onDelete} className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-full px-3 py-2 text-sm text-rose-400 hover:bg-violet-100"><Trash2 className="w-4 h-4" /></button>
              </>
            )}
          </div>
        </div>
      </div>

      {trackList.length === 0 ? (
        <EmptyState title="No songs in this playlist yet" sub={canEdit ? "Tap Add songs to pull some in from the library." : "Check back later."} />
      ) : (
        <SongTable songs={trackList} onPlay={onPlaySong} onQueue={onQueueSong} onRemove={canEdit ? onRemoveSong : null} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cards / table                                                      */
/* ------------------------------------------------------------------ */
const FALLBACK_COVER = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='200' height='200' fill='#1A222B'/></svg>`
);

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function SongCard({ song, onPlay, onQueue }) {
  return (
    <div className="group relative bg-violet-50 hover:bg-white border border-slate-300 rounded-xl p-2.5 transition">
      <div className="relative">
        <img src={song.coverDataUrl || FALLBACK_COVER} alt="" className="w-full aspect-square object-cover rounded-lg" />
        <button
          onClick={onPlay}
          className="absolute bottom-1.5 right-1.5 w-9 h-9 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition shadow-lg"
        >
          <Play className="w-4 h-4 ml-0.5" />
        </button>
      </div>
      <div className="mt-2 min-w-0">
        <div className="text-sm font-medium truncate">{song.title}</div>
        <div className="text-xs text-slate-500 truncate">{song.artist}</div>
      </div>
      <button onClick={onQueue} className="absolute top-2 left-2 w-7 h-7 rounded-full bg-slate-950/70 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition" title="Add to queue">
        <ListPlus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function PlaylistCard({ playlist, onOpen }) {
  return (
    <button onClick={onOpen} className="group text-left bg-violet-50 hover:bg-white border border-slate-300 rounded-xl p-2.5 transition">
      <div
        className="w-full aspect-square rounded-lg flex items-center justify-center relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${stringToColor(playlist.name)}, #0B0F14)` }}
      >
        <ListMusic className="w-8 h-8 text-slate-950/60" />
        <span className="absolute top-1.5 right-1.5 text-[10px] bg-slate-950/50 px-1.5 py-0.5 rounded-full">{playlist.songIds.length}</span>
      </div>
      <div className="mt-2 min-w-0">
        <div className="text-sm font-medium truncate">{playlist.name}</div>
        <div className="text-xs text-slate-500 truncate">by {playlist.owner}</div>
      </div>
    </button>
  );
}

function SongTable({ songs, onPlay, onQueue, onRemove }) {
  return (
    <div className="border border-slate-300 rounded-xl overflow-hidden">
      {songs.map((s, i) => (
        <div key={s.id} className={`flex items-center gap-3 px-3 py-2.5 ${i !== 0 ? "border-t border-slate-200" : ""} hover:bg-violet-50 group`}>
          <img src={s.coverDataUrl || FALLBACK_COVER} className="w-9 h-9 rounded object-cover shrink-0" alt="" />
          <div className="min-w-0 flex-1">
            <div className="text-sm truncate">{s.title}</div>
            <div className="text-xs text-slate-500 truncate">
              {s.artist}{s.album ? ` · ${s.album}` : ""}
            </div>
          </div>
          <div className="hidden sm:flex flex-wrap gap-1 max-w-[30%]">
            {(s.vibes || []).slice(0, 2).map((v) => <span key={v} className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 border border-slate-300 text-slate-500">{v}</span>)}
          </div>
          <button onClick={() => onQueue(s.id)} className="text-slate-500 hover:text-slate-700 p-1.5 opacity-0 group-hover:opacity-100 transition" title="Queue"><ListPlus className="w-4 h-4" /></button>
          <button onClick={() => onPlay(s.id)} className="text-slate-500 hover:text-amber-600 p-1.5" title="Play"><Play className="w-4 h-4" /></button>
          {onRemove && <button onClick={() => onRemove(s.id)} className="text-slate-500 hover:text-rose-400 p-1.5" title="Remove"><X className="w-4 h-4" /></button>}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Player bar                                                         */
/* ------------------------------------------------------------------ */
function PlayerBar({ song, isPlaying, onToggle, onPrev, onNext, hasPrev, hasNext, progress, duration, onSeek, volume, setVolume, queueCount }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3 z-20">
      <div className="max-w-6xl mx-auto flex items-center gap-4">
        <div className="flex items-center gap-3 min-w-0 w-48 sm:w-64">
          <img src={song?.coverDataUrl || FALLBACK_COVER} alt="" className={`w-11 h-11 rounded-lg object-cover shrink-0 ${isPlaying ? "animate-pulse" : ""}`} />
          <div className="min-w-0">
            <div className="text-sm truncate">{song ? song.title : "Nothing playing"}</div>
            <div className="text-xs text-slate-500 truncate">{song ? song.artist : "Pick a song to start"}</div>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-center gap-4 mb-1">
            <button onClick={onPrev} disabled={!hasPrev} className="text-slate-500 hover:text-slate-800 disabled:opacity-30"><SkipBack className="w-4 h-4" /></button>
            <button onClick={onToggle} disabled={!song} className="w-9 h-9 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center disabled:opacity-40">
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <button onClick={onNext} disabled={!hasNext} className="text-slate-500 hover:text-slate-800 disabled:opacity-30"><SkipForward className="w-4 h-4" /></button>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500">
            <span className="w-8 text-right">{fmtTime(progress)}</span>
            <input
              type="range" min={0} max={duration || 0} value={progress}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="flex-1 accent-amber-400 h-1"
            />
            <span className="w-8">{fmtTime(duration)}</span>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2 w-40">
          <Volume2 className="w-4 h-4 text-slate-500" />
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="flex-1 accent-amber-400 h-1" />
        </div>
        <div className="hidden lg:flex items-center gap-1 text-xs text-slate-500 w-20 justify-end">
          <ListMusic className="w-3.5 h-3.5" /> {queueCount}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */
function Toast({ text, kind }) {
  return (
    <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full text-sm shadow-lg border ${
      kind === "warn" ? "bg-amber-50 border-amber-300 text-amber-900" : "bg-violet-100 border-slate-300 text-slate-800"
    }`}>
      {text}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal shell                                                        */
/* ------------------------------------------------------------------ */
function ModalShell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 flex items-center justify-center p-4">
      <div className={`bg-white border border-slate-300 rounded-2xl w-full ${wide ? "max-w-lg" : "max-w-md"} max-h-[85vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-300 sticky top-0 bg-white">
          <h3 className="font-display text-lg">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function VibePicker({ selected, onChange }) {
  function toggle(v) { onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]); }
  return (
    <div className="flex flex-wrap gap-1.5">
      {VIBES.map((v) => (
        <button
          type="button"
          key={v}
          onClick={() => toggle(v)}
          className={`text-xs px-2.5 py-1 rounded-full border transition ${selected.includes(v) ? "bg-amber-400 border-amber-400 text-slate-950" : "border-slate-300 text-slate-500 hover:border-slate-400"}`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add song modal                                                     */
/* ------------------------------------------------------------------ */
function AddSongModal({ user, onClose, onSaved, flash }) {
  const [source, setSource] = useState("upload"); // upload | manual
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [coverPreviewSrc, setCoverPreviewSrc] = useState(""); // what's shown on screen
  const [coverBlob, setCoverBlob] = useState(null);           // resized image, not yet uploaded
  const [fromUpload, setFromUpload] = useState(false);
  const [audioFile, setAudioFile] = useState(null);           // raw file, not yet uploaded
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [vibes, setVibes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function resetFields() {
    setTitle(""); setArtist(""); setAlbum(""); setReleaseDate(""); setAudioUrl("");
    setCoverPreviewSrc(""); setCoverBlob(null);
    setFromUpload(false); setAudioFile(null); setUploadedFileName("");
  }

  async function handleCover(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const resized = await resizeImageFile(file);
      setCoverBlob(resized);
      setCoverPreviewSrc(URL.createObjectURL(resized));
    } catch (err) {
      setError(err.message || "Couldn't read that image.");
    }
  }

  function handleAudioFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
      setError(`That file is ${(file.size / (1024 * 1024)).toFixed(1)}MB — audio uploads are capped at ${MAX_AUDIO_MB}MB.`);
      return;
    }
    setAudioFile(file);
    setUploadedFileName(file.name);
    setFromUpload(true);
    setAudioUrl("");
    if (!title.trim()) setTitle(file.name.replace(/\.[a-z0-9]+$/i, ""));
    setSource("upload");
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    if (!title.trim() || !artist.trim()) { setError("Add at least a title and artist."); return; }
    if (source === "upload" && !audioFile) { setError("Upload an audio file first."); return; }
    if (source === "manual" && !audioUrl.trim()) { setError("Add a direct audio link, or switch to Upload a file."); return; }

    setBusy(true);
    try {
      const coverForCheck = coverBlob ? await blobToDataUrl(coverBlob) : "";
      const check = await moderateSubmission({ title, artist, album, coverDataUrl: coverForCheck });
      if (check.checked && !check.appropriate) {
        setError(`This didn't pass the school-appropriateness check: ${check.reason}`);
        return;
      }
      if (!check.checked) flash(check.reason, "warn");

      let finalAudioUrl = audioUrl.trim();
      if (source === "upload" && audioFile) {
        try { finalAudioUrl = await uploadAudio(audioFile); }
        catch (err) { setError(err.message || "That file didn't upload — try again."); return; }
      }

      let finalCoverUrl = "";
      if (coverBlob) {
        try { finalCoverUrl = await uploadImage(coverBlob); }
        catch { setError("The cover image didn't upload — try again or skip it."); return; }
      }

      const song = {
        id: uid("song"),
        title: title.trim(),
        artist: artist.trim(),
        album: album.trim(),
        releaseDate: releaseDate.trim(),
        audioUrl: finalAudioUrl,
        coverDataUrl: finalCoverUrl || "",
        hasUploadedAudio: source === "upload",
        vibes,
        owner: user.username,
        status: user.isAdmin ? "approved" : "pending",
        createdAt: Date.now(),
      };
      onSaved(song);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Add a song" onClose={onClose} wide>
      <div className="flex gap-1 mb-4 bg-violet-100 rounded-lg p-1">
        <button
          type="button"
          onClick={() => setSource("upload")}
          className={`flex-1 py-1.5 rounded-md text-xs sm:text-sm font-medium transition ${source === "upload" ? "bg-amber-400 text-slate-950" : "text-slate-500"}`}
        >
          Upload a file
        </button>
        <button
          type="button"
          onClick={() => setSource("manual")}
          className={`flex-1 py-1.5 rounded-md text-xs sm:text-sm font-medium transition ${source === "manual" ? "bg-amber-400 text-slate-950" : "text-slate-500"}`}
        >
          Paste a link
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-3">
        {source === "upload" ? (
          audioFile ? (
            <div className="flex items-center gap-2 text-xs text-slate-600 bg-violet-100 border border-slate-300 rounded-lg p-2.5">
              <Music2 className="w-4 h-4 shrink-0 text-amber-500" />
              <span className="flex-1 truncate">{uploadedFileName}</span>
              <label className="text-amber-600 hover:underline cursor-pointer shrink-0">
                Replace
                <input type="file" accept="audio/*,video/*" onChange={handleAudioFile} className="hidden" />
              </label>
            </div>
          ) : (
            <div>
              <div className="text-xs text-slate-500 mb-2">
                Upload an audio or video file — mp3, wav, m4a, mp4, and so on.
                Only the audio track plays; nothing is shown as video.
              </div>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl py-8 cursor-pointer hover:border-amber-400 transition">
                <Upload className="w-6 h-6 text-slate-500" />
                <span className="text-sm text-slate-500">Choose an audio or video file</span>
                <span className="text-[11px] text-slate-500">Up to {MAX_AUDIO_MB}MB</span>
                <input type="file" accept="audio/*,video/*" onChange={handleAudioFile} className="hidden" />
              </label>
            </div>
          )
        ) : (
          <Field label="Audio link" hint="A direct URL to a hosted audio file (e.g. a royalty-free site or your own hosting). Not a YouTube/Spotify/Apple Music page link.">
            <input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} className={inputCls} placeholder="https://.../track.mp3" />
          </Field>
        )}

        <div className="text-[11px] text-slate-500 -mt-1">Double-check the details below — accuracy helps everyone find it later.</div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Song title" /></Field>
          <Field label="Artist"><input value={artist} onChange={(e) => setArtist(e.target.value)} className={inputCls} placeholder="Artist name" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Album (optional)"><input value={album} onChange={(e) => setAlbum(e.target.value)} className={inputCls} placeholder="Album" /></Field>
          <Field label="Release date (optional)"><input value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} className={inputCls} placeholder="e.g. 2024 or Jun 2024" /></Field>
        </div>
        {!user.isAdmin && (
          <div className="flex gap-2 text-xs text-slate-600 bg-violet-100 border border-slate-300 rounded-lg p-2.5">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <span>Heads up — songs added by students go to the admins for review before they show up publicly.</span>
          </div>
        )}
        <Field label="Cover art (optional)">
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="w-16 h-16 rounded-lg bg-violet-100 border border-slate-300 flex items-center justify-center overflow-hidden shrink-0">
              {coverPreviewSrc ? <img src={coverPreviewSrc} className="w-full h-full object-cover" alt="" /> : <Upload className="w-5 h-5 text-slate-500" />}
            </div>
            <span className="text-sm text-slate-500">Upload image</span>
            <input type="file" accept="image/*" onChange={handleCover} className="hidden" />
          </label>
          <div className="text-[11px] text-slate-500 mt-1">Checked automatically for school-appropriateness, and uploaded when you save.</div>
        </Field>
        <Field label="Vibe tags"><VibePicker selected={vibes} onChange={setVibes} /></Field>

        {error && <div className="text-xs text-rose-400 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}</div>}

        <div className="flex gap-2">
          {audioFile && (
            <button type="button" onClick={resetFields} className="text-sm text-slate-500 hover:text-slate-700 px-3">
              Start over
            </button>
          )}
          <button disabled={busy} className="flex-1 bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Sparkles className="w-4 h-4" /> Save song</>}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-xs text-slate-500 mb-1 block">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}
const inputCls = "w-full bg-violet-100 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400";

/* ------------------------------------------------------------------ */
/* Add playlist modal                                                 */
/* ------------------------------------------------------------------ */
function AddPlaylistModal({ user, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [vibes, setVibes] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    if (!name.trim()) { setError("Give your playlist a name."); return; }
    setBusy(true);
    try {
      const check = await moderateSubmission({ playlistName: name });
      if (check.checked && !check.appropriate) { setError(`That name didn't pass the appropriateness check: ${check.reason}`); return; }
      onSaved({
        id: uid("pl"),
        name: name.trim(),
        owner: user.username,
        songIds: [],
        vibes,
        createdAt: Date.now(),
      });
    } finally { setBusy(false); }
  }

  return (
    <ModalShell title="New playlist" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-3">
        <Field label="Playlist name" hint="Make sure it's accurate and school-appropriate.">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Rainy Study Session" />
        </Field>
        <Field label="Vibe tags"><VibePicker selected={vibes} onChange={setVibes} /></Field>
        {error && <div className="text-xs text-rose-400 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}</div>}
        <button disabled={busy} className="w-full bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListPlus className="w-4 h-4" />} Create playlist
        </button>
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/* Add existing songs to a playlist                                   */
/* ------------------------------------------------------------------ */
function AddExistingSongsModal({ playlist, allSongs, onClose, onSaved }) {
  const [picked, setPicked] = useState([]);
  const [q, setQ] = useState("");
  const options = allSongs.filter((s) => !playlist.songIds.includes(s.id) && (s.title + s.artist).toLowerCase().includes(q.toLowerCase()));

  function toggle(id) { setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); }

  return (
    <ModalShell title={`Add songs to "${playlist.name}"`} onClose={onClose} wide>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the library..." className={inputCls + " mb-3"} />
      <div className="max-h-80 overflow-y-auto border border-slate-300 rounded-lg divide-y divide-slate-200">
        {options.length === 0 && <div className="p-3 text-sm text-slate-500">No matching songs.</div>}
        {options.map((s) => (
          <label key={s.id} className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-violet-50">
            <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
            <img src={s.coverDataUrl || FALLBACK_COVER} className="w-8 h-8 rounded object-cover" alt="" />
            <div className="min-w-0">
              <div className="text-sm truncate">{s.title}</div>
              <div className="text-xs text-slate-500 truncate">{s.artist}</div>
            </div>
          </label>
        ))}
      </div>
      <button
        onClick={() => onSaved(picked)}
        disabled={picked.length === 0}
        className="w-full mt-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold rounded-lg py-2.5 text-sm disabled:opacity-40"
      >
        Add {picked.length || ""} song{picked.length === 1 ? "" : "s"}
      </button>
    </ModalShell>
  );
}
