import { firebaseConfig } from "./firebase-config.js";
import { createLocalStore } from "./store-local.js";

/* ---------- 便利な関数 ---------- */
// 落ち着いた色（家族ごとの目印に使う）
const COLORS = ["#a3624f", "#4f6d87", "#6f7f4d", "#86668f", "#a8843d", "#4d837b", "#8f5b6c", "#6b6862"];
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const UPCOMING_DAYS = 7;

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const todayStr = () => ymd(new Date());
const dow = (s) => parse(s).getDay();
const fmtDate = (s) => {
  const d = parse(s);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
};
const fmtShort = (s) => {
  const d = parse(s);
  return `${d.getMonth() + 1}/${d.getDate()} ${WD[d.getDay()]}`;
};
const monthEnd = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return ymd(new Date(y, m, 0));
};
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const toMin = (hm) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (n) => `${pad(Math.floor(n / 60) % 24)}:${pad(n % 60)}`;
const isConfigured = (c) => c && typeof c.apiKey === "string" && c.apiKey && !c.apiKey.startsWith("YOUR_");
const timeLabel = (e) => (e.allDay ? "終日" : e.start ? e.start + (e.end ? `–${e.end}` : "") : "");
const sortEvents = (list) =>
  [...list].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(b.allDay) - Number(a.allDay) ||
      (a.start || "99").localeCompare(b.start || "99") ||
      a.title.localeCompare(b.title),
  );

/* ---------- アプリの状態 ---------- */
const state = {
  store: null,
  user: null,
  members: [],
  events: [],
  allowed: [],
  tab: "home",
  month: todayStr().slice(0, 7), // カレンダーで表示中の月
  day: null, // バーチカル表示中の日付（null なら月表示）
  range: null,
  unsub: {},
};

const main = $("#main");
const dlg = $("#dlg");

function setMain(html) {
  main.innerHTML = html;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

function fail(e) {
  console.error(e);
  const denied = e && e.code === "permission-denied";
  toast(denied ? "権限がありません（管理者に確認してください）" : "保存できませんでした。通信状況を確認してください");
}

function stopAll() {
  Object.values(state.unsub).forEach((f) => f && f());
  state.unsub = {};
  state.range = null;
}

function showChrome(on) {
  $("#tabs").hidden = !on;
  $("#addBtn").hidden = !on;
}

/* ---------- 起動 ---------- */
async function boot() {
  const demo = new URLSearchParams(location.search).has("demo");
  if (demo) return startStore(createLocalStore());
  if (!isConfigured(firebaseConfig)) return renderSetup();
  try {
    const { createFirebaseStore } = await import("./store-firebase.js");
    startStore(await createFirebaseStore(firebaseConfig));
  } catch (e) {
    console.error(e);
    renderMessage("読み込みに失敗しました", "インターネット接続を確認して、ページを再読み込みしてください。");
  }
}

function startStore(store) {
  state.store = store;
  $("#modeBadge").hidden = store.mode !== "demo";
  store.onAuth((a) => {
    stopAll();
    state.user = a.user || null;
    if (a.status === "signedOut") return renderLogin();
    if (a.status === "notAllowed") return renderNotAllowed();
    if (a.status === "error")
      return renderMessage("接続できませんでした", "通信状況を確認して、ページを再読み込みしてください。", true);
    startApp();
  });
}

function startApp() {
  showChrome(true);
  state.unsub.members = state.store.subscribeMembers(
    (list) => {
      state.members = list;
      render();
    },
    (e) => fail(e),
  );
  if (state.user.isOwner) {
    state.unsub.allowed = state.store.subscribeAllowed(
      (list) => {
        state.allowed = list.sort();
        if (state.tab === "settings") render();
      },
      (e) => fail(e),
    );
  }
  render();
}

// 表示中の月（前後の週を含む）と「今日から7日間」がカバーできる範囲の予定だけを読み込む
function ensureEventRange() {
  const t = todayStr();
  const from = [addDays(`${state.month}-01`, -7), t].sort()[0];
  const to = [addDays(monthEnd(state.month), 7), addDays(t, UPCOMING_DAYS)].sort()[1];
  const key = `${from}_${to}`;
  if (state.range === key) return;
  state.range = key;
  state.unsub.events && state.unsub.events();
  state.unsub.events = state.store.subscribeEvents(
    from,
    to,
    (list) => {
      state.events = list;
      render();
    },
    (e) => fail(e),
  );
}

/* ---------- ログイン前の画面 ---------- */
function notice(inner) {
  setMain(`<section class="notice">${inner}</section>`);
}

function renderSetup() {
  showChrome(false);
  notice(`
    <h2>Firebase がまだ設定されていません</h2>
    <p>家族と予定を共有するには、README の手順で Firebase を設定してください。</p>
    <p>設定する前に、この端末だけで動くデモを試せます。</p>
    <a class="btn primary" href="?demo">デモで試す</a>`);
}

function renderLogin() {
  showChrome(false);
  notice(`
    <h2>ようこそ</h2>
    <p>家族の予定を共有する予定表です。<br>Google アカウントでログインしてください。</p>
    <button class="btn primary" data-act="signIn">Google でログイン</button>`);
}

function renderNotAllowed() {
  showChrome(false);
  notice(`
    <h2>まだ利用が許可されていません</h2>
    <p><strong>${esc(state.user.email)}</strong> でログインしています。</p>
    <p>管理者に、このメールアドレスを「アクセスできる人」に追加してもらってください。追加されたら再読み込みすると使えます。</p>
    <div class="btn-row">
      <button class="btn primary" data-act="reload">再読み込み</button>
      <button class="btn" data-act="signOut">別のアカウントでログイン</button>
    </div>`);
}

function renderMessage(title, body, withSignOut = false) {
  showChrome(false);
  notice(`
    <h2>${esc(title)}</h2>
    <p>${esc(body)}</p>
    <div class="btn-row">
      <button class="btn primary" data-act="reload">再読み込み</button>
      ${withSignOut ? '<button class="btn" data-act="signOut">ログアウト</button>' : ""}
    </div>`);
}

/* ---------- メイン画面 ---------- */
function render() {
  if (!state.user) return;
  ensureEventRange();
  document
    .querySelectorAll("#tabs button")
    .forEach((b) => b.setAttribute("aria-current", b.dataset.tab === state.tab ? "page" : "false"));
  if (state.tab === "home") renderHome();
  else if (state.tab === "calendar") state.day ? renderDay() : renderMonth();
  else renderSettings();
}

const memberById = (id) => state.members.find((m) => m.id === id);

function withText(e, exceptId) {
  const others = e.memberIds
    .filter((id) => id !== exceptId)
    .map(memberById)
    .filter(Boolean);
  return others.length ? `<span class="with">${others.map((m) => esc(m.name)).join("・")}と</span>` : "";
}

function line(e, { showDate = false, exceptId = null } = {}) {
  const time = timeLabel(e);
  return `<li><button class="line" type="button" data-ev="${esc(e.id)}">
      <span class="when">${showDate ? `<span class="d">${fmtShort(e.date)}</span>` : ""}${time ? `<span class="t">${time}</span>` : ""}</span>
      <span class="what">${esc(e.title)}${withText(e, exceptId)}</span>
    </button></li>`;
}

function emptyMembers() {
  return `<section class="notice">
      <h2>はじめに家族を登録しましょう</h2>
      <p>「家族」のページから、予定を書き込む家族を登録できます。人数に決まりはありません。</p>
      <button class="btn primary" data-act="addMember">家族を登録する</button>
    </section>`;
}

function renderHome() {
  if (!state.members.length) return setMain(emptyMembers());
  const t = todayStr();
  const d = parse(t);
  const end = addDays(t, UPCOMING_DAYS);
  const people = state.members
    .map((m) => {
      const mine = state.events.filter((e) => e.memberIds.includes(m.id));
      const today = sortEvents(mine.filter((e) => e.date === t));
      const next = sortEvents(mine.filter((e) => e.date > t && e.date <= end));
      return `<section class="person" style="--c:${m.color}">
          <h2><span class="mark"></span>${esc(m.name)}</h2>
          ${today.length ? `<ul class="lines">${today.map((e) => line(e, { exceptId: m.id })).join("")}</ul>` : '<p class="none">今日の予定はありません</p>'}
          <p class="sub">これからの予定</p>
          ${next.length ? `<ul class="lines">${next.map((e) => line(e, { showDate: true, exceptId: m.id })).join("")}</ul>` : '<p class="none">一週間、予定はありません</p>'}
        </section>`;
    })
    .join("");
  setMain(`
    <div class="date-head">
      <span class="date-big">${d.getMonth() + 1}月${d.getDate()}日</span>
      <span class="date-wd">${WD[d.getDay()]}曜日</span>
    </div>
    <div class="people">${people}</div>`);
}

const eventColor = (e) => (e.memberIds.map(memberById).find(Boolean) || { color: "#8a857c" }).color;
const eventNames = (e) => {
  const names = e.memberIds.map(memberById).filter(Boolean).map((m) => m.name);
  return names.length > 2 ? `${names[0]}ほか` : names.join("・");
};
const eventsOn = (date) => sortEvents(state.events.filter((e) => e.date === date));

/* ----- 月のカレンダー ----- */
function renderMonth() {
  const t = todayStr();
  const [y, m] = state.month.split("-").map(Number);
  const first = `${state.month}-01`;
  const lead = dow(first);
  const days = Number(monthEnd(state.month).slice(8));
  const weeks = Math.ceil((lead + days) / 7);
  const start = addDays(first, -lead);

  let cells = WD.map((w, i) => `<div class="wd dow${i}">${w}</div>`).join("");
  for (let i = 0; i < weeks * 7; i++) {
    const ds = addDays(start, i);
    const evs = eventsOn(ds);
    const chips = evs
      .slice(0, 3)
      .map(
        (e) =>
          `<span class="chip" style="--c:${eventColor(e)}"><span class="who">${esc(eventNames(e))}</span>${esc(e.title)}</span>`,
      )
      .join("");
    const more = evs.length > 3 ? `<span class="more">ほか${evs.length - 3}件</span>` : "";
    const out = ds.slice(0, 7) !== state.month;
    cells += `<button type="button" class="cell dow${i % 7}${out ? " out" : ""}${ds === t ? " today" : ""}"
        data-day="${ds}" aria-label="${fmtDate(ds)} 予定${evs.length}件">
        <span class="num">${Number(ds.slice(8))}</span><span class="chips">${chips}${more}</span></button>`;
  }

  setMain(`
    <div class="cal-nav">
      <button type="button" class="nav-btn" data-month="-1" aria-label="前の月">‹</button>
      <h2>${y}年${m}月</h2>
      <button type="button" class="nav-btn" data-month="1" aria-label="次の月">›</button>
      ${state.month !== t.slice(0, 7) ? '<button type="button" class="btn small" data-act="thisMonth">今日</button>' : ""}
    </div>
    <div class="month" style="--weeks:${weeks}">${cells}</div>
    <p class="hint center">日付をタップすると、その日の予定を家族ごとに縦に並べて表示します。</p>`);
}

/* ----- 1日のバーチカル表示 ----- */
const HOUR_PX = 56;

// 同じ人の予定が時間で重なったら、横に並べる
function layoutColumn(list) {
  const items = list
    .map((e) => {
      const s = toMin(e.start);
      const en = Math.min(e.end && e.end > e.start ? toMin(e.end) : s + 60, 24 * 60);
      return { e, s, en };
    })
    .sort((a, b) => a.s - b.s || b.en - a.en);
  let group = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = [];
    group.forEach((it) => {
      let i = lanes.findIndex((end) => end <= it.s);
      if (i < 0) i = lanes.push(0) - 1;
      lanes[i] = it.en;
      it.lane = i;
    });
    group.forEach((it) => (it.lanes = lanes.length));
    group = [];
  };
  items.forEach((it) => {
    if (group.length && it.s >= groupEnd) flush();
    group.push(it);
    groupEnd = Math.max(groupEnd, it.en);
  });
  flush();
  return items;
}

function renderDay() {
  if (!state.members.length) return setMain(emptyMembers());
  const ds = state.day;
  const t = todayStr();
  const evs = state.events.filter((e) => e.date === ds);
  const isTimed = (e) => !e.allDay && e.start;

  // 表示する時間帯（基本は 7時〜22時、予定があれば広げる）
  let h0 = 7;
  let h1 = 22;
  evs.filter(isTimed).forEach((e) => {
    const s = toMin(e.start);
    const en = e.end && e.end > e.start ? toMin(e.end) : s + 60;
    h0 = Math.min(h0, Math.floor(s / 60));
    h1 = Math.max(h1, Math.ceil(en / 60));
  });
  h1 = Math.min(h1, 24);
  const px = (min) => ((min - h0 * 60) * HOUR_PX) / 60;
  const height = (h1 - h0) * HOUR_PX;

  const head = state.members
    .map((m) => `<div class="vh" style="--c:${m.color}"><span class="mark"></span>${esc(m.name)}</div>`)
    .join("");

  const allDay = state.members
    .map((m) => {
      const list = sortEvents(evs.filter((e) => !isTimed(e) && e.memberIds.includes(m.id)));
      return `<div class="va" data-allday="${esc(m.id)}" style="--c:${m.color}">${list
        .map(
          (e) =>
            `<button type="button" class="vchip" data-ev="${esc(e.id)}">${e.allDay ? "" : '<span class="t">時間未定</span>'}${esc(e.title)}</button>`,
        )
        .join("")}</div>`;
    })
    .join("");

  const hours = Array.from({ length: h1 - h0 }, (_, i) => `<span style="top:${i * HOUR_PX}px">${h0 + i}:00</span>`).join("");

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const nowLine =
    ds === t && nowMin >= h0 * 60 && nowMin <= h1 * 60 ? `<div class="now" style="top:${px(nowMin)}px"></div>` : "";

  const cols = state.members
    .map((m) => {
      const blocks = layoutColumn(evs.filter((e) => isTimed(e) && e.memberIds.includes(m.id)))
        .map(({ e, s, en, lane, lanes }) => {
          const top = px(s);
          const h = Math.max(px(en) - top, 24);
          const others = e.memberIds.filter((id) => id !== m.id).map(memberById).filter(Boolean);
          return `<button type="button" class="vev${h < 44 ? " short" : ""}" data-ev="${esc(e.id)}"
              style="top:${top}px;height:${h}px;left:calc(${lane} / ${lanes} * 100%);width:calc(100% / ${lanes})">
              ${
                h < 44
                  ? `<span class="ttl" title="${timeLabel(e)}">${esc(e.title)}</span>`
                  : `<span class="t">${timeLabel(e)}</span><span class="ttl">${esc(e.title)}</span>${
                      others.length ? `<span class="w">${others.map((o) => esc(o.name)).join("・")}と</span>` : ""
                    }`
              }</button>`;
        })
        .join("");
      return `<div class="vcol" data-vcol="${esc(m.id)}" data-h0="${h0}" style="--c:${m.color};height:${height}px">${blocks}${nowLine}</div>`;
    })
    .join("");

  setMain(`
    <div class="day-nav">
      <button type="button" class="btn small" data-act="backMonth">‹ ${Number(ds.slice(5, 7))}月のカレンダー</button>
      <span class="grow"></span>
      <button type="button" class="nav-btn" data-dayshift="-1" aria-label="前の日">‹</button>
      <button type="button" class="nav-btn" data-dayshift="1" aria-label="次の日">›</button>
    </div>
    <h2 class="day-title${ds === t ? " is-today" : ""}">${fmtDate(ds)}${ds === t ? '<span class="tag">今日</span>' : ""}</h2>
    <div class="vwrap">
      <div class="vert" style="--cols:${state.members.length}; --hour:${HOUR_PX}px">
        <div class="vrow vhead"><div class="corner"></div>${head}</div>
        <div class="vrow vall"><div class="vlabel">終日</div>${allDay}</div>
        <div class="vrow vbody"><div class="vtimes" style="height:${height}px">${hours}</div>${cols}</div>
      </div>
    </div>
    <p class="hint center">空いている時間を押すと、その人のその時間に予定を書き込めます。</p>`);
}

function openDay(ds) {
  if (!state.day) history.pushState({ day: true }, "");
  state.day = ds;
  state.month = ds.slice(0, 7);
  render();
  window.scrollTo(0, 0);
}

function closeDay() {
  if (history.state && history.state.day) return history.back();
  state.day = null;
  render();
}

window.addEventListener("popstate", () => {
  if (state.day) {
    state.day = null;
    render();
  }
});

function renderSettings() {
  const u = state.user;
  const members = state.members
    .map(
      (m) => `<li class="row" style="--c:${m.color}">
        <span class="mark"></span>
        <span class="grow">${esc(m.name)}</span>
        <button type="button" class="btn small" data-edit-member="${esc(m.id)}">編集</button>
      </li>`,
    )
    .join("");

  const access = u.isOwner
    ? `<section class="block">
        <h2>アクセスできる人</h2>
        <p class="hint">ここに登録した Google アカウントの人だけが、この予定表を見たり書き込んだりできます。管理者（あなた）は常に使えます。</p>
        <ul class="rows">${
          state.allowed.length
            ? state.allowed
                .map(
                  (em) => `<li class="row"><span class="grow mono">${esc(em)}</span>
                  <button type="button" class="btn small danger" data-remove-allowed="${esc(em)}">取り消す</button></li>`,
                )
                .join("")
            : '<li class="none">まだ誰も登録されていません</li>'
        }</ul>
        <form class="inline-form" data-form="allowed">
          <input type="email" name="email" placeholder="家族の Gmail アドレス" required autocomplete="off">
          <button class="btn">登録</button>
        </form>
      </section>`
    : "";

  const demo =
    state.store.mode === "demo"
      ? `<section class="block">
          <h2>デモモード</h2>
          <p class="hint">データはこの端末（ブラウザ）にだけ保存されています。家族とは共有されません。</p>
          <button class="btn" data-act="resetDemo">サンプルデータに戻す</button>
        </section>`
      : "";

  setMain(`
    <section class="block">
      <h2>家族</h2>
      <p class="hint">予定を書き込む家族です。何人でも登録できます。</p>
      <ul class="rows">${members || '<li class="none">まだ登録されていません</li>'}</ul>
      <button class="btn" data-act="addMember">＋ 家族を登録</button>
    </section>
    ${access}
    ${demo}
    <section class="block">
      <h2>アカウント</h2>
      <p>${esc(u.name)}${u.isOwner ? ' <span class="tag">管理者</span>' : ""}<br><span class="hint mono">${esc(u.email)}</span></p>
      ${state.store.mode === "demo" ? '<a class="btn" href="./">デモを終了</a>' : '<button class="btn" data-act="signOut">ログアウト</button>'}
    </section>`);
}

/* ---------- ダイアログ ---------- */
function openDialog(html, onSubmit) {
  dlg.innerHTML = `<form class="dlg-form" novalidate>${html}</form>`;
  const form = $("form", dlg);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("button.primary", form);
    btn.disabled = true;
    try {
      if ((await onSubmit(form)) !== false) dlg.close();
    } catch (e) {
      fail(e);
    } finally {
      btn.disabled = false;
    }
  });
  form.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-close]")) dlg.close();
  });
  form.addEventListener("input", () => {
    const err = $(".form-error", form);
    if (err) err.hidden = true;
  });
  dlg.showModal();
  const first = $("input:not([type=checkbox]):not([type=radio])", form);
  if (first && !first.value) first.focus();
  return form;
}

function formError(form, msg) {
  const box = $(".form-error", form);
  box.textContent = msg;
  box.hidden = false;
  return false;
}

function openEventDialog(e = null, date = todayStr(), memberId = null, preset = {}) {
  if (!state.members.length) {
    toast("先に家族を登録してください");
    state.tab = "settings";
    return render();
  }
  const ev = e || {
    title: "",
    date,
    start: "",
    end: "",
    allDay: false,
    memberIds: memberId ? [memberId] : [],
    note: "",
    ...preset,
  };
  const checks = state.members
    .map(
      (m) => `<label class="pick" style="--c:${m.color}">
        <input type="checkbox" name="member" value="${esc(m.id)}" ${ev.memberIds.includes(m.id) ? "checked" : ""}>
        <span class="mark"></span><span>${esc(m.name)}</span></label>`,
    )
    .join("");

  const form = openDialog(
    `<h2>${e ? "予定を直す" : "予定を書く"}</h2>
    <label class="field">何をする？<input name="title" maxlength="100" value="${esc(ev.title)}" placeholder="例：歯医者、塾、飲み会"></label>
    <label class="field">日付<input type="date" name="date" value="${esc(ev.date)}"></label>
    <label class="check"><input type="checkbox" name="allDay" ${ev.allDay ? "checked" : ""}> 一日中</label>
    <div class="times"${ev.allDay ? " hidden" : ""}>
      <label class="field">はじまり<input type="time" name="start" value="${esc(ev.start)}"></label>
      <label class="field">おわり<input type="time" name="end" value="${esc(ev.end)}"></label>
    </div>
    <fieldset class="field"><legend>だれの予定？</legend><div class="picks">${checks}</div></fieldset>
    <label class="field">メモ<textarea name="note" maxlength="1000" rows="2">${esc(ev.note)}</textarea></label>
    <p class="form-error" hidden></p>
    <div class="dlg-actions">
      ${e ? '<button type="button" class="btn danger" data-del>削除</button>' : ""}
      <span class="grow"></span>
      <button type="button" class="btn" data-close>やめる</button>
      <button class="btn primary">保存</button>
    </div>`,
    async (f) => {
      const title = f.title.value.trim();
      const allDay = f.allDay.checked;
      const start = allDay ? "" : f.start.value;
      const end = allDay ? "" : f.end.value;
      const memberIds = [...f.querySelectorAll("input[name=member]:checked")].map((i) => i.value);
      if (!title) return formError(f, "何をするか書いてください");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date.value)) return formError(f, "日付を選んでください");
      if (!memberIds.length) return formError(f, "だれの予定か選んでください");
      if (start && end && end < start) return formError(f, "おわりの時刻が、はじまりより前になっています");
      const data = { title, date: f.date.value, start, end, allDay, memberIds, note: f.note.value.trim() };
      await state.store.saveEvent(e ? { id: e.id, ...data } : data);
      toast(e ? "予定を直しました" : "予定を書きました");
    },
  );

  form.allDay.addEventListener("change", () => ($(".times", form).hidden = form.allDay.checked));
  const del = $("[data-del]", form);
  if (del)
    del.addEventListener("click", async () => {
      if (!confirm(`「${e.title}」を削除しますか？`)) return;
      try {
        await state.store.deleteEvent(e.id);
        dlg.close();
        toast("予定を削除しました");
      } catch (err) {
        fail(err);
      }
    });
}

function openMemberDialog(m = null) {
  const used = new Set(state.members.map((x) => x.color));
  const color = m ? m.color : COLORS.find((c) => !used.has(c)) || COLORS[state.members.length % COLORS.length];
  const swatches = COLORS.map(
    (c, i) => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === color ? "checked" : ""}
      aria-label="色 ${i + 1}"><span></span></label>`,
  ).join("");

  const form = openDialog(
    `<h2>${m ? "家族を編集" : "家族を登録"}</h2>
    <label class="field">名前<input name="name" maxlength="30" value="${esc(m ? m.name : "")}" placeholder="例：父、母、ゆい"></label>
    <fieldset class="field"><legend>目印の色</legend><div class="swatches">${swatches}</div></fieldset>
    <p class="form-error" hidden></p>
    <div class="dlg-actions">
      ${m ? '<button type="button" class="btn danger" data-del>削除</button>' : ""}
      <span class="grow"></span>
      <button type="button" class="btn" data-close>やめる</button>
      <button class="btn primary">保存</button>
    </div>`,
    async (f) => {
      const name = f.name.value.trim();
      if (!name) return formError(f, "名前を入れてください");
      const order = m ? m.order : Math.max(0, ...state.members.map((x) => x.order || 0)) + 1;
      await state.store.saveMember({ ...(m ? { id: m.id } : {}), name, color: f.color.value, order });
      toast(m ? "変更しました" : `${name}さんを登録しました`);
    },
  );

  const del = $("[data-del]", form);
  if (del)
    del.addEventListener("click", async () => {
      if (!confirm(`「${m.name}」を削除しますか？\nこの人だけの予定は表示されなくなります。`)) return;
      try {
        await state.store.deleteMember(m.id);
        dlg.close();
        toast("削除しました");
      } catch (err) {
        fail(err);
      }
    });
}

/* ---------- 操作 ---------- */
document.addEventListener("click", async (ev) => {
  const t = ev.target;
  if (dlg.open && dlg.contains(t)) return;

  const tab = t.closest("#tabs button");
  if (tab) {
    state.tab = tab.dataset.tab;
    if (state.day) {
      // 「カレンダー」を押したら月表示に戻る
      state.day = null;
      if (history.state && history.state.day) history.replaceState(null, "");
    }
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (t.closest("#addBtn")) return openEventDialog(null, state.tab === "calendar" && state.day ? state.day : todayStr());

  const evBtn = t.closest("[data-ev]");
  if (evBtn) {
    const e = state.events.find((x) => x.id === evBtn.dataset.ev);
    if (e) openEventDialog(e);
    return;
  }
  const day = t.closest("[data-day]");
  if (day) return openDay(day.dataset.day);

  const col = t.closest("[data-vcol]");
  if (col) {
    // 押した位置の時刻（30分単位）で予定を書き始める
    const y = ev.clientY - col.getBoundingClientRect().top;
    const start = Math.min(Number(col.dataset.h0) * 60 + Math.floor((y / HOUR_PX) * 2) * 30, 23 * 60 + 30);
    return openEventDialog(null, state.day, col.dataset.vcol, {
      start: fromMin(start),
      end: fromMin(Math.min(start + 60, 23 * 60 + 59)),
    });
  }
  const ad = t.closest("[data-allday]");
  if (ad) return openEventDialog(null, state.day, ad.dataset.allday, { allDay: true });

  const mon = t.closest("[data-month]");
  if (mon) {
    state.month = shiftMonth(state.month, Number(mon.dataset.month));
    return render();
  }
  const shift = t.closest("[data-dayshift]");
  if (shift) {
    state.day = addDays(state.day, Number(shift.dataset.dayshift));
    state.month = state.day.slice(0, 7);
    return render();
  }
  const editM = t.closest("[data-edit-member]");
  if (editM) return openMemberDialog(memberById(editM.dataset.editMember));

  const rmA = t.closest("[data-remove-allowed]");
  if (rmA) {
    const em = rmA.dataset.removeAllowed;
    if (!confirm(`${em} のアクセスを取り消しますか？`)) return;
    try {
      await state.store.removeAllowed(em);
      toast("取り消しました");
    } catch (e) {
      fail(e);
    }
    return;
  }

  const act = t.closest("[data-act]");
  if (!act) return;
  switch (act.dataset.act) {
    case "signIn":
      try {
        await state.store.signIn();
      } catch (e) {
        console.error(e);
        toast("ログインできませんでした（" + (e.code || "エラー") + "）");
      }
      break;
    case "signOut":
      await state.store.signOut();
      break;
    case "reload":
      location.reload();
      break;
    case "addMember":
      openMemberDialog();
      break;
    case "thisMonth":
      state.month = todayStr().slice(0, 7);
      render();
      break;
    case "backMonth":
      closeDay();
      break;
    case "resetDemo":
      if (confirm("デモのデータをサンプルに戻しますか？")) state.store.reset();
      break;
  }
});

document.addEventListener("submit", async (ev) => {
  const f = ev.target.closest("[data-form=allowed]");
  if (!f) return;
  ev.preventDefault();
  const email = f.email.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("メールアドレスの形が正しくありません");
  try {
    await state.store.addAllowed(email);
    f.reset();
    toast(`${email} を登録しました`);
  } catch (e) {
    fail(e);
  }
});

// 日付が変わったら「今日」を更新する
let lastDay = todayStr();
setInterval(() => {
  if (todayStr() !== lastDay) {
    lastDay = todayStr();
    render();
  }
}, 60_000);

boot();
