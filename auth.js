/* My Supp App: accounts and saving.
   Order on the page: config.js, then vendor/supabase.js, then this file. This file loads app.js once someone is logged in.
   - Login / sign up / forgot password / new password screens.
   - Profile sheet: display name, photo, log out.
   - window.claude.use("db" | "user" | "assets" | "sample"): the same small interface the planner was written against,
     backed by Supabase tables and storage plus the /api/claude server function. */
(() => {
"use strict";

/* ---------- Config and client ---------- */
const cfg = window.APP_CONFIG || {};
const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && !/YOUR-|PASTE/i.test(cfg.supabaseUrl + cfg.supabaseAnonKey));
const sb = !configured || !window.supabase ? null : window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const APP_KEY = "mysupp";
// Match the planner's theme (dark unless they picked light) before anything shows.
try { const th = localStorage.getItem("planner.theme"); document.documentElement.setAttribute("data-theme", th === "light" ? "light" : "dark"); let ac = localStorage.getItem("planner.accent"); if (ac === "magenta") ac = "violet"; if (/^(ember|violet|electric|volt)$/.test(ac || "")) document.documentElement.setAttribute("data-accent", ac); } catch {}

/* ---------- Auth functions ---------- */
let user = null;
const must = ({ data, error }) => { if (error) throw error; return data; };
async function currentUser() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  user = data && data.session ? data.session.user : null;
  return user;
}
function onAuth(cb) {
  if (sb) sb.auth.onAuthStateChange((event, session) => { user = session ? session.user : null; cb(event, user); });
}
async function nameAvailable(name) { return must(await sb.rpc("name_available", { name })); }
async function signUp(email, password, displayName) {
  const data = must(await sb.auth.signUp({
    email, password,
    options: { data: { display_name: displayName }, emailRedirectTo: location.origin + location.pathname },
  }));
  user = data.session ? data.user : null;
  return { needsConfirm: !data.session };
}
async function signIn(email, password) {
  const data = must(await sb.auth.signInWithPassword({ email, password }));
  user = data.user; return user;
}
async function resetPassword(email) {
  must(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
}
async function setPassword(password) { must(await sb.auth.updateUser({ password })); }
async function getProfile() { return must(await sb.from("profiles").select("*").eq("id", user.id).maybeSingle()); }
async function updateProfile(patch) { return must(await sb.from("profiles").update(patch).eq("id", user.id).select().maybeSingle()); }

const nice = (e) => {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || "Something went wrong");
  if (/Invalid login credentials/i.test(m)) return "That email and password don't match an account.";
  if (/Email not confirmed/i.test(m)) return "Confirm your email first. Check your inbox for the link.";
  if (/User already registered/i.test(m)) return "There's already an account with that email. Try logging in.";
  if (/Database error saving new user/i.test(m)) return "That display name was just taken. Try another.";
  if (/Password should be at least/i.test(m)) return "Use a password of at least 6 characters.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Can't reach the server. Check your connection.";
  if (/profiles_display_name_unique|duplicate key/i.test(m)) return "That display name is taken.";
  if (/rate limit|too many/i.test(m)) return "Too many tries in a row. Wait a few minutes and try again.";
  if (/Could not find the function|schema cache|does not exist/i.test(m)) return "The database needs updating: run the SQL again in the Supabase SQL Editor.";
  return m;
};
const isNetwork = (e, status) => status === 0 || !navigator.onLine || /Failed to fetch|NetworkError|Load failed|fetch failed|network/i.test((e && (e.message || e.details)) || "");

/* ---------- Small helpers ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (s, r = document) => r.querySelector(s);
const NAME_RE = /^[A-Za-z0-9_.]{3,20}$/, EMAIL_RE = /^\S+@\S+\.\S+$/;
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };
function toast(t) {
  const el = $("#toast"); if (!el) return;
  el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3500);
}
function syncNote(t) { const el = $("#syncnote"); if (el) el.textContent = t; }
const ICON = {
  user: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

/* ---------- Screens ---------- */
const root = document.createElement("div"); root.id = "auth"; root.className = "au-root"; document.body.appendChild(root);
const pop = document.createElement("div"); pop.id = "authpop"; document.body.appendChild(pop);
const brandHtml = (sub) => `<div class="au-brand"><img class="au-logoimg" src="icon-192.png" alt="" aria-hidden="true"><h1>Elevate</h1>${sub ? `<p>${sub}</p>` : ""}</div>`;
function showRoot(html) { root.hidden = false; root.innerHTML = `<div class="au-wrap"><div class="au-card">${html}</div></div>`; document.documentElement.classList.add("au-locked"); }
function hideRoot() { root.hidden = true; root.innerHTML = ""; document.documentElement.classList.remove("au-locked"); }

function renderSetupNeeded() {
  showRoot(`${brandHtml("")}<h2 class="au-h">Almost ready, add your Supabase keys</h2>
    <p class="au-p">Open <b>config.js</b> and paste in your Supabase <b>Project URL</b> and <b>Publishable key</b>. Then reload this page.</p>
    <p class="au-p au-dim">Never paste the secret or service_role key. It skips every security rule.</p>`);
}
function renderLoading(t) { showRoot(`${brandHtml("")}<div class="au-loading"><span class="spin"></span><p>${esc(t || "Opening your planner…")}</p></div>`); }

const F = { mode: "login", email: "", name: "", msg: "", kind: "", busy: false, nameOk: null, nameMsg: "" };
function renderAuth(mode, msg, kind) {
  F.mode = mode || F.mode; F.msg = msg || ""; F.kind = kind || (msg ? "info" : ""); F.busy = false;
  const su = F.mode === "signup";
  showRoot(`${brandHtml("Supplements, meals, workouts and more, saved to your account.")}
    <div class="au-seg" role="tablist" aria-label="Log in or sign up">
      <button type="button" role="tab" data-au-mode="login" aria-selected="${!su}">Log in</button>
      <button type="button" role="tab" data-au-mode="signup" aria-selected="${su}">Sign up</button>
    </div>
    <form id="au-form" novalidate>
      ${su ? `<label class="au-f"><span>Display name</span><input id="au-name" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="20" value="${esc(F.name)}" placeholder="e.g. sky_lifts"></label>
      <div class="au-hint" id="au-namehint" aria-live="polite">${esc(F.nameMsg || "3 to 20 letters, numbers, dots or underscores.")}</div>` : ""}
      <label class="au-f"><span>Email</span><input id="au-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" value="${esc(F.email)}"></label>
      <label class="au-f"><span>Password</span><input id="au-pass" type="password" autocomplete="${su ? "new-password" : "current-password"}" minlength="6" placeholder="${su ? "At least 6 characters" : ""}"></label>
      ${su ? "" : `<button type="button" class="au-link" id="au-forgot">Forgot password?</button>`}
      <div class="au-msg ${F.kind}" id="au-msg" role="status">${esc(F.msg)}</div>
      <button class="au-primary" type="submit" id="au-submit">${su ? "Create account" : "Log in"}</button>
    </form>`);
  if (su) paintNameHint();
}
function setMsg(t, kind = "err") { F.msg = t; F.kind = kind; const el = $("#au-msg"); if (el) { el.textContent = t; el.className = "au-msg " + kind; } }
function setBusy(b, label) { F.busy = b; const btn = $("#au-submit"); if (btn) { btn.disabled = b; btn.textContent = label || (F.mode === "signup" ? "Create account" : "Log in"); } }
function paintNameHint() {
  const el = $("#au-namehint"); if (!el) return;
  el.textContent = F.nameMsg || "3 to 20 letters, numbers, dots or underscores.";
  el.className = "au-hint" + (F.nameOk === true ? " ok" : F.nameOk === false ? " err" : "");
}
let nameTimer = null, nameSeq = 0;
function checkNameSoon(name, after) {
  clearTimeout(nameTimer); const seq = ++nameSeq;
  if (!name) { F.nameOk = null; F.nameMsg = ""; after(); return; }
  if (!NAME_RE.test(name)) { F.nameOk = false; F.nameMsg = "Use 3 to 20 letters, numbers, dots or underscores."; after(); return; }
  F.nameOk = null; F.nameMsg = "Checking…"; after();
  nameTimer = setTimeout(async () => {
    try { const ok = await nameAvailable(name); if (seq !== nameSeq) return; F.nameOk = !!ok; F.nameMsg = ok ? "✓ Name is available" : "Name is taken"; }
    catch (e) { if (seq !== nameSeq) return; F.nameOk = null; F.nameMsg = nice(e); }
    after();
  }, 350);
}

root.addEventListener("input", (e) => {
  if (e.target.id === "au-email") F.email = e.target.value.trim();
  if (e.target.id === "au-name") { F.name = e.target.value.trim(); checkNameSoon(F.name, paintNameHint); }
});
root.addEventListener("click", async (e) => {
  const m = e.target.closest("[data-au-mode]");
  if (m && !F.busy) { F.nameMsg = ""; F.nameOk = null; renderAuth(m.dataset.auMode); $(F.mode === "signup" ? "#au-name" : "#au-email")?.focus(); return; }
  if (e.target.closest("#au-forgot") && !F.busy) {
    const email = ($("#au-email")?.value || "").trim(); F.email = email;
    if (!EMAIL_RE.test(email)) { setMsg("Type your email above first, then tap Forgot password."); $("#au-email")?.focus(); return; }
    setBusy(true, "Sending…");
    try { await resetPassword(email); setBusy(false); setMsg(`We sent a password reset link to ${email}.`, "ok"); }
    catch (err) { setBusy(false); setMsg(nice(err)); }
  }
});
root.addEventListener("submit", async (e) => {
  if (e.target.id !== "au-form") return;
  e.preventDefault(); e.stopPropagation(); if (F.busy) return;
  const email = ($("#au-email")?.value || "").trim(), pass = $("#au-pass")?.value || ""; F.email = email;
  if (!EMAIL_RE.test(email)) { setMsg("Enter a valid email address."); return; }
  if (pass.length < 6) { setMsg("Use a password of at least 6 characters."); return; }
  if (F.mode === "signup") {
    const name = ($("#au-name")?.value || "").trim(); F.name = name;
    if (!NAME_RE.test(name)) { setMsg("Display name: 3 to 20 letters, numbers, dots or underscores."); return; }
    setBusy(true, "Creating account…"); setMsg("", "");
    try {
      if (!(await nameAvailable(name))) { F.nameOk = false; F.nameMsg = "Name is taken"; paintNameHint(); setBusy(false); setMsg("That display name is taken."); return; }
      const r = await signUp(email, pass, name);
      if (r.needsConfirm) { F.name = ""; F.nameMsg = ""; renderAuth("login", `Almost there. We sent a confirmation link to ${email}. Tap it, then log in here.`, "ok"); }
      else startSignedIn();
    } catch (err) { setBusy(false); setMsg(nice(err)); }
  } else {
    setBusy(true, "Logging in…"); setMsg("", "");
    try { await signIn(email, pass); startSignedIn(); }
    catch (err) { setBusy(false); setMsg(nice(err)); }
  }
});

/* New password pop-up (opened from a reset email link) */
function openNewPassword() {
  pop.innerHTML = `<div class="au-scrim"><div class="au-sheet au-small" role="dialog" aria-modal="true" aria-labelledby="au-np-h">
    <h2 class="au-h" id="au-np-h">Choose a new password</h2>
    <form id="au-np" novalidate>
      <label class="au-f"><span>New password</span><input id="au-np-pass" type="password" autocomplete="new-password" minlength="6" placeholder="At least 6 characters"></label>
      <div class="au-msg" id="au-np-msg" role="status"></div>
      <button class="au-primary" type="submit" id="au-np-btn">Save password</button>
    </form></div></div>`;
  $("#au-np-pass")?.focus();
}
pop.addEventListener("submit", async (e) => {
  if (e.target.id !== "au-np") return;
  e.preventDefault(); e.stopPropagation();
  const p = $("#au-np-pass").value, msg = $("#au-np-msg"), btn = $("#au-np-btn");
  if (p.length < 6) { msg.textContent = "Use a password of at least 6 characters."; msg.className = "au-msg err"; return; }
  btn.disabled = true; btn.textContent = "Saving…";
  try { await setPassword(p); pop.innerHTML = ""; toast("Password updated."); if (!appStarted) startSignedIn(); }
  catch (err) { btn.disabled = false; btn.textContent = "Save password"; msg.textContent = nice(err); msg.className = "au-msg err"; }
});

/* ---------- Profile sheet ---------- */
let profile = null;
function paintAvatarBtn() {
  const b = $("#avatarbtn"); if (!b) return;
  b.hidden = false;
  b.innerHTML = profile?.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="">` : profile?.display_name ? `<span>${esc(profile.display_name[0].toUpperCase())}</span>` : ICON.user;
}
const P = { open: false, msg: "", kind: "", nameOk: null, nameMsg: "", busy: false };
function openProfile() { P.open = true; P.msg = ""; P.nameOk = null; P.nameMsg = ""; renderProfile(); $("#au-pname")?.focus({ preventScroll: true }); }
function closeProfile() { P.open = false; pop.innerHTML = ""; }
function renderProfile() {
  if (!P.open) return;
  const av = profile?.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="Your photo">` : `<span>${esc((profile?.display_name || "?")[0].toUpperCase())}</span>`;
  pop.innerHTML = `<div class="au-scrim" data-au-close><div class="au-sheet" role="dialog" aria-modal="true" aria-labelledby="au-p-h">
    <div class="au-sheethead"><h2 class="au-h" id="au-p-h">Your profile</h2><button class="iconbtn" type="button" data-au-close aria-label="Close">${ICON.x}</button></div>
    <div class="au-prow">
      <label class="au-avatar" for="au-photo" title="Change photo">${av}<span class="au-cam">${ICON.cam}</span><input id="au-photo" type="file" accept="image/*"></label>
      <div><div class="au-pname">${esc(profile?.display_name || "")}</div><div class="au-dim">${esc(user?.email || "")}</div>
      <label class="au-link" for="au-photo">${P.busy === "photo" ? "Uploading photo…" : "Change photo"}</label></div>
    </div>
    <form id="au-pform" novalidate>
      <label class="au-f"><span>Display name</span><input id="au-pname" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="20" value="${esc(profile?.display_name || "")}"></label>
      <div class="au-hint ${P.nameOk === true ? "ok" : P.nameOk === false ? "err" : ""}" id="au-pnamehint" aria-live="polite">${esc(P.nameMsg || "3 to 20 letters, numbers, dots or underscores.")}</div>
      <div class="au-msg ${P.kind}" id="au-pmsg" role="status">${esc(P.msg)}</div>
      <button class="au-primary" type="submit" ${P.busy ? "disabled" : ""}>${P.busy === "name" ? "Saving…" : "Save name"}</button>
    </form>
    <div class="au-sync" id="au-sync">${esc(syncSummary())}</div>
    <button class="au-out" type="button" id="au-logout" ${P.busy ? "disabled" : ""}>${P.busy === "out" ? "Logging out…" : "Log out"}</button>
  </div></div>`;
}
function pMsg(t, kind = "err") { P.msg = t; P.kind = kind; const el = $("#au-pmsg"); if (el) { el.textContent = t; el.className = "au-msg " + kind; } }
document.addEventListener("click", (e) => { if (e.target.closest("#avatarbtn")) { e.stopPropagation(); openProfile(); } }, true);
pop.addEventListener("click", async (e) => {
  const c = e.target.closest("[data-au-close]");
  if (c && (c.classList.contains("iconbtn") || e.target === c) && !P.busy) { closeProfile(); return; }
  if (e.target.closest("#au-logout") && !P.busy) { P.busy = "out"; renderProfile(); await logOut(); }
});
pop.addEventListener("keydown", (e) => { if (e.key === "Escape" && P.open && !P.busy) closeProfile(); });
pop.addEventListener("input", (e) => {
  if (e.target.id !== "au-pname") return;
  const name = e.target.value.trim();
  const paint = () => { const el = $("#au-pnamehint"); if (el) { el.textContent = P.nameMsg || "3 to 20 letters, numbers, dots or underscores."; el.className = "au-hint" + (P.nameOk === true ? " ok" : P.nameOk === false ? " err" : ""); } };
  if (name.toLowerCase() === (profile?.display_name || "").toLowerCase()) { clearTimeout(nameTimer); nameSeq++; P.nameOk = null; P.nameMsg = name === profile?.display_name ? "" : "✓ Name is available"; P.nameOk = name === profile?.display_name ? null : true; paint(); return; }
  clearTimeout(nameTimer); const seq = ++nameSeq;
  if (!NAME_RE.test(name)) { P.nameOk = false; P.nameMsg = "Use 3 to 20 letters, numbers, dots or underscores."; paint(); return; }
  P.nameOk = null; P.nameMsg = "Checking…"; paint();
  nameTimer = setTimeout(async () => {
    try { const ok = await nameAvailable(name); if (seq !== nameSeq) return; P.nameOk = !!ok; P.nameMsg = ok ? "✓ Name is available" : "Name is taken"; }
    catch (err) { if (seq !== nameSeq) return; P.nameOk = null; P.nameMsg = nice(err); }
    paint();
  }, 350);
});
pop.addEventListener("submit", async (e) => {
  if (e.target.id !== "au-pform") return;
  e.preventDefault(); e.stopPropagation(); if (P.busy) return;
  const name = $("#au-pname").value.trim();
  if (name === profile?.display_name) { pMsg("That's already your name.", "info"); return; }
  if (!NAME_RE.test(name)) { pMsg("Display name: 3 to 20 letters, numbers, dots or underscores."); return; }
  P.busy = "name"; renderProfile();
  try {
    if (name.toLowerCase() !== (profile?.display_name || "").toLowerCase() && !(await nameAvailable(name))) throw new Error("profiles_display_name_unique");
    const p = await updateProfile({ display_name: name }); if (p) profile = p; saveProfileCache();
    P.busy = false; P.nameMsg = ""; P.nameOk = null; P.msg = "Name saved."; P.kind = "ok";
  } catch (err) { P.busy = false; P.msg = nice(err); P.kind = "err"; }
  renderProfile(); paintAvatarBtn();
});
pop.addEventListener("change", async (e) => {
  if (e.target.id !== "au-photo") return;
  const file = e.target.files?.[0]; if (!file || P.busy) return;
  P.busy = "photo"; P.msg = ""; renderProfile();
  try { const p = await uploadAvatar(file, profile?.avatar_url); if (p) profile = p; saveProfileCache(); P.busy = false; P.msg = "Photo updated."; P.kind = "ok"; }
  catch (err) { P.busy = false; P.msg = nice(err); P.kind = "err"; }
  renderProfile(); paintAvatarBtn();
});

async function uploadAvatar(file, oldUrl) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn't an image we can read.")); i.src = URL.createObjectURL(file); });
  const side = Math.min(img.naturalWidth, img.naturalHeight), size = Math.min(512, side);
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  cv.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  URL.revokeObjectURL(img.src);
  const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.86));
  const path = `${user.id}/avatar-${Date.now()}.jpg`;
  must(await sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" }));
  const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  const prof = await updateProfile({ avatar_url: url });
  const m = oldUrl && oldUrl.match(/\/avatars\/(.+)$/);
  if (m) sb.storage.from("avatars").remove([decodeURIComponent(m[1])]).catch(() => {});
  return prof;
}

/* ---------- Saving the planner's data ----------
   Everything lives in memory in `cols` (list path → item id → item). Each change is copied to localStorage
   straight away under "mysupp.cloud.<user id>" and marked dirty, then saved to Supabase 500 ms later.
   If the network is down the dirty copy stays on the phone and is saved on the next load, when the
   connection comes back, or when the app is opened again. If the server refuses a change, the change is
   dropped and the account's real data is reloaded. */
const D = { uid: null, cols: {}, dirty: {}, ready: false, fetched: false, lastFetch: 0, ver: 0, listeners: [], prefix: "", fetchP: null, offline: false };
const cacheKey = () => `${APP_KEY}.cloud.${D.uid}`;
const dkey = (path, id) => path + "\u0001" + id;
let persistTimer = null;
function persistNow() { clearTimeout(persistTimer); persistTimer = null; if (D.uid) lsSet(cacheKey(), { v: 1, cols: D.cols, dirty: D.dirty, profile, at: Date.now() }); }
function persistSoon() { if (!persistTimer) persistTimer = setTimeout(persistNow, 120); }
function saveProfileCache() { persistSoon(); }
function relPath(p) { return p.startsWith(D.prefix) ? p.slice(D.prefix.length) : p; }
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
function colSnap(path, q) {
  let rows = Object.entries(D.cols[path] || {});
  if (q.order) { const [f, dir] = q.order, s = dir === "desc" ? -1 : 1; rows.sort((a, b) => { const x = a[1]?.[f], y = b[1]?.[f]; return (x == null) - (y == null) || (x < y ? -s : x > y ? s : 0); }); }
  if (q.limit) rows = rows.slice(0, q.limit);
  const docs = rows.map(([id, v]) => ({ id, exists: true, data: () => clone(v) }));
  return { docs, size: docs.length, empty: !docs.length, forEach: (fn) => docs.forEach(fn) };
}
function docSnap(path, id) { const v = D.cols[path]?.[id]; return { id, exists: v !== undefined, data: () => clone(v) }; }
function emit(path) {
  for (const l of D.listeners.slice()) {
    if (path && l.path !== path) continue;
    try { l.cb(l.id != null ? docSnap(l.path, l.id) : colSnap(l.path, l)); } catch (e) { console.error(e); }
  }
}
function listen(l) {
  D.listeners.push(l);
  if (D.ready) queueMicrotask(() => { if (D.listeners.includes(l)) l.cb(l.id != null ? docSnap(l.path, l.id) : colSnap(l.path, l)); });
  return () => { D.listeners = D.listeners.filter((x) => x !== l); };
}
function localWrite(path, id, data) {
  D.cols[path] = D.cols[path] || {};
  if (data === null) delete D.cols[path][id]; else D.cols[path][id] = clone(data);
  D.dirty[dkey(path, id)] = { path, id, data: data === null ? null : clone(data), ver: ++D.ver };
  persistSoon(); emit(path); flushSoon(500);
}
async function fetchAll() {
  if (D.fetchP) return D.fetchP;
  D.fetchP = (async () => {
    const cols = {};
    for (let from = 0; ; from += 1000) {
      const { data, error, status } = await sb.from("user_docs").select("path,doc_id,data").order("path").order("doc_id").range(from, from + 999);
      if (error) throw Object.assign(new Error(error.message || "load failed"), { status, cause: error });
      for (const r of data) (cols[r.path] = cols[r.path] || {})[r.doc_id] = r.data;
      if (data.length < 1000) break;
    }
    for (const d of Object.values(D.dirty)) { cols[d.path] = cols[d.path] || {}; if (d.data === null) delete cols[d.path][d.id]; else cols[d.path][d.id] = d.data; }
    const paths = new Set([...Object.keys(cols), ...Object.keys(D.cols)]);
    D.cols = cols; D.ready = true; D.fetched = true; D.lastFetch = Date.now(); setOffline(false);
    persistSoon();
    for (const p of paths) emit(p);
  })().finally(() => { D.fetchP = null; });
  return D.fetchP;
}
let flushTimer = null, flushing = false, flushAgain = false;
function flushSoon(ms) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }
function setOffline(v) {
  if (D.offline === v) return; D.offline = v;
  syncNote(v ? "Offline · saved on this phone" : "Synced to your account");
}
async function flush() {
  clearTimeout(flushTimer);
  if (!D.uid || !sb) return;
  if (flushing) { flushAgain = true; return; }
  const batch = Object.entries(D.dirty).map(([k, v]) => ({ k, v, ver: v.ver }));
  if (!batch.length) return;
  flushing = true;
  const done = () => { for (const e of batch) if (D.dirty[e.k] && D.dirty[e.k].ver === e.ver) delete D.dirty[e.k]; persistSoon(); };
  try {
    const ups = batch.filter((e) => e.v.data !== null).map((e) => ({ user_id: D.uid, path: e.v.path, doc_id: e.v.id, data: e.v.data }));
    for (let i = 0; i < ups.length; i += 200) {
      const { error, status } = await sb.from("user_docs").upsert(ups.slice(i, i + 200), { onConflict: "user_id,path,doc_id" });
      if (error) throw Object.assign(new Error(error.message || "save failed"), { status, cause: error });
    }
    const dels = {};
    for (const e of batch) if (e.v.data === null) (dels[e.v.path] = dels[e.v.path] || []).push(e.v.id);
    for (const [path, ids] of Object.entries(dels)) {
      const { error, status } = await sb.from("user_docs").delete().eq("path", path).in("doc_id", ids);
      if (error) throw Object.assign(new Error(error.message || "delete failed"), { status, cause: error });
    }
    done(); setOffline(false);
  } catch (err) {
    if (isNetwork(err.cause || err, err.status)) { setOffline(true); flushSoon(20000); }
    else {
      console.warn("Save refused", err);
      done(); toast("The server refused that change, so your saved data was reloaded.");
      fetchAll().catch(() => {});
    }
  } finally {
    flushing = false;
    if (flushAgain) { flushAgain = false; flushSoon(50); }
  }
}
function syncSummary() {
  const n = Object.keys(D.dirty).length;
  return n ? `${n} change${n === 1 ? "" : "s"} waiting to save. ${D.offline ? "They'll save when you're back online." : "Saving…"}` : "Everything is saved to your account.";
}
window.addEventListener("online", () => { flushSoon(200); if (D.uid) fetchAll().catch(() => {}); });
window.addEventListener("offline", () => setOffline(true));
window.addEventListener("pagehide", () => { persistNow(); flush(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { persistNow(); flush(); return; }
  if (D.uid && Date.now() - D.lastFetch > 30000 && !Object.keys(D.dirty).length) fetchAll().catch(() => {});
  else if (D.uid) flushSoon(200);
});

function makeDb() {
  const collection = (rawPath) => {
    const path = relPath(rawPath);
    const query = (q) => ({
      orderBy: (f, dir = "asc") => query({ ...q, order: [f, dir] }),
      limit: (n) => query({ ...q, limit: n }),
      onSnapshot: (cb, err) => listen({ path, cb, err, ...q }),
    });
    return {
      ...query({}),
      doc: (id) => ({
        id,
        set: async (data) => { localWrite(path, String(id), data); },
        delete: async () => { localWrite(path, String(id), null); },
        onSnapshot: (cb, err) => listen({ path, id: String(id), cb, err }),
      }),
    };
  };
  return { collection };
}

/* Private photos: stored in the "uploads" bucket at <user id>/<random>.jpg and shown through short-lived signed links. */
const PIX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const SIGNED = {}; let wanted = new Set(), signTimer = null;
const SIGN_KEY = () => `${APP_KEY}.signed.${D.uid}`;
window.__blobSrc = (ref) => {
  if (!/^sb:/.test(ref)) return PIX;
  const c = SIGNED[ref];
  if (c && c.exp > Date.now() + 60000) return c.url;
  wanted.add(ref); clearTimeout(signTimer); signTimer = setTimeout(signWanted, 20);
  return PIX + "#sb=" + encodeURIComponent(ref);
};
async function signWanted() {
  const refs = [...wanted]; wanted = new Set(); if (!refs.length || !sb) return;
  const paths = refs.map((r) => r.replace(/^sb:uploads\//, ""));
  try {
    const { data, error } = await sb.storage.from("uploads").createSignedUrls(paths, 86400);
    if (error) throw error;
    (data || []).forEach((d, i) => { if (d.signedUrl) SIGNED[refs[i]] = { url: d.signedUrl, exp: Date.now() + 86400000 }; });
    lsSet(SIGN_KEY(), SIGNED);
  } catch { return; }
  for (const el of document.querySelectorAll('img[src*="#sb="], a[href*="#sb="]')) {
    const attr = el.tagName === "IMG" ? "src" : "href", v = el.getAttribute(attr), ref = decodeURIComponent(v.split("#sb=")[1] || "");
    if (SIGNED[ref]) el.setAttribute(attr, SIGNED[ref].url);
  }
}
function makeAssets() {
  return {
    upload: async (blob) => {
      const ext = /png/.test(blob.type) ? "png" : /webp/.test(blob.type) ? "webp" : "jpg";
      const path = `${D.uid}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      must(await sb.storage.from("uploads").upload(path, blob, { contentType: blob.type || "image/jpeg", cacheControl: "31536000" }));
      const id = "sb:uploads/" + path;
      SIGNED[id] = { url: URL.createObjectURL(blob), exp: Date.now() + 3600000 };
      return { id };
    },
    delete: async (ref) => {
      if (!/^sb:uploads\//.test(ref)) return;
      must(await sb.storage.from("uploads").remove([ref.replace(/^sb:uploads\//, "")]));
      delete SIGNED[ref];
    },
  };
}

/* Reading photos and PDFs with Claude: the planner calls sample.json(prompt, { images }); this sends it to /api/claude,
   which checks the login and holds the Anthropic key on the server. */
const AI_URL = cfg.aiUrl || "/api/claude";
let aiInfo = null;
const blobToB64 = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(b); });
async function token() { const { data } = await sb.auth.getSession(); return data?.session?.access_token || ""; }

/* Free reading through the Claude reader page: the app hands over a request code (prompt + shrunk photos),
   the person pastes it into the reader on claude.ai, which reads it on their Claude plan and gives back a result code. */
const READER_URL = cfg.readerUrl || "";
const REQ = "PLANNER-READ:", RES = "PLANNER-RESULT:";
const bytesToB64 = (u) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToBytes = (b) => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
async function deflate(text) { return bytesToB64(new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer())); }
async function inflate(b64) { return new TextDecoder().decode(await new Response(new Blob([b64ToBytes(b64)]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()); }
async function shrinkForCode(blob) {
  try {
    const bmp = await createImageBitmap(blob), sc = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    return await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.78));
  } catch { return blob; }
}
function bridge(prompt, images) {
  return new Promise(async (resolve, reject) => {
    let code = "";
    const imgs = [];
    for (const b of images.slice(0, 5)) { const s = await shrinkForCode(b); imgs.push({ t: s.type || "image/jpeg", d: await blobToB64(s) }); }
    code = REQ + (await deflate(JSON.stringify({ v: 1, prompt, images: imgs, label: imgs.length ? "a photo reading" : "a reading" })));
    const finish = (fn, v) => { pop.innerHTML = ""; pop.removeEventListener("click", onClick); pop.removeEventListener("input", onInput); fn(v); };
    pop.innerHTML = `<div class="au-scrim"><div class="au-sheet" role="dialog" aria-modal="true" aria-labelledby="br-h">
      <div class="au-sheethead"><h2 class="au-h" id="br-h">Read it free with Claude</h2><button class="iconbtn" type="button" id="br-x" aria-label="Cancel">${ICON.x}</button></div>
      <ol class="br-steps">
        <li><b>Copy the request.</b><button class="au-primary br-btn" type="button" id="br-copy">Copy request</button><textarea id="br-code" class="br-code" readonly hidden></textarea><span class="au-dim" id="br-copied"></span></li>
        <li><span><b>Open the reader</b>, paste it in, tap <b>Read with Claude</b>, then <b>Copy result</b>.</span><a class="au-out br-btn br-link" href="${esc(READER_URL)}" target="_blank" rel="noopener">Open the reader on Claude</a></li>
        <li><b>Paste the result here.</b><textarea id="br-res" class="br-code" placeholder="PLANNER-RESULT:…" spellcheck="false" autocapitalize="off"></textarea><div class="au-msg" id="br-msg" role="status"></div></li>
      </ol>
      <p class="au-dim" style="margin:0">Uses your Claude plan, so it costs nothing extra.</p>
    </div></div>`;
    const onClick = (e) => {
      if (e.target.closest("#br-x")) finish(reject, Object.assign(new Error("cancelled"), { code: "cancelled" }));
      if (e.target.closest("#br-copy")) {
        navigator.clipboard.writeText(code).then(() => { $("#br-copied").textContent = "Copied. Now open the reader."; },
          () => { const t = $("#br-code"); t.value = code; t.hidden = false; t.focus(); t.select(); $("#br-copied").textContent = "Copy the selected text above."; });
      }
    };
    const onInput = async (e) => {
      if (e.target.id !== "br-res") return;
      const raw = e.target.value.replace(/\s+/g, ""), msg = $("#br-msg");
      if (!raw) { msg.textContent = ""; msg.className = "au-msg"; return; }
      const at = raw.lastIndexOf(RES); // the last result pasted, even if an older one is still in the box
      if (at < 0) { msg.textContent = raw.includes(REQ) ? "That's the request. Paste it into the reader, then copy the result from there." : "That's not a result from the reader. Tap Copy result there and paste again."; msg.className = "au-msg err"; return; }
      try { const j = JSON.parse(await inflate(raw.slice(at + RES.length).replace(/[^A-Za-z0-9+/=]/g, ""))); finish(resolve, j.data); }
      catch { msg.textContent = "Part of the result is missing. Copy it again from the reader."; msg.className = "au-msg err"; }
    };
    pop.addEventListener("click", onClick); pop.addEventListener("input", onInput);
  });
}
function makeSample() {
  return {
    limits: async () => {
      if (!aiInfo) {
        try { const r = await fetch(AI_URL, { headers: { Authorization: "Bearer " + (await token()) } }); aiInfo = r.ok ? await r.json() : { ready: false }; }
        catch { aiInfo = { ready: false }; }
      }
      return aiInfo.ready ? { images: { maxCount: aiInfo.maxImages || 5 } } : READER_URL ? { images: { maxCount: 5 } } : null;
    },
    json: async (prompt, opts = {}) => {
      if (!aiInfo) await makeSample().limits();
      if (!aiInfo.ready && READER_URL) return bridge(prompt, opts.images || []);
      const images = [];
      for (const b of (opts.images || []).slice(0, aiInfo?.maxImages || 5)) images.push({ media_type: /png|webp|gif/.test(b.type) ? b.type : "image/jpeg", data: await blobToB64(b) });
      let r;
      try { r = await fetch(AI_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await token()) }, body: JSON.stringify({ prompt, images }) }); }
      catch (e) { throw Object.assign(new Error("network"), { code: "network" }); }
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(out.error || "failed"), { code: r.status === 429 ? "rate_limited" : r.status === 503 ? "not_granted" : out.code || "failed" });
      return out.data;
    },
  };
}

/* ---------- Start-up ---------- */
let appStarted = false, starting = false;
async function startSignedIn() {
  if (appStarted || starting) return;
  starting = true;
  const u = user || (await currentUser());
  if (!u) { starting = false; renderAuth("login"); return; }
  if (!appStarted) renderLoading();
  D.uid = u.id; D.prefix = `data/users/${u.id}/`;
  const cached = lsGet(cacheKey());
  if (cached && cached.v === 1) { D.cols = cached.cols || {}; D.dirty = cached.dirty || {}; profile = cached.profile || null; D.ready = true; D.ver = Object.values(D.dirty).reduce((m, d) => Math.max(m, d.ver || 0), 0); }
  Object.assign(SIGNED, lsGet(SIGN_KEY()) || {});
  try {
    try {
      const p = await getProfile();
      if (!p) throw new Error("Your profile is missing. Run the SQL setup again, then sign up once more.");
      profile = p;
      const { data: st } = await sb.from("user_settings").select("data").eq("user_id", u.id).maybeSingle();
      const th = st?.data?.theme; if (th === "light" || th === "dark") { try { localStorage.setItem("planner.theme", th); } catch {} }
      let ac = st?.data?.accent; if (ac === "magenta") ac = "violet"; if (/^(ember|violet|electric|volt)$/.test(ac || "")) { try { localStorage.setItem("planner.accent", ac); } catch {} }
      await fetchAll();
    } catch (e) {
      // Offline with a copy on this phone: open from that copy and save later.
      if (!(isNetwork(e.cause || e, e.status) && cached)) throw e;
      setTimeout(() => setOffline(true), 800);
    }
    persistNow();
    installShim();
    await loadApp();
    appStarted = true; starting = false;
    hideRoot(); paintAvatarBtn(); watchTheme();
    if (Object.keys(D.dirty).length) flushSoon(300);
  } catch (e) {
    starting = false; D.uid = null; D.cols = {}; D.dirty = {}; D.ready = false;
    renderAuth("login", "Couldn't load your account: " + nice(e), "err");
  }
}
function installShim() {
  const db = makeDb(), assets = makeAssets(), sample = makeSample(), usr = { id: async () => D.uid, name: async () => profile?.display_name || "" };
  window.claude = { use: async (name) => (name === "db" ? db : name === "user" ? usr : name === "assets" ? assets : name === "sample" ? sample : null) };
}
function loadApp() {
  return new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = cfg.appSrc || "app.js"; s.onload = () => res(); s.onerror = () => rej(new Error("Couldn't load the app. Check your connection."));
    document.body.appendChild(s);
  });
}
function watchTheme() {
  // Saves the dark/light choice and the colour to the account, so they follow you to other devices.
  const cur = () => ({ theme: document.documentElement.getAttribute("data-theme"), accent: document.documentElement.getAttribute("data-accent") || "ember" });
  let last = JSON.stringify(cur());
  new MutationObserver(async () => {
    const now = cur(), key = JSON.stringify(now); if (key === last || !D.uid) return; last = key;
    try {
      const { data: st } = await sb.from("user_settings").select("data").eq("user_id", D.uid).maybeSingle();
      await sb.from("user_settings").upsert({ user_id: D.uid, data: { ...(st?.data || {}), ...now } });
    } catch {}
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
}
async function logOut() {
  try { await Promise.race([flush(), new Promise((r) => setTimeout(r, 4000))]); } catch {}
  const uid = D.uid;
  if (uid) { lsDel(`${APP_KEY}.cloud.${uid}`); lsDel(`${APP_KEY}.signed.${uid}`); }
  try { Object.keys(localStorage).filter((k) => k.startsWith("planner.") && k !== "planner.theme" && k !== "planner.accent").forEach(lsDel); } catch {}
  try { sessionStorage.setItem(`${APP_KEY}.loggedout`, "1"); } catch {}
  try { await sb.auth.signOut(); } catch {}
  user = null; D.uid = null;
  location.reload();
}

(async () => {
  if (!configured) return renderSetupNeeded();
  let loggedOut = false; try { loggedOut = sessionStorage.getItem(`${APP_KEY}.loggedout`) === "1"; sessionStorage.removeItem(`${APP_KEY}.loggedout`); } catch {}
  onAuth((event, u) => {
    if (event === "PASSWORD_RECOVERY") openNewPassword();
    else if (event === "SIGNED_IN" && u && !appStarted) setTimeout(startSignedIn, 0);
    else if (event === "SIGNED_OUT" && appStarted) { try { sessionStorage.setItem(`${APP_KEY}.loggedout`, "1"); } catch {} location.reload(); }
  });
  if (await currentUser()) startSignedIn(); else renderAuth("login", loggedOut ? "You're logged out." : "");
})();
})();
