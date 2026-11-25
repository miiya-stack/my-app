// デモモード用：この端末（ブラウザ）の中だけにデータを保存する
const KEY = "family-schedule-demo-v4";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function sample() {
  const members = [
    { id: "m1", name: "父", color: "#9fd0ef", order: 1 },
    { id: "m2", name: "母", color: "#f4a7b9", order: 2 },
    { id: "m3", name: "ゆい", color: "#a8dcb9", order: 3 },
  ];
  const ev = (o, title, start, end, memberIds, extra = {}) => ({
    id: newId(), title, date: dayOffset(o), start, end, allDay: false, memberIds,
    dropoffBy: "", pickupBy: "", note: "", ...extra,
  });
  const events = [
    ev(0, "会議", "10:00", "11:30", ["m1"]),
    ev(0, "帰宅予定", "19:00", "", ["m1"]),
    ev(0, "パート", "09:30", "14:00", ["m2"]),
    ev(0, "ピアノ教室", "16:00", "17:00", ["m3"], { note: "楽譜を忘れずに", dropoffBy: "m2", pickupBy: "m1" }),
    ev(1, "歯医者", "15:00", "15:30", ["m2", "m3"]),
    ev(2, "出張（大阪）", "", "", ["m1"], { allDay: true }),
    ev(3, "塾", "17:00", "19:00", ["m3"], { pickupBy: "m2" }),
    ev(5, "家族で買い物", "13:00", "16:00", ["m1", "m2", "m3"]),
  ];
  return { members, events, allowed: ["family@example.com"] };
}

export function createLocalStore() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(KEY)) || sample();
  } catch {
    data = sample();
  }

  const subs = { members: new Set(), events: new Set(), allowed: new Set() };

  function emit() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* 保存できなくても画面は動かす */
    }
    subs.members.forEach((f) => f());
    subs.events.forEach((f) => f());
    subs.allowed.forEach((f) => f());
  }

  function sub(kind, fn) {
    subs[kind].add(fn);
    queueMicrotask(fn);
    return () => subs[kind].delete(fn);
  }

  function upsert(list, { id, ...rest }) {
    const realId = id || newId();
    const i = list.findIndex((x) => x.id === realId);
    const item = { id: realId, ...rest };
    if (i >= 0) list[i] = item;
    else list.push(item);
    return realId;
  }

  return {
    mode: "demo",
    onAuth(cb) {
      queueMicrotask(() =>
        cb({ status: "ready", user: { name: "デモユーザー", email: "demo@example.com", isOwner: true } }),
      );
      return () => {};
    },
    async signIn() {},
    async signOut() {},
    subscribeMembers(cb) {
      return sub("members", () => cb([...data.members].sort((a, b) => a.order - b.order)));
    },
    subscribeEvents(from, to, cb) {
      return sub("events", () => cb(data.events.filter((e) => e.date >= from && e.date <= to)));
    },
    async saveMember(m) {
      const id = upsert(data.members, m);
      emit();
      return id;
    },
    async deleteMember(id) {
      data.members = data.members.filter((m) => m.id !== id);
      emit();
    },
    async saveEvent(e) {
      const id = upsert(data.events, e);
      emit();
      return id;
    },
    async deleteEvent(id) {
      data.events = data.events.filter((e) => e.id !== id);
      emit();
    },
    subscribeAllowed(cb) {
      return sub("allowed", () => cb([...data.allowed]));
    },
    async addAllowed(email) {
      const e = email.toLowerCase();
      if (!data.allowed.includes(e)) data.allowed.push(e);
      emit();
    },
    async removeAllowed(email) {
      data.allowed = data.allowed.filter((x) => x !== email);
      emit();
    },
    reset() {
      data = sample();
      emit();
    },
  };
}
