/* ============================================================
   Gratteri Ambassadors — app logic
   A tiny community site: family profiles, a shared visit
   calendar, events, a village guide, and a photo wall,
   backed by Supabase.
   ============================================================ */

const SUPABASE_URL = "https://rlcshcpzcywnmbdnfasn.supabase.co";
const SUPABASE_KEY = "sb_publishable_c2IIRJKJYAOQ_wqNX4euTA_sizgezlu";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const PALETTE = [
  "#C96F4A", "#3E6E8E", "#7A8450", "#B4884B", "#8E5A8E",
  "#4A9A8E", "#B4423A", "#5A6EA8", "#A8763E", "#6E8E4A",
  "#8E6E5A", "#4A7A9A",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CATEGORIES = {
  eat: { label: "Eat & drink", emoji: "🍝" },
  beach: { label: "Beaches & swimming", emoji: "🏖️" },
  walk: { label: "Walks & day trips", emoji: "🥾" },
  trade: { label: "Tradespeople & services", emoji: "🔧" },
  shop: { label: "Shops & markets", emoji: "🛒" },
  practical: { label: "Practical & emergencies", emoji: "🏥" },
  other: { label: "Other gems", emoji: "✨" },
};

// share links follow whichever domain the site is served from (Pages, Vercel, …)
const SITE_URL = window.location.origin + window.location.pathname;

// ---------- state ----------
let session = null;
let families = [];
let visits = [];
let messages = [];
let events = [];
let interests = [];
let eventComments = [];
let places = [];
let placeTips = [];
let placeHearts = [];
let galleryPhotos = [];
let memberships = [];
let guideVotes = [];
let myFamily = null;
let year = new Date().getFullYear();
let selectedColor = PALETTE[0];
let guideFilter = "all";
let exploreFilter = "all";
// login-free visitor guide (?guest=1) — short-circuits the whole auth flow
const isGuest = new URLSearchParams(window.location.search).get("guest") === "1";
let guestFilter = "all";

const EXPLORE_CATS = {
  village: { label: "In & around Gratteri", emoji: "🏘️" },
  nature: { label: "Madonie & nature", emoji: "🥾" },
  towns: { label: "Historic towns", emoji: "🏰" },
  beach: { label: "Coast & beaches", emoji: "🏖️" },
  food: { label: "Food & dishes", emoji: "🍝" },
  eat: { label: "Restaurants & cafés", emoji: "🍽️" },
  shop: { label: "Bakers, butchers & delis", emoji: "🥖" },
  wine: { label: "Wine & vineyards", emoji: "🍷" },
  daytrip: { label: "Day trips", emoji: "🚗" },
};

// stable id for a guide entry (used as the vote key) — derived from its name
const guideId = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
let appEntered = false;     // guards enterApp against duplicate auth events (TOKEN_REFRESHED etc.)
let profileDirty = false;   // true while the profile form has unsaved edits — blocks re-population
let loadSeq = 0;            // discards out-of-order loadData responses
let lastLoadAt = 0;

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// escape, then turn bare http(s) URLs into links (bio, tips, comments, …)
function linkify(s) {
  return esc(s).replace(/\bhttps?:\/\/[^\s<>"']+/gi, (u) => {
    const url = u.replace(/[.,!?)]+$/, "");
    return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${u.slice(url.length)}`;
  });
}

const famById = (id) => families.find((f) => f.id === id);
const famName = (id) => famById(id)?.family_name || "A former member";
const famColor = (id) => famById(id)?.color || "#999";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function fmtRange(a, b) {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, dbb] = b.split("-").map(Number);
  if (ya === yb && ma === mb) return `${da}–${dbb} ${MONTHS[ma - 1]} ${ya}`;
  if (ya === yb) return `${da} ${MONTHS[ma - 1]} – ${dbb} ${MONTHS[mb - 1]} ${ya}`;
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

function fmtWhen(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayOfYear(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000;
}

function daysInYear(y) {
  return (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86400000;
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add("hidden"), 3000);
}

function setMsg(el, text, kind) {
  el.textContent = text;
  el.className = el.className.replace(/\b(error|ok)\b/g, "").trim();
  if (kind) el.classList.add(kind);
}

// Keeps half-typed comment/tip inputs alive across an innerHTML rebuild.
function withInputsPreserved(container, render) {
  const saved = {};
  container.querySelectorAll("form[data-key]").forEach((f) => {
    const i = f.querySelector("input");
    if (i && i.value) saved[f.dataset.key] = i.value;
  });
  render();
  container.querySelectorAll("form[data-key]").forEach((f) => {
    if (saved[f.dataset.key]) f.querySelector("input").value = saved[f.dataset.key];
  });
}

// ---------- auth ----------
let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  $("tab-login").classList.toggle("active", mode === "login");
  $("tab-signup").classList.toggle("active", mode === "signup");
  $("signup-fields").classList.toggle("hidden", mode === "login");
  $("auth-submit").textContent = mode === "login" ? "Log in" : "Create account";
  setMsg($("auth-message"), "");
}

$("tab-login").addEventListener("click", () => setAuthMode("login"));
$("tab-signup").addEventListener("click", () => setAuthMode("signup"));

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const msg = $("auth-message");
  $("auth-submit").disabled = true;

  try {
    if (authMode === "signup") {
      const familyName = $("auth-family-name").value.trim();
      const familyCode = $("auth-family-code").value.trim();
      if (!familyName && !familyCode) {
        setMsg(msg, "Give your family a name — or enter a family code to join one already here.", "error");
        return;
      }
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: { data: { family_name: familyName || null, family_code: familyCode || null } },
      });
      if (error) throw error;
      if (!data.session) {
        setMsg(msg, "Almost there! Check your email for a confirmation link, then log in.", "ok");
        return;
      }
      // session exists (email confirmation disabled) — onAuthStateChange takes over
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    let friendly = err.message || "Something went wrong — please try again.";
    if (err.code === "over_email_send_rate_limit" || /rate limit/i.test(friendly)) {
      friendly = "Our signup email service has hit its hourly limit — nothing wrong with your details! Please try again in an hour or so.";
    }
    setMsg(msg, friendly, "error");
  } finally {
    $("auth-submit").disabled = false;
  }
});

$("btn-logout").addEventListener("click", () => db.auth.signOut());

db.auth.onAuthStateChange((_event, s) => {
  if (isGuest) return; // guest mode never enters the ambassador app
  session = s;
  if (!s) {
    appEntered = false;
    profileDirty = false;
    $("app").classList.add("hidden");
    $("auth-screen").classList.remove("hidden");
    return;
  }
  if (appEntered) return; // TOKEN_REFRESHED / USER_UPDATED — already in the app
  appEntered = true;
  // deferred: running queries directly inside this callback can deadlock supabase-js
  setTimeout(() => {
    enterApp().catch((err) => {
      appEntered = false;
      toast("Could not load data: " + (err.message || err));
    });
  }, 0);
});

// ---------- data ----------
async function ensureMyFamily() {
  const uid = session.user.id;
  const findMine = async () => {
    const { data: mem, error } = await db
      .from("family_members").select("family_id").eq("user_id", uid).maybeSingle();
    if (error) throw error;
    if (!mem) return null;
    const { data: fam, error: e2 } = await db
      .from("families").select("*").eq("id", mem.family_id).maybeSingle();
    if (e2) throw e2;
    return fam;
  };

  myFamily = await findMine();
  if (myFamily) return;

  const meta = session.user.user_metadata || {};
  if (meta.family_code) {
    const { error: joinErr } = await db.rpc("join_family", { code: meta.family_code });
    if (!joinErr) {
      myFamily = await findMine();
      if (myFamily) { toast(`Welcome to ${myFamily.family_name}! 🏡`); return; }
    }
    // bad code — fall through and give them their own family
  }

  const name = meta.family_name || "New family";
  const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const { data: created, error: insErr } = await db
    .from("families")
    .insert({ user_id: uid, family_name: name, color })
    .select().single();
  if (insErr) {
    // lost a race with another tab/session — adopt whatever family won
    myFamily = await findMine();
    if (myFamily) return;
    throw insErr;
  }
  myFamily = created;
}

async function loadData() {
  const results = await Promise.all([
    db.from("families").select("*").order("family_name"),
    db.from("visits").select("*").order("start_date"),
    db.from("messages").select("*").order("created_at", { ascending: false }),
    db.from("events").select("*").order("event_date"),
    db.from("event_interest").select("*"),
    db.from("event_comments").select("*").order("created_at"),
    db.from("places").select("*").order("name"),
    db.from("place_tips").select("*").order("created_at"),
    db.from("place_hearts").select("*"),
    db.from("gallery_photos").select("*").order("created_at", { ascending: false }),
    db.from("family_members").select("*"),
    db.from("guide_votes").select("*"),
  ]);
  for (const r of results) if (r.error) throw r.error;
  return results.map((r) => r.data);
}

async function refresh() {
  const seq = ++loadSeq;
  const data = await loadData();
  if (seq !== loadSeq || !session) return; // superseded by a newer refresh, or signed out mid-flight
  [families, visits, messages, events, interests, eventComments,
    places, placeTips, placeHearts, galleryPhotos, memberships, guideVotes] = data;
  const myMem = memberships.find((m) => m.user_id === session.user.id);
  myFamily = (myMem && families.find((f) => f.id === myMem.family_id)) || myFamily;
  lastLoadAt = Date.now();
  renderAll();
}

function handleRefreshError(err) {
  const m = String(err?.message || err);
  if (/jwt|token|expired|unauthorized/i.test(m)) {
    toast("Your session has expired — please log in again.");
    db.auth.signOut();
  } else {
    toast("Couldn't refresh — showing the last loaded data.");
  }
}

const safeRefresh = () => refresh().catch(handleRefreshError);

async function enterApp() {
  $("auth-screen").classList.add("hidden");
  $("app").classList.remove("hidden");
  await ensureMyFamily();
  await refresh();
  // arrived via an invite link while already logged in → offer to join that family
  const code = pendingInviteCode();
  if (code && myFamily && (myFamily.invite_code || "").toUpperCase() !== code.toUpperCase()) {
    clearInviteParam();
    await doJoin(code, null);
  }
}

function pendingInviteCode() {
  return new URLSearchParams(window.location.search).get("join");
}

function clearInviteParam() {
  history.replaceState(null, "", window.location.pathname);
}

// ---------- navigation ----------
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b === btn));
    ["calendar", "stream", "families", "events", "guide", "gallery", "board", "mine"].forEach((v) => {
      $("view-" + v).classList.toggle("hidden", v !== btn.dataset.view);
    });
    document.querySelector("#app .main")?.scrollTo({ top: 0 }); // new tab starts at the top
    // pick up other families' additions, but not on rapid tab-flipping
    if (Date.now() - lastLoadAt > 5000) safeRefresh();
  });
});

// ---------- render: everything ----------
function renderAll() {
  renderCheckin();
  renderVillageStats();
  renderProfileHero();
  renderStream();
  renderInTown();
  renderOverlaps();
  renderChart();
  renderFamilies();
  renderEvents();
  renderGuide();
  renderGallery();
  renderBoard();
  renderExplore(); // re-render so vote counts reflect the latest data
  renderProfileForm();
  renderMyVisits();
  $("footer-stats").textContent =
    `${families.length} famil${families.length === 1 ? "y" : "ies"} · ${visits.length} visit${visits.length === 1 ? "" : "s"} planned · ${events.length} event${events.length === 1 ? "" : "s"} · ${places.length} place${places.length === 1 ? "" : "s"} in the guide`;
}

// ---------- gamification: badges & village stats ----------
// The Estate Gratterese programme account is excluded from badges and counts.
const SYSTEM_FAMILY_USER_ID = "c0111111-1111-4111-8111-111111111111";
const realFamilies = () => families.filter((f) => f.user_id !== SYSTEM_FAMILY_USER_ID);

function daysBetween(a, b) {
  return (Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) -
          Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000 + 1;
}

function daysInGratteri(famId, y) {
  const ys = `${y}-01-01`, ye = `${y}-12-31`;
  let total = 0;
  for (const v of visits.filter((v) => v.family_id === famId)) {
    const s = v.start_date < ys ? ys : v.start_date;
    const e = v.end_date > ye ? ye : v.end_date;
    if (s <= e) total += daysBetween(s, e);
  }
  return total;
}

function computeBadges(famId) {
  const fam = famById(famId);
  if (!fam || fam.user_id === SYSTEM_FAMILY_USER_ID) return [];
  const badges = [];
  const add = (emoji, name, desc) => badges.push({ emoji, name, desc });

  const pioneers = realFamilies()
    .sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 5);
  if (pioneers.some((f) => f.id === famId)) add("🌱", "Pioneer", "Among the first five families to join");

  const mine = visits.filter((v) => v.family_id === famId);
  if (mine.some((v) => v.notes === "Checked in 📍")) add("📍", "Spontaneo", "Checked in on arrival — no planning needed");
  if (mine.some((v) => {
    const ms = +v.start_date.slice(5, 7), me = +v.end_date.slice(5, 7);
    return ms < 6 || ms > 9 || me < 6 || me > 9;
  })) add("❄️", "Fuori Stagione", "In Gratteri outside the summer months");
  if (daysInGratteri(famId, new Date().getFullYear()) >= 30) add("🏡", "Summer Resident", "30+ days in Gratteri this year");

  if (places.filter((p) => p.family_id === famId).length >= 3) add("🗺️", "Guide Author", "Added three or more places to the guide");
  if (placeTips.filter((t) => t.family_id === famId).length >= 5) add("💡", "Local Sage", "Shared five or more tips");
  if (interests.filter((i) => i.family_id === famId).length >= 3) add("🎉", "Festa Regular", "Interested in three or more events");
  if (galleryPhotos.filter((p) => p.family_id === famId).length >= 5) add("📸", "Village Eye", "Five or more photos on the wall");

  const overlapped = new Set();
  for (const v of mine)
    for (const o of visits)
      if (o.family_id !== famId && o.start_date <= v.end_date && o.end_date >= v.start_date)
        overlapped.add(o.family_id);
  if (overlapped.size >= 3) add("🤝", "Matchmaker", "Overlapped with three or more families");

  return badges;
}

const badgeChips = (famId, withNames) => computeBadges(famId).map((b) =>
  withNames
    ? `<span class="badge badge-named" title="${esc(b.desc)}">${b.emoji} ${esc(b.name)}</span>`
    : `<span class="badge" title="${esc(b.name)} — ${esc(b.desc)}">${b.emoji}</span>`
).join("");

// ---------- render: profile hero ----------
function renderProfileHero() {
  const hero = $("profile-hero");
  if (!myFamily) { hero.innerHTML = ""; return; }
  const y = new Date().getFullYear();
  const today = todayStr();
  const days = daysInGratteri(myFamily.id, y);
  const upcoming = visits.filter((v) => v.family_id === myFamily.id && v.end_date >= today).length;
  const badges = badgeChips(myFamily.id, true);
  hero.innerHTML = `
    <div class="hero-top">
      ${myFamily.photo_url
        ? `<img class="hero-photo" src="${esc(myFamily.photo_url)}" alt="Your family photo" style="object-position:${myFamily.photo_focus_x ?? 50}% ${myFamily.photo_focus_y ?? 35}%">`
        : `<div class="hero-photo hero-photo-empty">🌿</div>`}
      <div>
        <h3>${esc(myFamily.family_name)}</h3>
        <span class="muted">Ambassador since ${esc(fmtDate(myFamily.created_at.slice(0, 10)))}
          · code <strong>${esc(myFamily.invite_code || "—")}</strong>
          · ${memberships.filter((m) => m.family_id === myFamily.id).length || 1} login${memberships.filter((m) => m.family_id === myFamily.id).length === 1 ? "" : "s"}</span>
        ${badges ? `<div class="hero-badges">${badges}</div>` : `<div class="hero-badges muted">Badges appear as you visit, post, and share 🌱</div>`}
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat-tile"><span>${days}</span><small>day${days === 1 ? "" : "s"} in Gratteri ${y}</small></div>
      <div class="stat-tile"><span>${upcoming}</span><small>visit${upcoming === 1 ? "" : "s"} coming up</small></div>
      <div class="stat-tile"><span>${places.filter((p) => p.family_id === myFamily.id).length + placeTips.filter((t) => t.family_id === myFamily.id).length}</span><small>guide contributions</small></div>
      <div class="stat-tile"><span>${galleryPhotos.filter((p) => p.family_id === myFamily.id).length}</span><small>photos shared</small></div>
    </div>`;

  $("invite-link").value = inviteLink();
}

function inviteLink() {
  return myFamily ? `${SITE_URL}?join=${encodeURIComponent(myFamily.invite_code || "")}` : SITE_URL;
}

function inviteText() {
  return `Join our family "${myFamily.family_name}" on the Gratteri Ambassadors site 🌿 — tap to sign up and we'll share one entry on the village calendar:\n${inviteLink()}`;
}

$("btn-invite").addEventListener("click", async () => {
  const msg = $("invite-message");
  if (navigator.share) {
    try { await navigator.share({ title: "Gratteri Ambassadors", text: inviteText(), url: inviteLink() }); return; }
    catch { /* user cancelled or unsupported — fall back to showing the link */ }
  }
  $("invite-link-box").classList.remove("hidden");
  $("invite-link").value = inviteLink();
  $("invite-link").select();
  setMsg(msg, "Copy this link and send it to your household.", "ok");
});

$("btn-invite-wa").addEventListener("click", () => {
  window.open(`https://wa.me/?text=${encodeURIComponent(inviteText())}`, "_blank", "noopener");
});

// ---------- share the login-free guest guide ----------
const guestLink = () => `${SITE_URL}?guest=1`;
const guestText = () => `Here's the visitor guide to Gratteri 🌿 — things to do, what's on, and who's in town while you're here:\n${guestLink()}`;

$("btn-guest-share").addEventListener("click", async () => {
  const msg = $("guest-share-message");
  if (navigator.share) {
    try { await navigator.share({ title: "Gratteri Visitor Guide", text: guestText(), url: guestLink() }); return; }
    catch { /* fall through to link box */ }
  }
  $("guest-link-box").classList.remove("hidden");
  $("guest-link").value = guestLink();
  $("guest-link").select();
  setMsg(msg, "Copy this link and send it to your guests.", "ok");
});
$("btn-guest-wa").addEventListener("click", () => {
  window.open(`https://wa.me/?text=${encodeURIComponent(guestText())}`, "_blank", "noopener");
});
$("btn-copy-guest").addEventListener("click", async () => {
  const msg = $("guest-share-message");
  try { await navigator.clipboard.writeText(guestLink()); setMsg(msg, "Link copied ✓", "ok"); }
  catch { $("guest-link").value = guestLink(); $("guest-link").select(); setMsg(msg, "Select the link above and copy it.", "ok"); }
  setTimeout(() => setMsg(msg, ""), 2500);
});

$("btn-copy-invite").addEventListener("click", async () => {
  const msg = $("invite-message");
  try { await navigator.clipboard.writeText(inviteLink()); setMsg(msg, "Link copied ✓", "ok"); }
  catch { $("invite-link").select(); setMsg(msg, "Select the link above and copy it.", "ok"); }
  setTimeout(() => setMsg(msg, ""), 2500);
});

async function doJoin(code, msgEl) {
  if (!confirm(`Join the family with code ${code.toUpperCase()}? Your login and everything you've posted will move into that family, and your current family entry will be retired.`)) return;
  const { error } = await db.rpc("join_family", { code });
  if (error) { if (msgEl) setMsg(msgEl, error.message, "error"); else toast(error.message); return; }
  if (msgEl) setMsg(msgEl, "");
  $("join-form").reset();
  toast("Welcome to your family! 🏡");
  await safeRefresh();
}

$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("jf-code").value.trim();
  if (code) await doJoin(code, $("join-message"));
});

// ---------- render: village stats + Unwrapped ----------
function renderVillageStats() {
  const y = new Date().getFullYear();
  const fams = realFamilies();
  const totalDays = fams.reduce((sum, f) => sum + daysInGratteri(f.id, y), 0);
  $("village-stats").innerHTML = `
    <div class="village-chips">
      <span class="chip">🏡 ${fams.length} famil${fams.length === 1 ? "y" : "ies"}</span>
      <span class="chip">🗓 ${totalDays} days together in ${y}</span>
      <span class="chip">📌 ${events.length} events</span>
      <span class="chip">🌿 ${places.length} places</span>
      <span class="chip">🌅 ${galleryPhotos.length} photos</span>
    </div>
    <button class="btn btn-primary" id="btn-unwrapped" type="button">🎁 Gratteri Unwrapped ${y}</button>`;
}

function renderUnwrapped() {
  const y = new Date().getFullYear();
  const ys = `${y}-01-01`, ye = `${y}-12-31`;
  const fams = realFamilies();
  const totalDays = fams.reduce((sum, f) => sum + daysInGratteri(f.id, y), 0);

  // busiest day: most families in town at once
  let busiest = { day: null, count: 0 };
  const yearVisits = visits.filter((v) => v.start_date <= ye && v.end_date >= ys);
  const checkpoints = [...new Set(yearVisits.map((v) => (v.start_date < ys ? ys : v.start_date)))];
  for (const day of checkpoints) {
    const count = new Set(yearVisits.filter((v) => v.start_date <= day && v.end_date >= day).map((v) => v.family_id)).size;
    if (count > busiest.count) busiest = { day, count };
  }

  const heartCounts = places.map((p) => ({ p, n: placeHearts.filter((h) => h.place_id === p.id).length }))
    .sort((a, b) => b.n - a.n)[0];
  const hotEvent = events.map((ev) => ({ ev, n: interests.filter((i) => i.event_id === ev.id).length }))
    .sort((a, b) => b.n - a.n)[0];
  const longest = yearVisits.map((v) => ({ v, d: daysBetween(v.start_date < ys ? ys : v.start_date, v.end_date > ye ? ye : v.end_date) }))
    .sort((a, b) => b.d - a.d)[0];
  const first = [...yearVisits].sort((a, b) => a.start_date.localeCompare(b.start_date))[0];

  const card = (num, label) => `<div class="uw-card"><span>${num}</span><small>${label}</small></div>`;
  $("unwrapped").innerHTML = `
    <div class="uw-inner">
      <button class="btn btn-ghost uw-close" id="unwrapped-close" type="button">✕ Close</button>
      <div class="uw-hero">
        <div class="uw-emblem">🌿</div>
        <h2>Gratteri Unwrapped</h2>
        <div class="uw-year">${y}</div>
        <p>Our village year, so far</p>
      </div>
      <div class="uw-grid">
        ${card(totalDays, `days in Gratteri, all together`)}
        ${card(fams.length, `ambassador famil${fams.length === 1 ? "y" : "ies"}`)}
        ${busiest.count ? card(busiest.count, `families in town at once — peak on ${esc(fmtDate(busiest.day))}`) : ""}
        ${first ? card(esc(fmtDate(first.start_date < ys ? ys : first.start_date)), `first arrival of the year — ${esc(famName(first.family_id))}`) : ""}
        ${longest ? card(`${longest.d} days`, `longest stay — ${esc(famName(longest.v.family_id))}`) : ""}
        ${card(events.length, "events on the calendar")}
        ${hotEvent && hotEvent.n ? card(esc(hotEvent.ev.title), `the hot ticket — ${hotEvent.n} famil${hotEvent.n === 1 ? "y" : "ies"} interested`) : ""}
        ${card(places.length, "places in the village guide")}
        ${heartCounts && heartCounts.n ? card(esc(heartCounts.p.name), `most-loved place — ${heartCounts.n} ❤️`) : ""}
        ${card(galleryPhotos.length, "photos on the wall")}
        ${card(placeTips.length + messages.length + eventComments.length, "tips, notes & comments shared")}
      </div>
      <a class="btn btn-primary uw-share" target="_blank" rel="noopener"
        href="https://wa.me/?text=${encodeURIComponent(`🌿 Gratteri Unwrapped ${y}: ${fams.length} families, ${totalDays} days in the village together, ${events.length} events, ${places.length} places in our guide. ${SITE_URL}`)}">Share to WhatsApp 💬</a>
    </div>`;
  $("unwrapped").classList.remove("hidden");
}

// ---------- render: the stream ----------
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso.slice(0, 10));
}

const snippet = (s, n = 110) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function renderStream() {
  const items = [];
  const add = (created_at, familyId, emoji, html, extra = "") =>
    created_at && items.push({ created_at, familyId, emoji, html, extra });
  const who = (id) => `<strong>${esc(famName(id))}</strong>`;

  families.forEach((f) =>
    add(f.created_at, f.id, "🎉", `${who(f.id)} joined the ambassadors`));

  visits.forEach((v) => {
    const checkin = v.notes === "Checked in 📍";
    add(v.created_at, v.family_id, checkin ? "📍" : "🧳",
      checkin
        ? `${who(v.family_id)} checked in — in Gratteri until <strong>${esc(fmtDate(v.end_date))}</strong>`
        : `${who(v.family_id)} planned a visit: <strong>${esc(fmtRange(v.start_date, v.end_date))}</strong>${v.notes ? ` <span class="muted">· ${esc(snippet(v.notes, 60))}</span>` : ""}`);
  });

  events.forEach((ev) =>
    add(ev.created_at, ev.family_id, "📌",
      `${who(ev.family_id)} pinned <strong>${esc(ev.title)}</strong> · ${esc(fmtDate(ev.event_date))}`));

  interests.forEach((i) => {
    const ev = events.find((e) => e.id === i.event_id);
    if (ev) add(i.created_at, i.family_id, "🙋",
      `${who(i.family_id)} is interested in <em>${esc(ev.title)}</em>`);
  });

  eventComments.forEach((c) => {
    const ev = events.find((e) => e.id === c.event_id);
    if (ev) add(c.created_at, c.family_id, "💬",
      `${who(c.family_id)} on <em>${esc(ev.title)}</em>: “${esc(snippet(c.body))}”`);
  });

  places.forEach((p) =>
    add(p.created_at, p.family_id, (CATEGORIES[p.category] || CATEGORIES.other).emoji,
      `${who(p.family_id)} added <strong>${esc(p.name)}</strong> to the guide`));

  placeTips.forEach((t) => {
    const p = places.find((x) => x.id === t.place_id);
    if (p) add(t.created_at, t.family_id, "💡",
      `${who(t.family_id)} tipped on <em>${esc(p.name)}</em>: “${esc(snippet(t.body))}”`);
  });

  placeHearts.forEach((h) => {
    const p = places.find((x) => x.id === h.place_id);
    if (p) add(h.created_at, h.family_id, "❤️",
      `${who(h.family_id)} rates <strong>${esc(p.name)}</strong>`);
  });

  galleryPhotos.forEach((ph) => {
    const { data: pub } = db.storage.from("gallery").getPublicUrl(ph.path);
    add(ph.created_at, ph.family_id, "🌅",
      `${who(ph.family_id)} shared a photo${ph.caption ? `: “${esc(snippet(ph.caption, 60))}”` : ""}`,
      `<img class="stream-thumb" src="${esc(pub.publicUrl)}" alt="${esc(ph.caption || "Photo shared by " + famName(ph.family_id))}" loading="lazy" data-lightbox="${esc(pub.publicUrl)}" style="object-position:${ph.focus_x ?? 50}% ${ph.focus_y ?? 35}%">`);
  });

  messages.forEach((m) =>
    add(m.created_at, m.family_id, "📝",
      `${who(m.family_id)} posted: “${esc(snippet(m.body))}”`));

  items.sort((a, b) => b.created_at.localeCompare(a.created_at));

  $("stream-list").innerHTML = items.slice(0, 60).map((it) => `
    <div class="stream-item">
      <span class="stream-emoji">${it.emoji}</span>
      <div class="stream-body">
        <span class="dot" style="background:${esc(famColor(it.familyId))}"></span>
        ${it.html}
        <span class="muted stream-when">· ${esc(timeAgo(it.created_at))}</span>
        ${it.extra}
      </div>
    </div>`).join("") ||
    `<p class="muted" style="text-align:center">Nothing yet — the stream fills up as families join, plan visits, and post.</p>`;
}

// ---------- render: check-in bar ----------
let checkinFormOpen = false;

function renderCheckin() {
  const bar = $("checkin-bar");
  if (!myFamily) { bar.innerHTML = ""; return; }
  const today = todayStr();
  const current = visits
    .filter((v) => v.family_id === myFamily.id && v.start_date <= today && v.end_date >= today)
    .sort((a, b) => b.end_date.localeCompare(a.end_date))[0];

  if (current) {
    checkinFormOpen = false;
    bar.innerHTML = current.end_date === today
      ? `<span>🏡 You're checked in — leaving today. Safe travels! 👋</span>`
      : `<span>🏡 You're checked in until <strong>${esc(fmtDate(current.end_date))}</strong></span>
         <button class="btn btn-ghost" data-checkout-visit="${current.id}" type="button">We're leaving today 👋</button>`;
    return;
  }

  if (checkinFormOpen) {
    const prev = $("checkin-until")?.value || "";
    bar.innerHTML = `<span>🏡 Welcome! Until when are you staying?</span>
      <input type="date" id="checkin-until" min="${today}" value="${esc(prev)}">
      <button class="btn btn-primary" data-checkin-confirm type="button">Check in ✓</button>
      <button class="btn btn-ghost" data-checkin-cancel type="button">Cancel</button>
      <span id="checkin-message" class="form-message"></span>`;
  } else {
    bar.innerHTML = `<span>📍 Just arrived and didn't plan ahead?</span>
      <button class="btn btn-primary" data-checkin-open type="button">I'm in Gratteri!</button>`;
  }
}

// ---------- render: who's in town ----------
function renderInTown() {
  const panel = $("in-town-panel");
  const today = todayStr();
  const now = visits.filter((v) => v.start_date <= today && v.end_date >= today);
  const soonLimit = new Date();
  soonLimit.setDate(soonLimit.getDate() + 14);
  const soonStr = `${soonLimit.getFullYear()}-${String(soonLimit.getMonth() + 1).padStart(2, "0")}-${String(soonLimit.getDate()).padStart(2, "0")}`;
  const soon = visits.filter((v) => v.start_date > today && v.start_date <= soonStr);

  if (!now.length && !soon.length) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");

  let html = "";
  if (now.length) {
    html += `<div><strong>🏡 In Gratteri right now:</strong><div class="in-town-chips">` +
      now.map((v) => `<span class="chip"><span class="dot" style="background:${esc(famColor(v.family_id))}"></span>${esc(famName(v.family_id))}${v.hosting_guests ? " 👥" : ""} <span class="muted">until ${esc(fmtDate(v.end_date))}</span></span>`).join("") +
      `</div></div>`;
  }
  if (soon.length) {
    html += `<div style="margin-top:${now.length ? "0.7rem" : "0"}"><strong>🧳 Arriving in the next two weeks:</strong><div class="in-town-chips">` +
      soon.map((v) => `<span class="chip"><span class="dot" style="background:${esc(famColor(v.family_id))}"></span>${esc(famName(v.family_id))} <span class="muted">from ${esc(fmtDate(v.start_date))}</span></span>`).join("") +
      `</div></div>`;
  }
  panel.innerHTML = html;
}

// ---------- render: your overlaps ----------
function renderOverlaps() {
  const panel = $("overlap-panel");
  const today = todayStr();
  if (!myFamily) { panel.classList.add("hidden"); return; }
  const mine = visits.filter((v) => v.family_id === myFamily.id && v.end_date >= today);
  const found = [];
  for (const fam of families) {
    if (fam.id === myFamily.id) continue;
    for (const v of visits.filter((x) => x.family_id === fam.id && x.end_date >= today)) {
      for (const m of mine) {
        const start = v.start_date > m.start_date ? v.start_date : m.start_date;
        const end = v.end_date < m.end_date ? v.end_date : m.end_date;
        if (start <= end) found.push({ fam, start, end });
      }
    }
  }
  if (!found.length) { panel.classList.add("hidden"); return; }
  found.sort((a, b) => a.start.localeCompare(b.start));
  panel.classList.remove("hidden");
  panel.innerHTML = `<strong>🤝 Your overlaps:</strong><div class="in-town-chips">` +
    found.map(({ fam, start, end }) =>
      `<span class="chip"><span class="dot" style="background:${esc(fam.color)}"></span>${esc(fam.family_name)} <span class="muted">${esc(fmtRange(start, end))}</span></span>`
    ).join("") + `</div>`;
}

// ---------- render: gantt chart ----------
function renderChart() {
  $("year-label").textContent = year;
  const chart = $("chart");
  const days = daysInYear(year);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  let html = `<div class="chart-row chart-months"><div class="chart-name">Family</div><div class="month-cells">` +
    MONTHS.map((m) => `<div class="month-cell">${m}</div>`).join("") + `</div></div>`;

  const rows = families.map((fam) => {
    const famVisits = visits.filter(
      (v) => v.family_id === fam.id && v.start_date <= yearEnd && v.end_date >= yearStart
    );
    return { fam, famVisits };
  });

  const withVisits = rows.filter((r) => r.famVisits.length);
  const withoutVisits = rows.filter((r) => !r.famVisits.length);

  if (!rows.length) {
    html += `<div class="chart-empty">No ambassadors yet — you're the first! 🎉</div>`;
  }

  let monthLines = "";
  for (let m = 1; m < 12; m++) {
    const pct = (dayOfYear(`${year}-${String(m + 1).padStart(2, "0")}-01`) / days) * 100;
    monthLines += `<div class="month-line" style="left:${pct}%"></div>`;
  }
  const today = todayStr();
  let todayLine = "";
  if (today >= yearStart && today <= yearEnd) {
    todayLine = `<div class="today-line" style="left:${(dayOfYear(today) / days) * 100}%"></div>`;
  }

  // events marker row (only when this year has events)
  const yearEvents = events.filter((ev) => ev.event_date >= yearStart && ev.event_date <= yearEnd);
  if (yearEvents.length) {
    const perDate = {};
    const markers = yearEvents.map((ev) => {
      // stagger same-day markers vertically so each stays separately tappable
      // (14px clears the ~20px rotated diamonds, so no marker covers another's centre)
      const n = perDate[ev.event_date] = (perDate[ev.event_date] || 0) + 1;
      const offset = [0, -14, 14][(n - 1) % 3];
      return `<div class="event-marker" style="left:${(dayOfYear(ev.event_date) / days) * 100}%;margin-top:${offset - 7}px" data-ref="event:${ev.id}"></div>`;
    }).join("");
    html += `<div class="chart-row chart-events-row">
      <div class="chart-name">📌 Events</div>
      <div class="chart-timeline">${monthLines}${todayLine}${markers}</div>
    </div>`;
  }

  for (const { fam, famVisits } of [...withVisits, ...withoutVisits]) {
    const bars = famVisits.map((v) => {
      const s = v.start_date < yearStart ? yearStart : v.start_date;
      const e = v.end_date > yearEnd ? yearEnd : v.end_date;
      const left = (dayOfYear(s) / days) * 100;
      const width = ((dayOfYear(e) - dayOfYear(s) + 1) / days) * 100;
      return `<div class="visit-bar" style="left:${left}%;width:${width}%;background:${esc(fam.color)}" data-ref="visit:${v.id}"></div>`;
    }).join("");

    html += `<div class="chart-row">
      <div class="chart-name" title="${esc(fam.family_name)}"><span class="dot" style="background:${esc(fam.color)}"></span>${esc(fam.family_name)}</div>
      <div class="chart-timeline">${monthLines}${todayLine}${bars}</div>
    </div>`;
  }

  chart.innerHTML = html;

  // on narrow screens the year is wider than the viewport — start centred on today
  // (only when the user hasn't scrolled the chart themselves)
  const scroller = chart.parentElement;
  if (todayLine && scroller.scrollLeft === 0 && scroller.scrollWidth > scroller.clientWidth + 10) {
    const nameW = chart.querySelector(".chart-name")?.offsetWidth || 0;
    const timelineW = scroller.scrollWidth - nameW;
    scroller.scrollLeft = Math.max(0, nameW + (dayOfYear(today) / days) * timelineW - scroller.clientWidth / 2);
  }
}

$("year-prev").addEventListener("click", () => { year--; renderChart(); });
$("year-next").addEventListener("click", () => { year++; renderChart(); });

// tooltip for visit bars and event markers (hover + tap) —
// content is looked up by record id, so names/notes can contain anything
function tipHtml(ref) {
  const [kind, id] = ref.split(":");
  if (kind === "visit") {
    const v = visits.find((x) => String(x.id) === id);
    if (!v) return "";
    return `<strong>${esc(famName(v.family_id))}</strong>${esc(fmtRange(v.start_date, v.end_date))}${v.notes ? `<br><em>${esc(v.notes)}</em>` : ""}`;
  }
  const ev = events.find((x) => String(x.id) === id);
  if (!ev) return "";
  const n = interests.filter((i) => i.event_id === ev.id).length;
  const extra = [ev.description, n ? `${n} famil${n === 1 ? "y" : "ies"} interested` : ""].filter(Boolean).join(" · ");
  return `<strong>📌 ${esc(ev.title)}</strong>${esc(fmtDate(ev.event_date))} · by ${esc(famName(ev.family_id))}${extra ? `<br><em>${esc(extra)}</em>` : ""}`;
}

let tipEl = null;
function showTip(target, x, y) {
  const html = tipHtml(target.dataset.ref || "");
  hideTip();
  if (!html) return;
  tipEl = document.createElement("div");
  tipEl.className = "bar-tip";
  tipEl.innerHTML = html;
  document.body.appendChild(tipEl);
  const rect = tipEl.getBoundingClientRect();
  tipEl.style.left = Math.min(Math.max(8, x - rect.width / 2), window.innerWidth - rect.width - 8) + "px";
  tipEl.style.top = Math.max(8, y - rect.height - 12) + "px";
}
function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }

const hasTip = (el) => el.classList?.contains("visit-bar") || el.classList?.contains("event-marker");
document.addEventListener("mouseover", (e) => {
  if (hasTip(e.target)) {
    const r = e.target.getBoundingClientRect();
    showTip(e.target, r.left + r.width / 2, r.top);
  }
});
document.addEventListener("mouseout", (e) => {
  if (hasTip(e.target)) hideTip();
});
document.addEventListener("click", (e) => {
  if (hasTip(e.target)) {
    const r = e.target.getBoundingClientRect();
    showTip(e.target, r.left + r.width / 2, r.top);
  } else {
    hideTip();
  }
});

// ---------- render: family directory ----------
function renderFamilies() {
  const grid = $("families-grid");
  $("families-count").textContent =
    `${families.length} famil${families.length === 1 ? "y" : "ies"} and counting`;
  const today = todayStr();

  grid.innerHTML = families.map((fam) => {
    const next = visits
      .filter((v) => v.family_id === fam.id && v.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    let nextTxt = "No upcoming visits yet";
    if (next) {
      nextTxt = next.start_date <= today
        ? `🏡 In Gratteri now, until ${fmtDate(next.end_date)}`
        : `🧳 Next visit: ${fmtRange(next.start_date, next.end_date)}`;
    }
    return `<div class="family-card" style="border-top-color:${esc(fam.color)}">
      ${fam.photo_url ? `<img class="family-photo" src="${esc(fam.photo_url)}" alt="Photo of ${esc(fam.family_name)}" loading="lazy" data-lightbox="${esc(fam.photo_url)}" style="${coverStyle(fam.photo_focus_x, fam.photo_focus_y, fam.photo_w, fam.photo_h)}">` : ""}
      <h3>${esc(fam.family_name)}</h3>
      ${fam.home_town ? `<div class="home">📍 ${esc(fam.home_town)}</div>` : ""}
      ${fam.members ? `<div class="members">👨‍👩‍👧‍👦 ${esc(fam.members)}</div>` : ""}
      ${fam.bio ? `<div class="bio">${linkify(fam.bio)}</div>` : ""}
      <div class="next-visit">${esc(nextTxt)}</div>
      ${computeBadges(fam.id).length ? `<div class="card-badges">${badgeChips(fam.id, false)}</div>` : ""}
    </div>`;
  }).join("") || `<p class="muted">No families yet.</p>`;
}

// ---------- render: events ----------
function renderEvents() {
  const list = $("events-list");
  const today = todayStr();
  const upcoming = events.filter((ev) => ev.event_date >= today);
  const past = events.filter((ev) => ev.event_date < today).reverse();

  const card = (ev, isPast) => {
    const who = interests
      .filter((i) => i.event_id === ev.id)
      .map((i) => famById(i.family_id))
      .filter(Boolean);
    const iAmInterested = myFamily && who.some((f) => f.id === myFamily.id);
    const isHost = myFamily && ev.family_id === myFamily.id;
    const [y, m, d] = ev.event_date.split("-").map(Number);
    return `<div class="event-card ${isPast ? "past" : ""}" style="border-left-color:${esc(famColor(ev.family_id))}">
      <div class="event-date-badge"><span>${d}</span><small>${MONTHS[m - 1]} ${y}</small></div>
      <div class="event-body">
        <h3>${esc(ev.title)}</h3>
        <div class="muted">by ${esc(famName(ev.family_id))}</div>
        ${ev.description ? `<p>${linkify(ev.description)}</p>` : ""}
        <div class="event-interest">
          ${who.length
            ? `<span class="muted">Interested (${who.length}): ${esc(who.map((f) => f.family_name).join(", "))}</span>`
            : `<span class="muted">No one has said they're interested yet</span>`}
        </div>
      </div>
      <div class="event-actions">
        ${isPast ? "" : `<button class="btn ${iAmInterested ? "btn-ghost" : "btn-primary"}" data-interest-event="${ev.id}" data-interested="${iAmInterested}" type="button">
          ${iAmInterested ? "✓ Interested — undo" : "I'm interested!"}</button>`}
        ${isPast ? "" : `<a class="btn btn-ghost event-share" target="_blank" rel="noopener"
          href="https://wa.me/?text=${encodeURIComponent(`📌 ${ev.title} — ${fmtDate(ev.event_date)} in Gratteri${ev.description ? "\n" + ev.description : ""}\nDetails: ${SITE_URL}`)}">Share 💬</a>`}
        ${isPast ? "" : `<button class="btn btn-ghost" data-ics-event="${ev.id}" type="button">Add to calendar 📆</button>`}
        ${isHost ? `<button class="btn-danger-link" data-event-id="${ev.id}" type="button">Remove event</button>` : ""}
      </div>
      <div class="event-comments">
        ${eventComments.filter((c) => c.event_id === ev.id).map((c) => {
          const cMine = myFamily && c.family_id === myFamily.id;
          return `<div class="event-comment">
            <span class="dot" style="background:${esc(famColor(c.family_id))}"></span>
            <strong>${esc(famName(c.family_id))}</strong>
            <span>${linkify(c.body)}</span>
            ${cMine ? `<button class="btn-danger-link" data-comment-id="${c.id}" type="button">×</button>` : ""}
          </div>`;
        }).join("")}
        <form class="event-comment-form" data-comment-event="${ev.id}" data-key="cmt-${ev.id}">
          <input type="text" maxlength="1000" placeholder="Add a comment — 'we'll bring wine!'" required>
          <button type="submit" class="btn btn-ghost">Post</button>
        </form>
      </div>
    </div>`;
  };

  withInputsPreserved(list, () => {
    list.innerHTML =
      (upcoming.length ? `<h3 class="events-subhead">Coming up</h3>` + upcoming.map((e) => card(e, false)).join("") : "") +
      (past.length ? `<h3 class="events-subhead">Past events</h3>` + past.map((e) => card(e, true)).join("") : "") ||
      `<p class="muted" style="text-align:center">No events yet — add the first one above! Festa, dinner, beach day…</p>`;
  });
}

function downloadIcs(ev) {
  const d = ev.event_date.replace(/-/g, "");
  const [y, m, day] = ev.event_date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, day + 1));
  const dEnd = `${next.getUTCFullYear()}${String(next.getUTCMonth() + 1).padStart(2, "0")}${String(next.getUTCDate()).padStart(2, "0")}`;
  const escIcs = (s) => String(s || "").replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Gratteri Ambassadors//EN",
    "BEGIN:VEVENT",
    `UID:${ev.id}@gratteri-ambassadors`,
    `DTSTART;VALUE=DATE:${d}`,
    `DTEND;VALUE=DATE:${dEnd}`,
    `SUMMARY:${escIcs(ev.title)} (Gratteri)`,
    `DESCRIPTION:${escIcs(ev.description || "")}`,
    "LOCATION:Gratteri\\, Sicily",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = `gratteri-${ev.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- render: village guide ----------
function renderGuide() {
  const counts = {};
  places.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
  $("guide-filters").innerHTML =
    `<button class="filter-chip ${guideFilter === "all" ? "active" : ""}" data-filter="all" type="button">All (${places.length})</button>` +
    Object.entries(CATEGORIES).map(([key, c]) =>
      `<button class="filter-chip ${guideFilter === key ? "active" : ""}" data-filter="${key}" type="button">${c.emoji} ${c.label}${counts[key] ? ` (${counts[key]})` : ""}</button>`
    ).join("");

  const shown = places
    .filter((p) => guideFilter === "all" || p.category === guideFilter)
    .map((p) => ({ p, hearts: placeHearts.filter((h) => h.place_id === p.id) }))
    .sort((a, b) => b.hearts.length - a.hearts.length || a.p.name.localeCompare(b.p.name));

  const listEl = $("places-list");
  withInputsPreserved(listEl, () => {
    listEl.innerHTML = shown.map(({ p, hearts }) => {
      const cat = CATEGORIES[p.category] || CATEGORIES.other;
      const by = famById(p.family_id);
      const mine = myFamily && p.family_id === myFamily.id;
      const iHeart = myFamily && hearts.some((h) => h.family_id === myFamily.id);
      const tips = placeTips.filter((t) => t.place_id === p.id);
      return `<div class="place-card">
        <div class="place-head">
          <span class="place-emoji">${cat.emoji}</span>
          <div class="place-title">
            <h3>${esc(p.name)}</h3>
            <span class="muted">${esc(cat.label)}${by ? ` · added by ${esc(by.family_name)}` : ""}</span>
          </div>
          <button class="heart-btn ${iHeart ? "hearted" : ""}" data-heart-place="${p.id}" data-hearted="${iHeart}" type="button"
            title="${iHeart ? "We rate this — click to undo" : "We rate this!"}">❤️ ${hearts.length}</button>
        </div>
        ${p.description ? `<p class="place-desc">${linkify(p.description)}</p>` : ""}
        <div class="place-links">
          ${p.maps_url && /^https?:\/\//i.test(p.maps_url) ? `<a href="${esc(p.maps_url)}" target="_blank" rel="noopener">📍 Map</a>` : ""}
          ${p.phone ? `<a href="tel:${esc(p.phone)}">📞 ${esc(p.phone)}</a>` : ""}
          ${mine ? `<button class="btn-danger-link" data-place-id="${p.id}" type="button">Remove</button>` : ""}
        </div>
        <div class="place-tips">
          ${tips.map((t) => {
            const tMine = myFamily && t.family_id === myFamily.id;
            return `<div class="place-tip">
              <span class="dot" style="background:${esc(famColor(t.family_id))}"></span>
              <span><strong>${esc(famName(t.family_id))}:</strong> ${linkify(t.body)}</span>
              ${tMine ? `<button class="btn-danger-link" data-tip-id="${t.id}" type="button">×</button>` : ""}
            </div>`;
          }).join("")}
          <form class="tip-form" data-tip-place="${p.id}" data-key="tip-${p.id}">
            <input type="text" maxlength="1000" placeholder="Add your tip…" required>
            <button type="submit" class="btn btn-ghost">Add tip</button>
          </form>
        </div>
      </div>`;
    }).join("") || `<p class="muted" style="text-align:center">No places ${guideFilter === "all" ? "in the guide yet — add the first one above! Where's the best granita?" : "in this category yet."}</p>`;
  });
}

// ---------- render: photo wall ----------
function renderGallery() {
  $("gallery-grid").innerHTML = galleryPhotos.map((ph) => {
    const mine = myFamily && ph.family_id === myFamily.id;
    const { data: pub } = db.storage.from("gallery").getPublicUrl(ph.path);
    return `<figure class="gallery-item">
      <img src="${esc(pub.publicUrl)}" alt="${esc(ph.caption || "Photo shared by " + famName(ph.family_id))}" loading="lazy" data-lightbox="${esc(pub.publicUrl)}" style="${coverStyle(ph.focus_x, ph.focus_y, ph.w, ph.h)}">
      <figcaption>
        ${ph.caption ? `<span>${esc(ph.caption)}</span>` : ""}
        <span class="muted">— ${esc(famName(ph.family_id))}</span>
        ${mine ? `<button class="btn-ghost btn-tiny" data-refocus-gallery="${ph.id}" data-refocus-url="${esc(pub.publicUrl)}" data-refocus-w="${ph.w || ""}" data-refocus-h="${ph.h || ""}" data-refocus-fx="${ph.focus_x ?? 50}" data-refocus-fy="${ph.focus_y ?? 35}" type="button">Reframe</button>
        <button class="btn-danger-link" data-gallery-id="${ph.id}" data-gallery-path="${esc(ph.path)}" type="button">Remove</button>` : ""}
      </figcaption>
    </figure>`;
  }).join("") || `<p class="muted" style="text-align:center">No photos yet — share the first sunset! 🌅</p>`;
}

// ---------- render: noticeboard ----------
function renderBoard() {
  $("board-list").innerHTML = messages.map((m) => {
    const mine = myFamily && m.family_id === myFamily.id;
    return `<div class="board-item">
      <div class="board-item-head">
        <span class="dot" style="background:${esc(famColor(m.family_id))}"></span>
        <strong>${esc(famName(m.family_id))}</strong>
        <span class="muted">${esc(fmtWhen(m.created_at))}</span>
        ${mine ? `<button class="btn-danger-link" data-message-id="${m.id}" type="button">Remove</button>` : ""}
      </div>
      <p>${linkify(m.body)}</p>
    </div>`;
  }).join("") || `<p class="muted" style="text-align:center">Nothing on the board yet — be the first to post!</p>`;
}

// ---------- photos: cropping helpers ----------
// Every cropped rendering (cards, avatar, thumbnails) uses the stored focal
// point so the subject is always in frame and centred, plus the known aspect
// ratio so images never cause layout shift as they load.
function coverStyle(fx, fy, w, h) {
  const pos = `object-position:${fx ?? 50}% ${fy ?? 35}%`;
  return h ? `${pos};aspect-ratio:${w}/${h}` : pos;
}

// ---------- photos: shared upload path ----------
async function decodeToCanvas(file, maxDim) {
  const draw = (w, h, src) => {
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext("2d").drawImage(src, 0, 0, cw, ch);
    return new Promise((res) => canvas.toBlob((b) => res(b && { blob: b, w: cw, h: ch }), "image/jpeg", 0.85));
  };
  try {
    // imageOrientation:from-image bakes in EXIF rotation, so phone photos
    // taken sideways don't upload rotated
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return await draw(bmp.width, bmp.height, bmp);
  } catch { /* fall through to <img> decoding, which applies orientation itself */ }
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const out = await draw(img.naturalWidth, img.naturalHeight, img);
    URL.revokeObjectURL(url);
    return out;
  } catch {
    return null; // browser genuinely can't read this format
  }
}

async function uploadPhoto(bucket, file, msgEl, { maxMB, maxDim, upsert = false, name }) {
  if (file.size > 30 * 1024 * 1024) {
    setMsg(msgEl, "That file is enormous (over 30 MB) — please pick a photo rather than a video or RAW file.", "error");
    return null;
  }
  setMsg(msgEl, "Preparing photo…");
  // downscale FIRST — a big phone photo becomes small, so it should never
  // be rejected for the size it had before shrinking
  const scaled = await decodeToCanvas(file, maxDim);
  if (!scaled) {
    setMsg(msgEl, "Your browser can't read that photo format — please choose a JPEG or PNG (on iPhone: Settings → Camera → Formats → Most Compatible).", "error");
    return null;
  }
  if (scaled.blob.size > maxMB * 1024 * 1024) {
    setMsg(msgEl, `That photo is still over ${maxMB} MB after shrinking — please pick a smaller one.`, "error");
    return null;
  }
  setMsg(msgEl, "Uploading…");
  const path = `${session.user.id}/${name || crypto.randomUUID()}.jpg`;
  const { error } = await db.storage.from(bucket).upload(path, scaled.blob, { upsert, contentType: "image/jpeg" });
  if (error) { setMsg(msgEl, error.message, "error"); return null; }
  return { path, w: scaled.w, h: scaled.h };
}

$("pf-photo").addEventListener("change", async () => {
  const input = $("pf-photo");
  const file = input.files[0];
  const msg = $("photo-message");
  if (!file || !myFamily) return;
  input.disabled = true;
  try {
    const up = await uploadPhoto("family-photos", file, msg, { maxMB: 5, maxDim: 1200, upsert: true, name: "photo" });
    if (!up) return;
    const { data: pub } = db.storage.from("family-photos").getPublicUrl(up.path);
    const url = `${pub.publicUrl}?v=${Date.now()}`;
    const { error } = await db.from("families").update({
      photo_url: url, photo_w: up.w, photo_h: up.h, photo_focus_x: 50, photo_focus_y: 35,
    }).eq("id", myFamily.id);
    if (error) { setMsg(msg, error.message, "error"); return; }
    setMsg(msg, "Photo updated ✓", "ok");
    setTimeout(() => setMsg(msg, ""), 2500);
    await safeRefresh();
    pickFocus(url, up.w, up.h, 50, 35, async (fx, fy) => {
      await db.from("families").update({ photo_focus_x: fx, photo_focus_y: fy }).eq("id", myFamily.id);
      await safeRefresh();
    });
  } finally {
    input.disabled = false;
    input.value = "";
  }
});

$("gallery-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("gallery-message");
  const file = $("gf-photo").files[0];
  const btn = e.target.querySelector('button[type="submit"]');
  if (!file || !myFamily) return;
  btn.disabled = true;
  try {
    const up = await uploadPhoto("gallery", file, msg, { maxMB: 10, maxDim: 1600 });
    if (!up) return;
    const { data: row, error } = await db.from("gallery_photos").insert({
      family_id: myFamily.id, path: up.path, caption: $("gf-caption").value.trim() || null, w: up.w, h: up.h,
    }).select().single();
    if (error) { setMsg(msg, error.message, "error"); return; }
    setMsg(msg, "");
    $("gallery-form").reset();
    toast("Photo shared 🌅");
    await safeRefresh();
    const { data: pub } = db.storage.from("gallery").getPublicUrl(up.path);
    pickFocus(pub.publicUrl, up.w, up.h, 50, 35, async (fx, fy) => {
      await db.from("gallery_photos").update({ focus_x: fx, focus_y: fy }).eq("id", row.id);
      await safeRefresh();
    });
  } finally {
    btn.disabled = false;
  }
});

// ---------- focal-point picker ----------
function pickFocus(imgUrl, w, h, fx, fy, onSave) {
  const modal = $("focus-modal");
  const img = $("focus-img");
  const dot = $("focus-dot");
  const stage = $("focus-stage");
  let x = fx, y = fy;
  img.src = imgUrl;
  if (w && h) stage.style.aspectRatio = `${w}/${h}`;
  const place = () => { dot.style.left = x + "%"; dot.style.top = y + "%"; };
  place();
  modal.classList.remove("hidden");

  const setFromEvent = (ev) => {
    const r = stage.getBoundingClientRect();
    const pt = ev.touches ? ev.touches[0] : ev;
    x = Math.round(Math.min(100, Math.max(0, ((pt.clientX - r.left) / r.width) * 100)));
    y = Math.round(Math.min(100, Math.max(0, ((pt.clientY - r.top) / r.height) * 100)));
    place();
  };
  stage.onclick = setFromEvent;
  stage.ontouchstart = (ev) => { ev.preventDefault(); setFromEvent(ev); };

  const close = () => {
    modal.classList.add("hidden");
    stage.onclick = stage.ontouchstart = null;
    $("focus-save").onclick = $("focus-skip").onclick = null;
  };
  $("focus-save").onclick = async () => { close(); await onSave(x, y); toast("Framing saved ✓"); };
  $("focus-skip").onclick = close;
}

// ---------- lightbox ----------
function openLightbox(url, alt) {
  $("lightbox-img").src = url;
  $("lightbox-img").alt = alt || "";
  $("lightbox").classList.remove("hidden");
}
$("lightbox").addEventListener("click", () => $("lightbox").classList.add("hidden"));
$("lightbox-img").addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("lightbox").classList.add("hidden"); });

// ---------- delegated actions ----------
// One listener handles every list-item button, so re-rendered cards never
// lose their wiring. Markup carries data-<action>="<id>".
const DELETE_ACTIONS = {
  visitId: { table: "visits", confirm: "Remove this visit from the calendar?", done: "Visit removed" },
  eventId: { table: "events", confirm: "Remove this event for everyone?", done: "Event removed" },
  messageId: { table: "messages", confirm: "Remove this note?", done: "Note removed" },
  placeId: { table: "places", confirm: "Remove this place (and its tips) from the guide?", done: "Place removed" },
  tipId: { table: "place_tips", confirm: "Remove this tip?", done: "Tip removed" },
  commentId: { table: "event_comments", confirm: "Remove this comment?", done: "Comment removed" },
};

async function toggleMembership(table, keyCol, id, isOn) {
  if (!myFamily) return;
  const { error } = isOn
    ? await db.from(table).delete().eq(keyCol, id).eq("family_id", myFamily.id)
    : await db.from(table).insert({ [keyCol]: id, family_id: myFamily.id });
  if (error) { toast(error.message); return; }
  await safeRefresh();
}

document.addEventListener("click", async (e) => {
  // photos: open in the in-app lightbox instead of navigating to a raw URL
  if (e.target.dataset && e.target.dataset.lightbox) {
    openLightbox(e.target.dataset.lightbox, e.target.alt);
    return;
  }

  const btn = e.target.closest("button");
  if (!btn) return;

  // reframe an existing photo (re-open the focal picker)
  if ("refocusFamily" in btn.dataset) {
    const d = btn.dataset;
    pickFocus(d.refocusUrl, +d.refocusW || null, +d.refocusH || null, +d.refocusFx, +d.refocusFy, async (fx, fy) => {
      await db.from("families").update({ photo_focus_x: fx, photo_focus_y: fy }).eq("id", myFamily.id);
      await safeRefresh();
    });
    return;
  }
  if (btn.dataset.refocusGallery) {
    const d = btn.dataset;
    pickFocus(d.refocusUrl, +d.refocusW || null, +d.refocusH || null, +d.refocusFx, +d.refocusFy, async (fx, fy) => {
      await db.from("gallery_photos").update({ focus_x: fx, focus_y: fy }).eq("id", d.refocusGallery);
      await safeRefresh();
    });
    return;
  }
  if (btn.id === "pf-remove-photo") {
    if (!confirm("Remove your family photo?")) return;
    await db.storage.from("family-photos").remove([`${session.user.id}/photo.jpg`]).catch(() => {});
    const { error } = await db.from("families").update({ photo_url: null, photo_w: null, photo_h: null }).eq("id", myFamily.id);
    if (error) { toast(error.message); return; }
    toast("Photo removed");
    await safeRefresh();
    return;
  }

  for (const [key, cfg] of Object.entries(DELETE_ACTIONS)) {
    if (btn.dataset[key]) {
      if (!confirm(cfg.confirm)) return;
      const { error } = await db.from(cfg.table).delete().eq("id", btn.dataset[key]);
      if (error) { toast(error.message); return; }
      toast(cfg.done);
      await safeRefresh();
      return;
    }
  }

  if (btn.dataset.galleryId) {
    if (!confirm("Remove this photo?")) return;
    const { error } = await db.from("gallery_photos").delete().eq("id", btn.dataset.galleryId);
    if (error) { toast(error.message); return; }
    // best-effort: the row is gone either way, an orphaned file is invisible
    db.storage.from("gallery").remove([btn.dataset.galleryPath]).catch(() => {});
    toast("Photo removed");
    await safeRefresh();
    return;
  }

  if ("checkinOpen" in btn.dataset) { checkinFormOpen = true; renderCheckin(); return; }
  if ("checkinCancel" in btn.dataset) { checkinFormOpen = false; renderCheckin(); return; }
  if ("checkinConfirm" in btn.dataset) {
    if (!myFamily) return;
    const until = $("checkin-until").value;
    const msg = $("checkin-message");
    if (!until) { setMsg(msg, "Pick your leave date first!", "error"); return; }
    if (until < todayStr()) { setMsg(msg, "Your leave date is in the past.", "error"); return; }
    const { error } = await db.from("visits").insert({
      family_id: myFamily.id, start_date: todayStr(), end_date: until, notes: "Checked in 📍",
    });
    if (error) { setMsg(msg, error.message, "error"); return; }
    checkinFormOpen = false;
    toast("Checked in — benvenuti! 🏡");
    await safeRefresh();
    return;
  }
  if (btn.dataset.checkoutVisit) {
    if (!confirm("Set your leave date to today?")) return;
    const { error } = await db.from("visits")
      .update({ end_date: todayStr() }).eq("id", btn.dataset.checkoutVisit);
    if (error) { toast(error.message); return; }
    toast("Leave date set to today — safe travels! 👋");
    await safeRefresh();
    return;
  }

  if (btn.dataset.interestEvent) {
    return toggleMembership("event_interest", "event_id", btn.dataset.interestEvent, btn.dataset.interested === "true");
  }
  if (btn.dataset.heartPlace) {
    return toggleMembership("place_hearts", "place_id", btn.dataset.heartPlace, btn.dataset.hearted === "true");
  }
  if (btn.dataset.icsEvent) {
    const ev = events.find((x) => String(x.id) === btn.dataset.icsEvent);
    if (ev) downloadIcs(ev);
    return;
  }
  if (btn.dataset.filter) {
    guideFilter = btn.dataset.filter;
    renderGuide();
    return;
  }
  if (btn.id === "btn-unwrapped") { renderUnwrapped(); return; }
  if (btn.id === "unwrapped-close") { $("unwrapped").classList.add("hidden"); return; }
  if (btn.dataset.guidemode) {
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
    $("guide-ambassadors").classList.toggle("hidden", btn.dataset.guidemode !== "tips");
    $("guide-explore").classList.toggle("hidden", btn.dataset.guidemode !== "explore");
    return;
  }
  if (btn.dataset.explorefilter) {
    exploreFilter = btn.dataset.explorefilter;
    renderExplore();
    return;
  }
  if (btn.dataset.vote && btn.dataset.guide) {
    await voteGuide(btn.dataset.guide, +btn.dataset.vote);
  }
});

// ---------- render: AI tour guide ----------
function renderExplore() {
  const data = window.EXPLORE_DATA || [];
  const counts = {};
  data.forEach((e) => { counts[e.category] = (counts[e.category] || 0) + 1; });

  $("explore-filters").innerHTML =
    `<button class="filter-chip ${exploreFilter === "all" ? "active" : ""}" data-explorefilter="all" type="button">All (${data.length})</button>` +
    Object.entries(EXPLORE_CATS).map(([key, c]) =>
      `<button class="filter-chip ${exploreFilter === key ? "active" : ""}" data-explorefilter="${key}" type="button">${c.emoji} ${c.label}${counts[key] ? ` (${counts[key]})` : ""}</button>`
    ).join("");

  // attach votes, then sort each view by net score (ambassador favourites rise)
  const withVotes = data.map((e) => {
    const id = guideId(e.name);
    const vs = guideVotes.filter((v) => v.guide_id === id);
    const up = vs.filter((v) => v.vote === 1).length;
    const down = vs.filter((v) => v.vote === -1).length;
    const mine = myFamily && vs.find((v) => v.family_id === myFamily.id);
    return { e, id, up, down, score: up - down, myVote: mine ? mine.vote : 0 };
  });

  const shown = withVotes
    .filter((x) => exploreFilter === "all" || x.e.category === exploreFilter)
    .sort((a, b) => b.score - a.score);

  $("explore-list").innerHTML = shown.map(({ e, id, up, down, myVote }) => `
    <div class="explore-card">
      <div class="place-head">
        <span class="place-emoji">${e.emoji}</span>
        <div class="place-title">
          <h3>${esc(e.name)}</h3>
          <div class="explore-chips">
            <span class="chip">📍 ${esc(e.distance)}</span>
            ${e.effort ? `<span class="chip">${e.effort === "easy" ? "🟢" : e.effort === "moderate" ? "🟡" : "🔴"} ${esc(e.effort)}</span>` : ""}
            ${e.season ? `<span class="chip">🗓 ${esc(e.season)}</span>` : ""}
          </div>
        </div>
      </div>
      <p class="place-desc"><strong>${esc(e.blurb)}</strong></p>
      ${e.details ? `<details class="explore-more">
        <summary>The full brief</summary>
        <p>${esc(e.details)}</p>
      </details>` : ""}
      <div class="place-links">
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.maps_query)}" target="_blank" rel="noopener">📍 Maps</a>
        ${(e.sources || []).length ? `<a href="${esc(e.sources[0])}" target="_blank" rel="noopener">ℹ️ Info</a>` : ""}
        <span class="vote-group">
          <button class="vote-btn ${myVote === 1 ? "voted-up" : ""}" data-vote="1" data-guide="${id}" type="button" aria-label="Recommend">👍 ${up}</button>
          <button class="vote-btn ${myVote === -1 ? "voted-down" : ""}" data-vote="-1" data-guide="${id}" type="button" aria-label="Not worth it">👎 ${down}</button>
        </span>
      </div>
    </div>`).join("") || `<p class="muted" style="text-align:center">Nothing in this category yet.</p>`;
}

async function voteGuide(guide, vote) {
  if (!myFamily) return;
  const existing = guideVotes.find((v) => v.guide_id === guide && v.family_id === myFamily.id);
  let error;
  if (existing && existing.vote === vote) {
    ({ error } = await db.from("guide_votes").delete().eq("guide_id", guide).eq("family_id", myFamily.id));
  } else {
    ({ error } = await db.from("guide_votes")
      .upsert({ guide_id: guide, family_id: myFamily.id, vote }, { onConflict: "guide_id,family_id" }));
  }
  if (error) { toast(error.message); return; }
  await safeRefresh();
}

document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!form.dataset.commentEvent && !form.dataset.tipPlace) return;
  e.preventDefault();
  if (!myFamily) return;
  const input = form.querySelector("input");
  const body = input.value.trim();
  if (!body) return;
  const { table, row } = form.dataset.commentEvent
    ? { table: "event_comments", row: { event_id: form.dataset.commentEvent, family_id: myFamily.id, body } }
    : { table: "place_tips", row: { place_id: form.dataset.tipPlace, family_id: myFamily.id, body } };
  const { error } = await db.from(table).insert(row);
  if (error) { toast(error.message); return; }
  input.value = "";
  await safeRefresh();
});

// ---------- simple insert forms ----------
function handleInsertForm(formId, msgId, table, buildRow, successToast, validate) {
  $(formId).addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $(msgId);
    if (!myFamily) { setMsg(msg, "Your profile hasn't loaded yet — try again in a moment.", "error"); return; }
    if (validate) {
      const problem = validate();
      if (problem) { setMsg(msg, problem, "error"); return; }
    }
    const { error } = await db.from(table).insert(buildRow());
    if (error) { setMsg(msg, error.message, "error"); return; }
    setMsg(msg, "");
    $(formId).reset();
    if (successToast) toast(successToast);
    await safeRefresh();
  });
}

handleInsertForm("visit-form", "visit-message", "visits",
  () => ({
    family_id: myFamily.id,
    start_date: $("vf-start").value,
    end_date: $("vf-end").value,
    notes: $("vf-notes").value.trim() || null,
    hosting_guests: $("vf-guests").checked,
  }),
  "Visit added to the calendar 🎉",
  () => $("vf-end").value < $("vf-start").value ? "The end date is before the start date." : null);

handleInsertForm("event-form", "event-message", "events",
  () => ({
    family_id: myFamily.id,
    title: $("ef-title").value.trim(),
    event_date: $("ef-date").value,
    description: $("ef-desc").value.trim() || null,
  }),
  "Event added 📌");

handleInsertForm("place-form", "place-message", "places",
  () => ({
    family_id: myFamily.id,
    name: $("plf-name").value.trim(),
    category: $("plf-category").value,
    description: $("plf-desc").value.trim() || null,
    maps_url: $("plf-maps").value.trim() || null,
    phone: $("plf-phone").value.trim() || null,
  }),
  "Added to the guide 🌿");

handleInsertForm("board-form", "board-message", "messages",
  () => ({ family_id: myFamily.id, body: $("board-body").value.trim() }),
  null,
  () => $("board-body").value.trim() ? null : "Write something first.");

// ---------- render: my profile ----------
function renderProfileForm() {
  if (!myFamily || profileDirty) return; // never clobber unsaved edits
  $("pf-name").value = myFamily.family_name || "";
  $("pf-members").value = myFamily.members || "";
  $("pf-hometown").value = myFamily.home_town || "";
  $("pf-bio").value = myFamily.bio || "";
  selectedColor = myFamily.color || PALETTE[0];

  const preview = $("pf-photo-preview");
  if (myFamily.photo_url) {
    preview.classList.remove("hidden");
    preview.innerHTML =
      `<img src="${esc(myFamily.photo_url)}" alt="Your family photo" data-lightbox="${esc(myFamily.photo_url)}" style="object-position:${myFamily.photo_focus_x ?? 50}% ${myFamily.photo_focus_y ?? 35}%">
       <div class="preview-actions">
         <button class="btn btn-ghost btn-tiny" data-refocus-family data-refocus-url="${esc(myFamily.photo_url)}" data-refocus-w="${myFamily.photo_w || ""}" data-refocus-h="${myFamily.photo_h || ""}" data-refocus-fx="${myFamily.photo_focus_x ?? 50}" data-refocus-fy="${myFamily.photo_focus_y ?? 35}" type="button">Reframe</button>
         <button class="btn-danger-link" id="pf-remove-photo" type="button">Remove photo</button>
       </div>`;
  } else {
    preview.classList.add("hidden");
    preview.innerHTML = "";
  }

  $("pf-colors").innerHTML = PALETTE.map((c) =>
    `<button type="button" class="swatch ${c === selectedColor ? "selected" : ""}" style="background:${c}" data-color="${c}" aria-label="Choose colour ${c}"></button>`
  ).join("");
  $("pf-colors").querySelectorAll(".swatch").forEach((b) => {
    b.addEventListener("click", () => {
      selectedColor = b.dataset.color;
      profileDirty = true;
      $("pf-colors").querySelectorAll(".swatch").forEach((s) => s.classList.toggle("selected", s === b));
    });
  });
}

$("profile-form").addEventListener("input", (e) => {
  if (e.target.id !== "pf-photo") profileDirty = true;
});

$("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("profile-message");
  const name = $("pf-name").value.trim();
  if (!name) { setMsg(msg, "Please give your family or household a name.", "error"); return; }
  const { error } = await db.from("families").update({
    family_name: name,
    members: $("pf-members").value.trim() || null,
    home_town: $("pf-hometown").value.trim() || null,
    bio: $("pf-bio").value.trim() || null,
    color: selectedColor,
  }).eq("id", myFamily.id);
  if (error) { setMsg(msg, error.message, "error"); return; }
  profileDirty = false;
  setMsg(msg, "Saved! ✓", "ok");
  setTimeout(() => setMsg(msg, ""), 2500);
  await safeRefresh();
});

// ---------- render: my visits ----------
function renderMyVisits() {
  if (!myFamily) return;
  const today = todayStr();
  const mine = visits
    .filter((v) => v.family_id === myFamily.id)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  $("my-visits").innerHTML = mine.map((v) => `
    <li class="${v.end_date < today ? "past" : ""}">
      <span class="dates">${esc(fmtRange(v.start_date, v.end_date))}</span>
      <span class="note">${v.hosting_guests ? "👥 " : ""}${esc(v.notes || "")}</span>
      <button class="btn-danger-link" data-visit-id="${v.id}" type="button">Remove</button>
    </li>`).join("") || `<li class="muted" style="border:none">No visits yet — add your first one above!</li>`;
}

// ============================================================
//  Guest mode — a login-free visitor guide (?guest=1)
//  Shows the static tour guide, the festa programme, and who's
//  in town RIGHT NOW. No auth, no forward travel schedule.
// ============================================================
async function guestBoot() {
  $("guest-screen").classList.remove("hidden");
  renderGuestGuide();

  // guest nav — swap between the three sections
  document.querySelectorAll(".gnav").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.guestview;
      document.querySelectorAll(".gnav").forEach((b) => b.classList.toggle("active", b === btn));
      $("gview-guide").classList.toggle("hidden", view !== "guide");
      $("gview-whatson").classList.toggle("hidden", view !== "whatson");
      $("gview-here").classList.toggle("hidden", view !== "here");
      document.querySelector("#guest-screen .main")?.scrollTo({ top: 0 });
    });
  });

  // guide filter chips (own state, no vote buttons)
  $("gguide-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-explorefilter]");
    if (!btn) return;
    guestFilter = btn.dataset.explorefilter;
    renderGuestGuide();
  });

  // fetch the two live slices in parallel (anon role, narrow reads)
  await Promise.all([renderGuestWhatson(), renderGuestHere()]);
}

function renderGuestGuide() {
  const data = window.EXPLORE_DATA || [];
  const counts = {};
  data.forEach((e) => { counts[e.category] = (counts[e.category] || 0) + 1; });

  $("gguide-filters").innerHTML =
    `<button class="filter-chip ${guestFilter === "all" ? "active" : ""}" data-explorefilter="all" type="button">All (${data.length})</button>` +
    Object.entries(EXPLORE_CATS).map(([key, c]) =>
      `<button class="filter-chip ${guestFilter === key ? "active" : ""}" data-explorefilter="${key}" type="button">${c.emoji} ${c.label}${counts[key] ? ` (${counts[key]})` : ""}</button>`
    ).join("");

  const shown = data.filter((e) => guestFilter === "all" || e.category === guestFilter);

  $("gguide-list").innerHTML = shown.map((e) => `
    <div class="explore-card">
      <div class="place-head">
        <span class="place-emoji">${e.emoji}</span>
        <div class="place-title">
          <h3>${esc(e.name)}</h3>
          <div class="explore-chips">
            <span class="chip">📍 ${esc(e.distance)}</span>
            ${e.effort ? `<span class="chip">${e.effort === "easy" ? "🟢" : e.effort === "moderate" ? "🟡" : "🔴"} ${esc(e.effort)}</span>` : ""}
            ${e.season ? `<span class="chip">🗓 ${esc(e.season)}</span>` : ""}
          </div>
        </div>
      </div>
      <p class="place-desc"><strong>${esc(e.blurb)}</strong></p>
      ${e.details ? `<details class="explore-more">
        <summary>The full brief</summary>
        <p>${esc(e.details)}</p>
      </details>` : ""}
      <div class="place-links">
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.maps_query)}" target="_blank" rel="noopener">📍 Maps</a>
        ${(e.sources || []).length ? `<a href="${esc(e.sources[0])}" target="_blank" rel="noopener">ℹ️ Info</a>` : ""}
      </div>
    </div>`).join("") || `<p class="muted" style="text-align:center">Nothing in this category yet.</p>`;
}

async function renderGuestWhatson() {
  const list = $("gwhatson-list");
  const { data, error } = await db.from("events").select("*").order("event_date");
  if (error) { list.innerHTML = `<p class="muted" style="text-align:center">Couldn't load the programme just now.</p>`; return; }
  const today = todayStr();
  const upcoming = (data || []).filter((ev) => ev.event_date >= today);
  if (!upcoming.length) {
    list.innerHTML = `<p class="muted" style="text-align:center">No upcoming events listed right now — check back soon.</p>`;
    return;
  }
  // anon can't read families, so no host names — just the programme itself
  list.innerHTML = upcoming.map((ev) => {
    const [y, m, d] = ev.event_date.split("-").map(Number);
    return `<div class="event-card">
      <div class="event-date-badge"><span>${d}</span><small>${MONTHS[m - 1]} ${y}</small></div>
      <div class="event-body">
        <h3>${esc(ev.title)}</h3>
        ${ev.description ? `<p>${linkify(ev.description)}</p>` : ""}
        <a class="btn btn-ghost event-share" target="_blank" rel="noopener"
          href="https://wa.me/?text=${encodeURIComponent(`📌 ${ev.title} — ${fmtDate(ev.event_date)} in Gratteri${ev.description ? "\n" + ev.description : ""}`)}">Share 💬</a>
      </div>
    </div>`;
  }).join("");
}

async function renderGuestHere() {
  const list = $("ghere-list");
  const { data, error } = await db.rpc("whos_in_town");
  if (error) { list.innerHTML = `<p class="muted" style="text-align:center">Couldn't load who's in town just now.</p>`; return; }
  const rows = data || [];
  if (!rows.length) {
    list.innerHTML = `<p class="muted" style="text-align:center">No ambassadors are in the village right now.</p>`;
    return;
  }
  list.innerHTML =
    `<p class="muted" style="text-align:center;margin-bottom:12px">${rows.length} ${rows.length === 1 ? "family is" : "families are"} in Gratteri now — say hello 👋</p>` +
    `<div class="here-list">` +
    rows.map((r) => `<span class="chip here-chip">
        <span class="dot" style="background:${esc(r.color || "#999")}"></span>
        ${esc(r.family_name)}${r.hosting_guests ? " 👥" : ""}
        <span class="muted">until ${esc(fmtDate(r.until_date))}</span>
      </span>`).join("") +
    `</div>`;
}

// ---------- boot ----------
$("plf-category").innerHTML = Object.entries(CATEGORIES).map(([key, c]) =>
  `<option value="${key}">${c.emoji} ${c.label}</option>`).join("");
renderExplore(); // static data — render once at load

if (isGuest) {
  guestBoot().catch((err) => toast("Couldn't load the guide: " + (err.message || err)));
} else (async () => {
  const { data } = await db.auth.getSession();
  const code = pendingInviteCode();
  if (!data.session) {
    $("auth-screen").classList.remove("hidden");
    if (code) {
      // pre-fill the signup form so the invitee never has to type a code
      setAuthMode("signup");
      $("auth-family-code").value = code;
      const banner = $("invite-banner");
      banner.classList.remove("hidden");
      banner.innerHTML = `🌿 You've been invited to join a family. <strong>Sign up</strong> below and you'll share their entry — or <button type="button" class="link-btn" id="invite-decline">start your own family instead</button>.`;
      $("invite-decline").addEventListener("click", () => {
        $("auth-family-code").value = "";
        banner.classList.add("hidden");
      });
    }
  }
  // onAuthStateChange fires with INITIAL_SESSION and handles the rest
})();
