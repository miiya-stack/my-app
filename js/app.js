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
// 週の始まり（月曜日）
const weekStartOf = (s) => addDays(s, -((dow(s) + 6) % 7));
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
  week: weekStartOf(todayStr()),
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

// 表示中の週と「今日から7日間」がカバーできる範囲の予定だけを読み込む
function ensureEventRange() {
  const t = todayStr();
  const from = [state.week, t].sort()[0];
  const to = [addDays(state.week, 6), addDays(t, UPCOMING_DAYS)].sort()[1];
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
  else if (state.tab === "week") renderWeek();
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

function renderWeek() {
  if (!state.members.length) return setMain(emptyMembers());
  const t = todayStr();
  const days = Array.from({ length: 7 }, (_, i) => addDays(state.week, i));
  const first = parse(days[0]);
  const last = parse(days[6]);
  const label =
    first.getMonth() === last.getMonth()
      ? `${first.getMonth() + 1}月${first.getDate()}日 – ${last.getDate()}日`
      : `${first.getMonth() + 1}月${first.getDate()}日 – ${last.getMonth() + 1}月${last.getDate()}日`;

  const head = state.members
    .map((m) => `<th scope="col" style="--c:${m.color}"><span class="mark"></span>${esc(m.name)}</th>`)
    .join("");

  const rows = days
    .map((ds) => {
      const d = parse(ds);
      const cells = state.members
        .map((m) => {
          const evs = sortEvents(state.events.filter((e) => e.date === ds && e.memberIds.includes(m.id)));
          const items = evs
            .map((e) => {
              const time = timeLabel(e);
              return `<button type="button" class="slot" data-ev="${esc(e.id)}">${time ? `<span class="t">${time}</span>` : ""}<span class="ttl">${esc(e.title)}</span></button>`;
            })
            .join("");
          return `<td data-cell="${ds}|${esc(m.id)}" style="--c:${m.color}" aria-label="${fmtDate(ds)} ${esc(m.name)} 予定${evs.length}件">${items}</td>`;
        })
        .join("");
      return `<tr class="dow${d.getDay()}${ds === t ? " is-today" : ""}">
          <th scope="row" class="day"><span class="n">${d.getDate()}</span><span class="w">${WD[d.getDay()]}</span></th>
          ${cells}</tr>`;
    })
    .join("");

  setMain(`
    <div class="week-nav">
      <button type="button" class="nav-btn" data-week="-1" aria-label="前の週">‹</button>
      <h2>${first.getFullYear()}年 ${label}</h2>
      <button type="button" class="nav-btn" data-week="1" aria-label="次の週">›</button>
      ${state.week !== weekStartOf(t) ? '<button type="button" class="btn small" data-act="thisWeek">今週</button>' : ""}
    </div>
    <p class="hint">空いているところを押すと、その日・その人の予定を書き込めます。</p>
    <div class="board-wrap">
      <table class="board" style="--cols:${state.members.length}">
        <thead><tr><th class="day"></th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);
}

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

function openEventDialog(e = null, date = todayStr(), memberId = null) {
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
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (t.closest("#addBtn")) return openEventDialog(null, state.tab === "week" && state.week > todayStr() ? state.week : todayStr());

  const evBtn = t.closest("[data-ev]");
  if (evBtn) {
    const e = state.events.find((x) => x.id === evBtn.dataset.ev);
    if (e) openEventDialog(e);
    return;
  }
  const cell = t.closest("[data-cell]");
  if (cell) {
    const [date, memberId] = cell.dataset.cell.split("|");
    return openEventDialog(null, date, memberId);
  }
  const wk = t.closest("[data-week]");
  if (wk) {
    state.week = addDays(state.week, 7 * Number(wk.dataset.week));
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
    case "thisWeek":
      state.week = weekStartOf(todayStr());
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
