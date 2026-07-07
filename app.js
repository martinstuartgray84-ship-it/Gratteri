/* ============================================================
   Gratteri Ambassadors — app logic
   A tiny community site: family profiles + a shared visit
   calendar backed by Supabase.
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
let myFamily = null;
let guideFilter = "all";

const CATEGORIES = {
  eat: { label: "Eat & drink", emoji: "🍝" },
  beach: { label: "Beaches & swimming", emoji: "🏖️" },
  walk: { label: "Walks & day trips", emoji: "🥾" },
  trade: { label: "Tradespeople & services", emoji: "🔧" },
  shop: { label: "Shops & markets", emoji: "🛒" },
  practical: { label: "Practical & emergencies", emoji: "🏥" },
  other: { label: "Other gems", emoji: "✨" },
};

const SITE_URL = "https://martinstuartgray84-ship-it.github.io/Gratteri/";
let year = new Date().getFullYear();
let selectedColor = PALETTE[0];

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

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
      if (!familyName) {
        setMsg(msg, "Please give your family or household a name.", "error");
        return;
      }
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: { data: { family_name: familyName } },
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
    setMsg(msg, err.message || "Something went wrong — please try again.", "error");
  } finally {
    $("auth-submit").disabled = false;
  }
});

$("btn-logout").addEventListener("click", () => db.auth.signOut());

db.auth.onAuthStateChange((_event, s) => {
  session = s;
  if (session) {
    enterApp();
  } else {
    $("app").classList.add("hidden");
    $("auth-screen").classList.remove("hidden");
  }
});

// ---------- data ----------
async function ensureMyFamily() {
  const { data: existing, error } = await db
    .from("families").select("*").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  if (existing) { myFamily = existing; return; }

  const name = session.user.user_metadata?.family_name || "New family";
  const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const { data: created, error: insErr } = await db
    .from("families")
    .insert({ user_id: session.user.id, family_name: name, color })
    .select().single();
  if (insErr) throw insErr;
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
  ]);
  for (const r of results) if (r.error) throw r.error;
  [families, visits, messages, events, interests, eventComments,
    places, placeTips, placeHearts, galleryPhotos] = results.map((r) => r.data);
  myFamily = families.find((f) => f.user_id === session.user.id) || myFamily;
}

async function enterApp() {
  $("auth-screen").classList.add("hidden");
  $("app").classList.remove("hidden");
  try {
    await ensureMyFamily();
    await loadData();
    renderAll();
  } catch (err) {
    toast("Could not load data: " + (err.message || err));
  }
}

async function refresh() {
  await loadData();
  renderAll();
}

// ---------- navigation ----------
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b === btn));
    ["calendar", "families", "events", "guide", "gallery", "board", "mine"].forEach((v) => {
      $("view-" + v).classList.toggle("hidden", v !== btn.dataset.view);
    });
    // quietly pick up anything other families added since the last load
    refresh().catch(() => {});
  });
});

// ---------- render: everything ----------
function renderAll() {
  renderInTown();
  renderOverlaps();
  renderChart();
  renderFamilies();
  renderEvents();
  renderGuide();
  renderGallery();
  renderBoard();
  renderProfileForm();
  renderMyVisits();
  $("footer-stats").textContent =
    `${families.length} famil${families.length === 1 ? "y" : "ies"} · ${visits.length} visit${visits.length === 1 ? "" : "s"} planned · ${events.length} event${events.length === 1 ? "" : "s"} · ${places.length} place${places.length === 1 ? "" : "s"} in the guide`;
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

  const famName = (id) => families.find((f) => f.id === id)?.family_name || "?";
  const famColor = (id) => families.find((f) => f.id === id)?.color || "#999";

  if (!now.length && !soon.length) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");

  let html = "";
  if (now.length) {
    html += `<div><strong>🏡 In Gratteri right now:</strong><div class="in-town-chips">` +
      now.map((v) => `<span class="chip"><span class="dot" style="background:${esc(famColor(v.family_id))}"></span>${esc(famName(v.family_id))} <span class="muted">until ${esc(fmtDate(v.end_date))}</span></span>`).join("") +
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

  // header row with month names
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

  // month gridlines (positions as % of year)
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
    const markers = yearEvents.map((ev) => {
      const host = families.find((f) => f.id === ev.family_id);
      const n = interests.filter((i) => i.event_id === ev.id).length;
      const extra = [ev.description, n ? `${n} famil${n === 1 ? "y" : "ies"} interested` : ""].filter(Boolean).join(" · ");
      return `<div class="event-marker" style="left:${(dayOfYear(ev.event_date) / days) * 100}%"
        data-tip="📌 ${esc(ev.title)}|${esc(fmtDate(ev.event_date))} · by ${esc(host?.family_name || "?")}|${esc(extra)}"></div>`;
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
      return `<div class="visit-bar" style="left:${left}%;width:${width}%;background:${esc(fam.color)}"
        data-tip="${esc(fam.family_name)}|${esc(fmtRange(v.start_date, v.end_date))}|${esc(v.notes || "")}"></div>`;
    }).join("");

    html += `<div class="chart-row">
      <div class="chart-name" title="${esc(fam.family_name)}"><span class="dot" style="background:${esc(fam.color)}"></span>${esc(fam.family_name)}</div>
      <div class="chart-timeline">${monthLines}${todayLine}${bars}</div>
    </div>`;
  }

  chart.innerHTML = html;
}

$("year-prev").addEventListener("click", () => { year--; renderChart(); });
$("year-next").addEventListener("click", () => { year++; renderChart(); });

// tooltip for visit bars (hover + tap)
let tipEl = null;
function showTip(target, x, y) {
  const [name, range, note] = target.dataset.tip.split("|");
  hideTip();
  tipEl = document.createElement("div");
  tipEl.className = "bar-tip";
  tipEl.innerHTML = `<strong>${esc(name)}</strong>${esc(range)}${note ? `<br><em>${esc(note)}</em>` : ""}`;
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

// ---------- render: events ----------
function renderEvents() {
  const list = $("events-list");
  const today = todayStr();
  const upcoming = events.filter((ev) => ev.event_date >= today);
  const past = events.filter((ev) => ev.event_date < today).reverse();

  const card = (ev, isPast) => {
    const host = families.find((f) => f.id === ev.family_id);
    const who = interests
      .filter((i) => i.event_id === ev.id)
      .map((i) => families.find((f) => f.id === i.family_id))
      .filter(Boolean);
    const iAmInterested = myFamily && who.some((f) => f.id === myFamily.id);
    const isHost = myFamily && ev.family_id === myFamily.id;
    const [y, m, d] = ev.event_date.split("-").map(Number);
    return `<div class="event-card ${isPast ? "past" : ""}" style="border-left-color:${esc(host?.color || "#999")}">
      <div class="event-date-badge"><span>${d}</span><small>${MONTHS[m - 1]} ${y}</small></div>
      <div class="event-body">
        <h3>${esc(ev.title)}</h3>
        <div class="muted">by ${esc(host?.family_name || "a former member")}</div>
        ${ev.description ? `<p>${esc(ev.description)}</p>` : ""}
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
          const cf = families.find((f) => f.id === c.family_id);
          const cMine = myFamily && c.family_id === myFamily.id;
          return `<div class="event-comment">
            <span class="dot" style="background:${esc(cf?.color || "#999")}"></span>
            <strong>${esc(cf?.family_name || "?")}</strong>
            <span>${esc(c.body)}</span>
            ${cMine ? `<button class="btn-danger-link" data-comment-id="${c.id}" type="button">×</button>` : ""}
          </div>`;
        }).join("")}
        <form class="event-comment-form" data-comment-event="${ev.id}">
          <input type="text" maxlength="1000" placeholder="Add a comment — 'we'll bring wine!'" required>
          <button type="submit" class="btn btn-ghost">Post</button>
        </form>
      </div>
    </div>`;
  };

  list.innerHTML =
    (upcoming.length ? `<h3 class="events-subhead">Coming up</h3>` + upcoming.map((e) => card(e, false)).join("") : "") +
    (past.length ? `<h3 class="events-subhead">Past events</h3>` + past.map((e) => card(e, true)).join("") : "") ||
    `<p class="muted" style="text-align:center">No events yet — add the first one above! Festa, dinner, beach day…</p>`;

  list.querySelectorAll("[data-interest-event]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const eventId = btn.dataset.interestEvent;
      const { error } = btn.dataset.interested === "true"
        ? await db.from("event_interest").delete().eq("event_id", eventId).eq("family_id", myFamily.id)
        : await db.from("event_interest").insert({ event_id: eventId, family_id: myFamily.id });
      if (error) { toast(error.message); return; }
      await refresh();
    });
  });

  list.querySelectorAll("[data-event-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this event for everyone?")) return;
      const { error } = await db.from("events").delete().eq("id", btn.dataset.eventId);
      if (error) { toast(error.message); return; }
      toast("Event removed");
      await refresh();
    });
  });

  list.querySelectorAll("[data-ics-event]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ev = events.find((e) => e.id === btn.dataset.icsEvent);
      if (ev) downloadIcs(ev);
    });
  });

  list.querySelectorAll(".event-comment-form").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = form.querySelector("input").value.trim();
      if (!body) return;
      const { error } = await db.from("event_comments").insert({
        event_id: form.dataset.commentEvent, family_id: myFamily.id, body,
      });
      if (error) { toast(error.message); return; }
      await refresh();
    });
  });

  list.querySelectorAll("[data-comment-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { error } = await db.from("event_comments").delete().eq("id", btn.dataset.commentId);
      if (error) { toast(error.message); return; }
      await refresh();
    });
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

$("event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("event-message");
  const { error } = await db.from("events").insert({
    family_id: myFamily.id,
    title: $("ef-title").value.trim(),
    event_date: $("ef-date").value,
    description: $("ef-desc").value.trim() || null,
  });
  if (error) { setMsg(msg, error.message, "error"); return; }
  setMsg(msg, "");
  $("event-form").reset();
  toast("Event added 📌");
  await refresh();
});

// ---------- render: village guide ----------
function renderGuide() {
  // category filter chips
  const counts = {};
  places.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
  $("guide-filters").innerHTML =
    `<button class="filter-chip ${guideFilter === "all" ? "active" : ""}" data-filter="all" type="button">All (${places.length})</button>` +
    Object.entries(CATEGORIES).map(([key, c]) =>
      `<button class="filter-chip ${guideFilter === key ? "active" : ""}" data-filter="${key}" type="button">${c.emoji} ${c.label}${counts[key] ? ` (${counts[key]})` : ""}</button>`
    ).join("");
  $("guide-filters").querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => { guideFilter = btn.dataset.filter; renderGuide(); });
  });

  // category select in the form (keep current selection across re-renders)
  const sel = $("plf-category");
  const prev = sel.value;
  sel.innerHTML = Object.entries(CATEGORIES).map(([key, c]) =>
    `<option value="${key}">${c.emoji} ${c.label}</option>`).join("");
  if (prev) sel.value = prev;

  // place cards, most-hearted first
  const shown = places
    .filter((p) => guideFilter === "all" || p.category === guideFilter)
    .map((p) => ({ p, hearts: placeHearts.filter((h) => h.place_id === p.id) }))
    .sort((a, b) => b.hearts.length - a.hearts.length || a.p.name.localeCompare(b.p.name));

  $("places-list").innerHTML = shown.map(({ p, hearts }) => {
    const cat = CATEGORIES[p.category] || CATEGORIES.other;
    const by = families.find((f) => f.id === p.family_id);
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
      ${p.description ? `<p class="place-desc">${esc(p.description)}</p>` : ""}
      <div class="place-links">
        ${p.maps_url ? `<a href="${esc(p.maps_url)}" target="_blank" rel="noopener">📍 Map</a>` : ""}
        ${p.phone ? `<a href="tel:${esc(p.phone)}">📞 ${esc(p.phone)}</a>` : ""}
        ${mine ? `<button class="btn-danger-link" data-place-id="${p.id}" type="button">Remove</button>` : ""}
      </div>
      <div class="place-tips">
        ${tips.map((t) => {
          const tf = families.find((f) => f.id === t.family_id);
          const tMine = myFamily && t.family_id === myFamily.id;
          return `<div class="place-tip">
            <span class="dot" style="background:${esc(tf?.color || "#999")}"></span>
            <span><strong>${esc(tf?.family_name || "?")}:</strong> ${esc(t.body)}</span>
            ${tMine ? `<button class="btn-danger-link" data-tip-id="${t.id}" type="button">×</button>` : ""}
          </div>`;
        }).join("")}
        <form class="tip-form" data-tip-place="${p.id}">
          <input type="text" maxlength="1000" placeholder="Add your tip…" required>
          <button type="submit" class="btn btn-ghost">Add tip</button>
        </form>
      </div>
    </div>`;
  }).join("") || `<p class="muted" style="text-align:center">No places ${guideFilter === "all" ? "in the guide yet — add the first one above! Where's the best granita?" : "in this category yet."}</p>`;

  const wire = (selector, handler) =>
    $("places-list").querySelectorAll(selector).forEach((el) => el.addEventListener(
      el.tagName === "FORM" ? "submit" : "click", handler));

  wire("[data-heart-place]", async function () {
    const { error } = this.dataset.hearted === "true"
      ? await db.from("place_hearts").delete().eq("place_id", this.dataset.heartPlace).eq("family_id", myFamily.id)
      : await db.from("place_hearts").insert({ place_id: this.dataset.heartPlace, family_id: myFamily.id });
    if (error) { toast(error.message); return; }
    await refresh();
  });
  wire("[data-place-id]", async function () {
    if (!confirm("Remove this place (and its tips) from the guide?")) return;
    const { error } = await db.from("places").delete().eq("id", this.dataset.placeId);
    if (error) { toast(error.message); return; }
    toast("Place removed");
    await refresh();
  });
  wire("[data-tip-id]", async function () {
    const { error } = await db.from("place_tips").delete().eq("id", this.dataset.tipId);
    if (error) { toast(error.message); return; }
    await refresh();
  });
  wire(".tip-form", async function (e) {
    e.preventDefault();
    const body = this.querySelector("input").value.trim();
    if (!body) return;
    const { error } = await db.from("place_tips").insert({
      place_id: this.dataset.tipPlace, family_id: myFamily.id, body,
    });
    if (error) { toast(error.message); return; }
    await refresh();
  });
}

$("place-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("place-message");
  const { error } = await db.from("places").insert({
    family_id: myFamily.id,
    name: $("plf-name").value.trim(),
    category: $("plf-category").value,
    description: $("plf-desc").value.trim() || null,
    maps_url: $("plf-maps").value.trim() || null,
    phone: $("plf-phone").value.trim() || null,
  });
  if (error) { setMsg(msg, error.message, "error"); return; }
  setMsg(msg, "");
  $("place-form").reset();
  toast("Added to the guide 🌿");
  await refresh();
});

// ---------- render: photo wall ----------
function renderGallery() {
  $("gallery-grid").innerHTML = galleryPhotos.map((ph) => {
    const fam = families.find((f) => f.id === ph.family_id);
    const mine = myFamily && ph.family_id === myFamily.id;
    const { data: pub } = db.storage.from("gallery").getPublicUrl(ph.path);
    return `<figure class="gallery-item">
      <img src="${esc(pub.publicUrl)}" alt="${esc(ph.caption || "Photo of Gratteri")}" loading="lazy">
      <figcaption>
        ${ph.caption ? `<span>${esc(ph.caption)}</span>` : ""}
        <span class="muted">— ${esc(fam?.family_name || "?")}</span>
        ${mine ? `<button class="btn-danger-link" data-gallery-id="${ph.id}" data-gallery-path="${esc(ph.path)}" type="button">Remove</button>` : ""}
      </figcaption>
    </figure>`;
  }).join("") || `<p class="muted" style="text-align:center">No photos yet — share the first sunset! 🌅</p>`;

  $("gallery-grid").querySelectorAll("[data-gallery-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this photo?")) return;
      await db.storage.from("gallery").remove([btn.dataset.galleryPath]);
      const { error } = await db.from("gallery_photos").delete().eq("id", btn.dataset.galleryId);
      if (error) { toast(error.message); return; }
      toast("Photo removed");
      await refresh();
    });
  });
}

$("gallery-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("gallery-message");
  const file = $("gf-photo").files[0];
  if (!file || !myFamily) return;
  if (file.size > 8 * 1024 * 1024) {
    setMsg(msg, "That photo is over 8 MB — please pick a smaller one.", "error");
    return;
  }
  setMsg(msg, "Uploading…");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${session.user.id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await db.storage.from("gallery").upload(path, file);
  if (upErr) { setMsg(msg, upErr.message, "error"); return; }
  const { error: insErr } = await db.from("gallery_photos").insert({
    family_id: myFamily.id, path, caption: $("gf-caption").value.trim() || null,
  });
  if (insErr) { setMsg(msg, insErr.message, "error"); return; }
  setMsg(msg, "");
  $("gallery-form").reset();
  toast("Photo shared 🌅");
  await refresh();
});

// ---------- render: noticeboard ----------
function fmtWhen(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function renderBoard() {
  const list = $("board-list");
  list.innerHTML = messages.map((m) => {
    const fam = families.find((f) => f.id === m.family_id);
    const mine = fam && myFamily && fam.id === myFamily.id;
    return `<div class="board-item">
      <div class="board-item-head">
        <span class="dot" style="background:${esc(fam?.color || "#999")}"></span>
        <strong>${esc(fam?.family_name || "A former member")}</strong>
        <span class="muted">${esc(fmtWhen(m.created_at))}</span>
        ${mine ? `<button class="btn-danger-link" data-message-id="${m.id}" type="button">Remove</button>` : ""}
      </div>
      <p>${esc(m.body)}</p>
    </div>`;
  }).join("") || `<p class="muted" style="text-align:center">Nothing on the board yet — be the first to post!</p>`;

  list.querySelectorAll("[data-message-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this note?")) return;
      const { error } = await db.from("messages").delete().eq("id", btn.dataset.messageId);
      if (error) { toast(error.message); return; }
      toast("Note removed");
      await refresh();
    });
  });
}

$("board-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("board-message");
  const body = $("board-body").value.trim();
  if (!body) return;
  const { error } = await db.from("messages").insert({ family_id: myFamily.id, body });
  if (error) { setMsg(msg, error.message, "error"); return; }
  setMsg(msg, "");
  $("board-form").reset();
  await refresh();
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
      ${fam.photo_url ? `<img class="family-photo" src="${esc(fam.photo_url)}" alt="Photo of ${esc(fam.family_name)}" loading="lazy">` : ""}
      <h3>${esc(fam.family_name)}</h3>
      ${fam.home_town ? `<div class="home">📍 ${esc(fam.home_town)}</div>` : ""}
      ${fam.members ? `<div class="members">👨‍👩‍👧‍👦 ${esc(fam.members)}</div>` : ""}
      ${fam.bio ? `<div class="bio">${esc(fam.bio)}</div>` : ""}
      <div class="next-visit">${esc(nextTxt)}</div>
    </div>`;
  }).join("") || `<p class="muted">No families yet.</p>`;
}

// ---------- photo upload ----------
$("pf-photo").addEventListener("change", async () => {
  const file = $("pf-photo").files[0];
  const msg = $("photo-message");
  if (!file || !myFamily) return;
  if (file.size > 5 * 1024 * 1024) {
    setMsg(msg, "That photo is over 5 MB — please pick a smaller one.", "error");
    return;
  }
  setMsg(msg, "Uploading…");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${session.user.id}/photo.${ext}`;
  const { error: upErr } = await db.storage.from("family-photos").upload(path, file, { upsert: true });
  if (upErr) { setMsg(msg, upErr.message, "error"); return; }
  const { data: pub } = db.storage.from("family-photos").getPublicUrl(path);
  const photoUrl = `${pub.publicUrl}?v=${Date.now()}`;
  const { error: updErr } = await db.from("families").update({ photo_url: photoUrl }).eq("id", myFamily.id);
  if (updErr) { setMsg(msg, updErr.message, "error"); return; }
  setMsg(msg, "Photo updated ✓", "ok");
  setTimeout(() => setMsg(msg, ""), 2500);
  await refresh();
});

// ---------- render: my profile ----------
function renderProfileForm() {
  if (!myFamily) return;
  const preview = $("pf-photo-preview");
  if (myFamily.photo_url) {
    preview.classList.remove("hidden");
    preview.innerHTML = `<img src="${esc(myFamily.photo_url)}" alt="Your family photo">`;
  } else {
    preview.classList.add("hidden");
  }
  $("pf-name").value = myFamily.family_name || "";
  $("pf-members").value = myFamily.members || "";
  $("pf-hometown").value = myFamily.home_town || "";
  $("pf-bio").value = myFamily.bio || "";
  selectedColor = myFamily.color || PALETTE[0];

  $("pf-colors").innerHTML = PALETTE.map((c) =>
    `<button type="button" class="swatch ${c === selectedColor ? "selected" : ""}" style="background:${c}" data-color="${c}" aria-label="Choose colour ${c}"></button>`
  ).join("");
  $("pf-colors").querySelectorAll(".swatch").forEach((b) => {
    b.addEventListener("click", () => {
      selectedColor = b.dataset.color;
      $("pf-colors").querySelectorAll(".swatch").forEach((s) => s.classList.toggle("selected", s === b));
    });
  });
}

$("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("profile-message");
  const { error } = await db.from("families").update({
    family_name: $("pf-name").value.trim(),
    members: $("pf-members").value.trim() || null,
    home_town: $("pf-hometown").value.trim() || null,
    bio: $("pf-bio").value.trim() || null,
    color: selectedColor,
  }).eq("id", myFamily.id);
  if (error) { setMsg(msg, error.message, "error"); return; }
  setMsg(msg, "Saved! ✓", "ok");
  setTimeout(() => setMsg(msg, ""), 2500);
  await refresh();
});

// ---------- render: my visits ----------
function renderMyVisits() {
  if (!myFamily) return;
  const list = $("my-visits");
  const today = todayStr();
  const mine = visits
    .filter((v) => v.family_id === myFamily.id)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  list.innerHTML = mine.map((v) => `
    <li class="${v.end_date < today ? "past" : ""}">
      <span class="dates">${esc(fmtRange(v.start_date, v.end_date))}</span>
      <span class="note">${esc(v.notes || "")}</span>
      <button class="btn-danger-link" data-visit-id="${v.id}" type="button">Remove</button>
    </li>`).join("") || `<li class="muted" style="border:none">No visits yet — add your first one above!</li>`;

  list.querySelectorAll("[data-visit-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this visit from the calendar?")) return;
      const { error } = await db.from("visits").delete().eq("id", btn.dataset.visitId);
      if (error) { toast(error.message); return; }
      toast("Visit removed");
      await refresh();
    });
  });
}

$("visit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("visit-message");
  const start = $("vf-start").value;
  const end = $("vf-end").value;
  if (end < start) { setMsg(msg, "The end date is before the start date.", "error"); return; }
  const { error } = await db.from("visits").insert({
    family_id: myFamily.id,
    start_date: start,
    end_date: end,
    notes: $("vf-notes").value.trim() || null,
  });
  if (error) { setMsg(msg, error.message, "error"); return; }
  setMsg(msg, "");
  $("visit-form").reset();
  toast("Visit added to the calendar 🎉");
  await refresh();
});

// ---------- boot ----------
(async () => {
  const { data } = await db.auth.getSession();
  if (!data.session) {
    $("auth-screen").classList.remove("hidden");
  }
  // onAuthStateChange fires with INITIAL_SESSION and handles the rest
})();
