// 音声入力：話した言葉を予定の項目（日付・時刻・だれ・送迎・内容）に振り分ける

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WDS = "日月火水木金土";

/* ---------- 音声認識（ブラウザの機能を使う） ---------- */
export function voiceSupported() {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// 1回分の聞き取りを行う。onText は途中経過、戻り値の Promise は最終結果の文字列
export function listen({ onText } = {}) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Rec();
  rec.lang = "ja-JP";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let text = "";
  const done = new Promise((resolve, reject) => {
    rec.onresult = (ev) => {
      text = Array.from(ev.results)
        .map((r) => r[0].transcript)
        .join("");
      onText && onText(text);
    };
    rec.onerror = (ev) => reject(ev.error || "error");
    rec.onend = () => resolve(text);
  });
  rec.start();
  return { done, stop: () => rec.stop() };
}

/* ---------- 文字のととのえ ---------- */
const KANJI = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

// 「十五」「二十三」などの漢数字を 15、23 のような数字にする（99まで）
function kanjiToNum(k) {
  if (!k.includes("十")) return [...k].map((c) => KANJI[c]).join("");
  const [a, b] = k.split("十");
  if (b.includes("十") || a.length > 1 || b.length > 1) return k;
  return String((a ? KANJI[a] : 1) * 10 + (b ? KANJI[b] : 0));
}

export function normalize(text) {
  return String(text || "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/[〜～]/g, "〜")
    .replace(/[\s　]+/g, " ")
    .replace(/[〇零一二三四五六七八九十]+(?=時|分|日|月)/g, kanjiToNum)
    .trim();
}

/* ---------- 振り分け ---------- */
function nextWeekday(today, wd, { nextWeek = false } = {}) {
  const d = new Date(today);
  if (nextWeek) {
    // 来週の〇曜日：来週の月曜日から数える
    const toMon = ((8 - d.getDay()) % 7) || 7;
    d.setDate(d.getDate() + toMon);
    d.setDate(d.getDate() + ((wd + 6) % 7));
    return d;
  }
  const diff = (wd - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function toHM(h, m, ampm) {
  let hh = Number(h);
  const mm = Number(m || 0);
  if (ampm === "pm" && hh < 12) hh += 12;
  else if (ampm === "am" && hh === 12) hh = 0;
  else if (!ampm && hh >= 1 && hh <= 6) hh += 12; // 「3時」はたいてい午後
  if (hh > 23 || mm > 59) return "";
  return `${pad(hh)}:${pad(mm)}`;
}

/**
 * 話した文章を予定の項目にする。
 * 見つかった項目だけを返す（見つからないものは undefined）。
 * members: [{id, name}]
 */
export function parseSpeech(text, members, now = new Date()) {
  let s = normalize(text);
  const out = {};
  const cut = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    fn(m);
    s = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim();
    return true;
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  /* 日付 */
  const rel = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    out.date = ymd(d);
  };
  cut(/(明後日|あさって)の?/, () => rel(2)) ||
    cut(/(明日|あした|あす)の?/, () => rel(1)) ||
    cut(/(今日|きょう|本日)の?/, () => rel(0)) ||
    cut(/(\d{1,2})月(\d{1,2})日の?/, (m) => {
      let d = new Date(today.getFullYear(), Number(m[1]) - 1, Number(m[2]));
      if (d < new Date(today.getFullYear(), today.getMonth() - 1, 1)) d.setFullYear(d.getFullYear() + 1);
      out.date = ymd(d);
    }) ||
    cut(/来週の?([日月火水木金土])曜日?の?/, (m) => (out.date = ymd(nextWeekday(today, WDS.indexOf(m[1]), { nextWeek: true })))) ||
    cut(/(今週の?)?([日月火水木金土])曜日?の?/, (m) => (out.date = ymd(nextWeekday(today, WDS.indexOf(m[2]))))) ||
    cut(/(?<![\d:])(\d{1,2})日の?/, (m) => {
      const day = Number(m[1]);
      let d = new Date(today.getFullYear(), today.getMonth(), day);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, day);
      out.date = ymd(d);
    });

  /* 終日 */
  cut(/(終日|一日中|1日中)/, () => (out.allDay = true));

  /* 時刻：「午後3時半から5時まで」「15:00〜16:30」 */
  const T = "(午前|午後|朝|夜|夕方)?\\s*(\\d{1,2})(?:時|:)(半|(\\d{1,2})分?)?";
  const ampmOf = (w) => (w === "午後" || w === "夜" || w === "夕方" ? "pm" : w === "午前" || w === "朝" ? "am" : "");
  const range = new RegExp(`${T}\\s*(?:から|〜|~|-|ー)\\s*${T}\\s*(?:まで)?`);
  const single = new RegExp(`${T}\\s*(?:から|に|より)?`);
  if (
    !cut(range, (m) => {
      const ap1 = ampmOf(m[1]);
      const ap2 = ampmOf(m[5]) || (ap1 === "pm" ? "pm" : "");
      out.start = toHM(m[2], m[3] === "半" ? 30 : m[4], ap1);
      out.end = toHM(m[6], m[7] === "半" ? 30 : m[8], ap2);
      // 「午後3時から5時」の5時が早すぎるときは午後とみなす
      if (out.start && out.end && out.end < out.start) out.end = toHM(m[6], m[7] === "半" ? 30 : m[8], "pm");
    })
  ) {
    cut(single, (m) => (out.start = toHM(m[2], m[3] === "半" ? 30 : m[4], ampmOf(m[1]))));
  }
  if (out.start || out.end) out.allDay = false;

  /* 送迎：「送りは父」「迎えは母」「送迎は父」「父が送り」「母が迎えに行く」 */
  const sorted = [...members].sort((a, b) => b.name.length - a.name.length);
  const names = sorted.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const byName = (n) => sorted.find((m) => m.name === n);
  if (names) {
    const assign = (role, name) => {
      const m = byName(name);
      if (!m) return;
      if (role.includes("送迎")) {
        out.dropoffBy = m.id;
        out.pickupBy = m.id;
      } else if (role.includes("送")) out.dropoffBy = m.id;
      else out.pickupBy = m.id;
    };
    const roleFirst = new RegExp(`(送迎|送り|迎え|お迎え)(?:は|が|:|を)\\s*(${names})(?:さん)?(?:が|で)?`);
    const nameFirst = new RegExp(`(${names})(?:さん)?\\s*(?:が|は)\\s*(送迎|送り|迎え|お迎え)(?:に行く|をする|する|に行きます|します)?`);
    for (let i = 0; i < 2; i++) {
      cut(nameFirst, (m) => assign(m[2], m[1])) || cut(roleFirst, (m) => assign(m[1], m[2]));
    }
  }

  /* だれの予定か */
  const ids = [];
  if (names) {
    if (cut(/(家族全員|みんな|全員)(?:で|の)?/, () => {})) members.forEach((m) => ids.push(m.id));
    const re = new RegExp(`(${names})(?:さん|ちゃん|くん)?(?:と|の|が|は|も|、)?`);
    for (let i = 0; i < 20; i++) {
      if (!cut(re, (m) => ids.push(byName(m[1]).id))) break;
    }
  }
  if (ids.length) out.memberIds = [...new Set(ids)];

  /* 残りが「何をする」 */
  const title = s
    .replace(/(の予定を?|予定を?)(追加|入れて|登録)(して|する|します)?(ください)?/g, " ")
    .replace(/(を)?(追加|登録)(して|する|します)?(ください)?$/g, " ")
    .replace(/(入れて|いれて)(ください|おいて)?$/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s、。,.のはがにでとを]+|[\s、。,.のはがにでとを]+$/g, "")
    .replace(/(から|まで)$/g, "")
    .trim();
  if (title) out.title = title;

  return out;
}
