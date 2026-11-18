import { firebaseConfig } from "./firebase-config.js";
import { createLocalStore } from "./store-local.js";

/* ---------- 便利な関数 ---------- */
const COLORS = ["#e5484d", "#f76b15", "#e2a300", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#8d8d8d"];
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
const fmtDate = (s) => {
  const d = parse(s);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
};
const fmtShort = (s) => {
  const d = parse(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
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
const isConfigured = (c) => c && typeof c.apiKey === "string" && c.apiKey && !c.apiKey.startsWith("YOUR_");
const timeLabel = (e) => (e.allDay ? "終日" : e.start ? e.start + (e.end ? `〜${e.end}` : "") : "時間未定");
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
  month: todayStr().slice(0, 7),
  selected: todayStr(),
  hidden: new Set(),
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
  $("#fab").hidden = !on;
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

// 表示中の月と「今日から7日間」がカバーできる範囲の予定だけを読み込む
function ensureEventRange() {
  const t = todayStr();
  const mStart = `${state.month}-01`;
  const from = [addDays(mStart, -7), t].sort()[0];
  const to = [addDays(monthEnd(state.month), 7), addDays(t, UPCOMING_DAYS + 1)].sort()[1];
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
function renderSetup() {
  showChrome(false);
  setMain(`
    <section class="card center">
      <h2>Firebase がまだ設定されていません</h2>
      <p>家族と予定を共有するには、README の手順で Firebase を設定してください。</p>
      <p>設定する前に、この端末だけで動く<strong>デモ</strong>を試せます。</p>
      <a class="btn primary" href="?demo">デモで試す</a>
    </section>`);
}

function renderLogin() {
  showChrome(false);
  setMain(`
    <section class="card center">
      <h2>ようこそ</h2>
      <p>家族の予定を共有するアプリです。<br>Google アカウントでログインしてください。</p>
      <button class="btn primary" data-act="signIn">Google でログイン</button>
    </section>`);
}

function renderNotAllowed() {
  showChrome(false);
  setMain(`
    <section class="card center">
      <h2>まだ利用が許可されていません</h2>
      <p><strong>${esc(state.user.email)}</strong> でログインしています。</p>
      <p>管理者に、このメールアドレスを「アクセスできる人」に追加してもらってください。追加されたら再読み込みすると使えます。</p>
      <div class="btn-row">
        <button class="btn primary" data-act="reload">再読み込み</button>
        <button class="btn" data-act="signOut">別のアカウントでログイン</button>
      </div>
    </section>`);
}

function renderMessage(title, body, withSignOut = false) {
  showChrome(false);
  setMain(`
    <section class="card center">
      <h2>${esc(title)}</h2>
      <p>${esc(body)}</p>
      <div class="btn-row">
        <button class="btn primary" data-act="reload">再読み込み</button>
        ${withSignOut ? '<button class="btn" data-act="signOut">ログアウト</button>' : ""}
      </div>
    </section>`);
}

/* ---------- メイン画面 ---------- */
function render() {
  if (!state.user) return;
  ensureEventRange();
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  $("#fab").hidden = state.tab === "settings";
  if (state.tab === "home") renderHome();
  else if (state.tab === "calendar") renderCalendar();
  else renderSettings();
}

const memberById = (id) => state.members.find((m) => m.id === id);
const eventColor = (e) => (e.memberIds.map(memberById).find(Boolean) || { color: "#8d8d8d" }).color;

function memberDots(e, exceptId) {
  const others = e.memberIds.filter((id) => id !== exceptId).map(memberById).filter(Boolean);
  if (!others.length) return "";
  return `<span class="with">${others
    .map((m) => `<span class="dot" style="--c:${m.color}" title="${esc(m.name)}"></span>${esc(m.name)}`)
    .join(" ")}</span>`;
}

function eventItem(e, { showDate = false, exceptId = null } = {}) {
  return `<li><button class="ev" type="button" data-ev="${esc(e.id)}" style="--c:${eventColor(e)}">
      <span class="ev-time">${showDate ? `<b>${fmtShort(e.date)}</b>` : ""}${timeLabel(e)}</span>
      <span class="ev-title">${esc(e.title)}</span>
      ${memberDots(e, exceptId)}
    </button></li>`;
}

function emptyMembers() {
  return `<section class="card center">
      <h2>はじめに家族を追加しましょう</h2>
      <p>「家族・設定」から、予定を管理したい家族を追加できます。人数は自由です。</p>
      <button class="btn primary" data-act="addMember">家族を追加</button>
    </section>`;
}

function renderHome() {
  if (!state.members.length) return setMain(emptyMembers());
  const t = todayStr();
  const end = addDays(t, UPCOMING_DAYS);
  const cards = state.members
    .map((m) => {
      const mine = state.events.filter((e) => e.memberIds.includes(m.id));
      const today = sortEvents(mine.filter((e) => e.date === t));
      const next = sortEvents(mine.filter((e) => e.date > t && e.date <= end));
      return `<section class="card member-card" style="--c:${m.color}">
          <h2><span class="avatar">${esc([...m.name][0] || "?")}</span>${esc(m.name)}
            <span class="count">今日 ${today.length}件</span></h2>
          <h3>今日</h3>
          ${today.length ? `<ul class="evs">${today.map((e) => eventItem(e, { exceptId: m.id })).join("")}</ul>` : '<p class="none">予定なし</p>'}
          <h3>これから（${UPCOMING_DAYS}日間）</h3>
          ${next.length ? `<ul class="evs">${next.map((e) => eventItem(e, { showDate: true, exceptId: m.id })).join("")}</ul>` : '<p class="none">予定なし</p>'}
        </section>`;
    })
    .join("");
  setMain(`<p class="page-label">今日 ${fmtDate(t)}</p><div class="member-grid">${cards}</div>`);
}

function visibleEventsOn(date) {
  return sortEvents(
    state.events.filter(
      (e) =>
        e.date === date &&
        (e.memberIds.some((id) => memberById(id) && !state.hidden.has(id)) || !e.memberIds.some(memberById)),
    ),
  );
}

function renderCalendar() {
  const t = todayStr();
  const [y, m] = state.month.split("-").map(Number);
  const offset = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();

  let cells = WD.map((w, i) => `<div class="wd dow${i}">${w}</div>`).join("");
  for (let i = 0; i < offset; i++) cells += '<div class="cell blank"></div>';
  for (let d = 1; d <= days; d++) {
    const ds = `${state.month}-${pad(d)}`;
    const evs = visibleEventsOn(ds);
    const dow = (offset + d - 1) % 7;
    const chips = evs
      .slice(0, 3)
      .map((e) => `<span class="chip" style="--c:${eventColor(e)}">${esc(e.title)}</span>`)
      .join("");
    const more = evs.length > 3 ? `<span class="more">+${evs.length - 3}</span>` : "";
    cells += `<button type="button" class="cell dow${dow}${ds === t ? " today" : ""}${ds === state.selected ? " sel" : ""}"
        data-day="${ds}" aria-label="${fmtDate(ds)} 予定${evs.length}件">
        <span class="num">${d}</span><span class="chips">${chips}${more}</span></button>`;
  }

  const filters = state.members
    .map(
      (mm) => `<button type="button" class="filter${state.hidden.has(mm.id) ? " off" : ""}" data-filter="${esc(mm.id)}"
        style="--c:${mm.color}" aria-pressed="${!state.hidden.has(mm.id)}"><span class="dot"></span>${esc(mm.name)}</button>`,
    )
    .join("");

  const sel = visibleEventsOn(state.selected);
  setMain(`
    <div class="cal-head">
      <button type="button" class="icon-btn" data-month="-1" aria-label="前の月">‹</button>
      <h2>${y}年${m}月</h2>
      <button type="button" class="icon-btn" data-month="1" aria-label="次の月">›</button>
      <button type="button" class="btn small" data-act="thisMonth">今日</button>
    </div>
    ${filters ? `<div class="filters">${filters}</div>` : ""}
    <div class="cal">${cells}</div>
    <section class="card day-detail">
      <h2>${fmtDate(state.selected)}</h2>
      ${sel.length ? `<ul class="evs">${sel.map((e) => eventItem(e)).join("")}</ul>` : '<p class="none">予定はありません</p>'}
      <button class="btn" data-act="addOnDay">＋ この日に予定を追加</button>
    </section>`);
}

function renderSettings() {
  const u = state.user;
  const members = state.members
    .map(
      (m) => `<li class="row-item">
        <span class="avatar" style="--c:${m.color}">${esc([...m.name][0] || "?")}</span>
        <span class="grow">${esc(m.name)}</span>
        <button type="button" class="btn small" data-edit-member="${esc(m.id)}">編集</button>
      </li>`,
    )
    .join("");

  const access = u.isOwner
    ? `<section class="card">
        <h2>アクセスできる人</h2>
        <p class="hint">ここに追加した Google アカウントの人だけが、このアプリを見たり予定を書き込んだりできます。管理者（あなた）は常に使えます。</p>
        <ul class="list">${
          state.allowed.length
            ? state.allowed
                .map(
                  (em) => `<li class="row-item"><span class="grow mono">${esc(em)}</span>
                  <button type="button" class="btn small danger" data-remove-allowed="${esc(em)}">削除</button></li>`,
                )
                .join("")
            : '<li class="none">まだ誰も追加されていません</li>'
        }</ul>
        <form class="inline-form" data-form="allowed">
          <input type="email" name="email" placeholder="家族のGmailアドレス" required autocomplete="off">
          <button class="btn primary">追加</button>
        </form>
      </section>`
    : "";

  const demo =
    state.store.mode === "demo"
      ? `<section class="card">
          <h2>デモモード</h2>
          <p class="hint">データはこの端末（ブラウザ）にだけ保存されています。家族とは共有されません。</p>
          <button class="btn" data-act="resetDemo">サンプルデータに戻す</button>
        </section>`
      : "";

  setMain(`
    <section class="card">
      <h2>家族メンバー</h2>
      <p class="hint">予定を管理する家族です。人数はいくらでも追加できます。</p>
      <ul class="list">${members || '<li class="none">まだいません</li>'}</ul>
      <button class="btn primary" data-act="addMember">＋ 家族を追加</button>
    </section>
    ${access}
    ${demo}
    <section class="card">
      <h2>アカウント</h2>
      <p>${esc(u.name)}<br><span class="hint mono">${esc(u.email)}</span>${u.isOwner ? ' <span class="badge">管理者</span>' : ""}</p>
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
  const first = $("input:not([type=checkbox]):not([type=hidden])", form);
  if (first && !first.value) first.focus();
  return form;
}

function formError(form, msg) {
  const box = $(".form-error", form);
  box.textContent = msg;
  box.hidden = false;
  return false;
}

function openEventDialog(e = null, date = state.selected) {
  if (!state.members.length) {
    toast("先に家族を追加してください");
    state.tab = "settings";
    return render();
  }
  const ev = e || { title: "", date, start: "", end: "", allDay: false, memberIds: [], note: "" };
  const checks = state.members
    .map(
      (m) => `<label class="pick" style="--c:${m.color}">
        <input type="checkbox" name="member" value="${esc(m.id)}" ${ev.memberIds.includes(m.id) ? "checked" : ""}>
        <span>${esc(m.name)}</span></label>`,
    )
    .join("");

  const form = openDialog(
    `<h2>${e ? "予定を編集" : "予定を追加"}</h2>
    <label class="field">タイトル<input name="title" maxlength="100" value="${esc(ev.title)}" placeholder="例：歯医者、塾、飲み会"></label>
    <label class="field">日付<input type="date" name="date" value="${esc(ev.date)}"></label>
    <label class="switch"><input type="checkbox" name="allDay" ${ev.allDay ? "checked" : ""}> 終日</label>
    <div class="times"${ev.allDay ? " hidden" : ""}>
      <label class="field">開始<input type="time" name="start" value="${esc(ev.start)}"></label>
      <label class="field">終了<input type="time" name="end" value="${esc(ev.end)}"></label>
    </div>
    <fieldset class="field"><legend>だれの予定？（複数選べます）</legend><div class="picks">${checks}</div></fieldset>
    <label class="field">メモ<textarea name="note" maxlength="1000" rows="3">${esc(ev.note)}</textarea></label>
    <p class="form-error" hidden></p>
    <div class="dlg-actions">
      ${e ? '<button type="button" class="btn danger" data-del>削除</button>' : ""}
      <span class="grow"></span>
      <button type="button" class="btn" data-close>キャンセル</button>
      <button class="btn primary">保存</button>
    </div>`,
    async (f) => {
      const title = f.title.value.trim();
      const allDay = f.allDay.checked;
      const start = allDay ? "" : f.start.value;
      const end = allDay ? "" : f.end.value;
      const memberIds = [...f.querySelectorAll("input[name=member]:checked")].map((i) => i.value);
      if (!title) return formError(f, "タイトルを入力してください");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date.value)) return formError(f, "日付を選んでください");
      if (!memberIds.length) return formError(f, "だれの予定か選んでください");
      if (start && end && end < start) return formError(f, "終了時刻が開始時刻より前になっています");
      const data = { title, date: f.date.value, start, end, allDay, memberIds, note: f.note.value.trim() };
      await state.store.saveEvent(e ? { id: e.id, ...data } : data);
      state.selected = data.date;
      toast(e ? "予定を更新しました" : "予定を追加しました");
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
    (c) => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === color ? "checked" : ""}
      aria-label="色 ${c}"><span></span></label>`,
  ).join("");

  const form = openDialog(
    `<h2>${m ? "家族を編集" : "家族を追加"}</h2>
    <label class="field">名前<input name="name" maxlength="30" value="${esc(m ? m.name : "")}" placeholder="例：パパ、ママ、ゆい"></label>
    <fieldset class="field"><legend>色</legend><div class="swatches">${swatches}</div></fieldset>
    <p class="form-error" hidden></p>
    <div class="dlg-actions">
      ${m ? '<button type="button" class="btn danger" data-del>削除</button>' : ""}
      <span class="grow"></span>
      <button type="button" class="btn" data-close>キャンセル</button>
      <button class="btn primary">保存</button>
    </div>`,
    async (f) => {
      const name = f.name.value.trim();
      if (!name) return formError(f, "名前を入力してください");
      const order = m ? m.order : Math.max(0, ...state.members.map((x) => x.order || 0)) + 1;
      await state.store.saveMember({ ...(m ? { id: m.id } : {}), name, color: f.color.value, order });
      toast(m ? "更新しました" : `${name}さんを追加しました`);
    },
  );

  const del = $("[data-del]", form);
  if (del)
    del.addEventListener("click", async () => {
      if (!confirm(`「${m.name}」を削除しますか？\nこの人だけの予定は表示されなくなります。`)) return;
      try {
        await state.store.deleteMember(m.id);
        state.hidden.delete(m.id);
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
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (t.closest("#fab")) return openEventDialog(null, state.tab === "calendar" ? state.selected : todayStr());

  const evBtn = t.closest("[data-ev]");
  if (evBtn) {
    const e = state.events.find((x) => x.id === evBtn.dataset.ev);
    if (e) openEventDialog(e);
    return;
  }
  const day = t.closest("[data-day]");
  if (day) {
    state.selected = day.dataset.day;
    return render();
  }
  const mon = t.closest("[data-month]");
  if (mon) {
    state.month = shiftMonth(state.month, Number(mon.dataset.month));
    state.selected = `${state.month}-01`;
    return render();
  }
  const filter = t.closest("[data-filter]");
  if (filter) {
    const id = filter.dataset.filter;
    state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
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
    case "addOnDay":
      openEventDialog(null, state.selected);
      break;
    case "thisMonth":
      state.month = todayStr().slice(0, 7);
      state.selected = todayStr();
      render();
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
    toast(`${email} を追加しました`);
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
