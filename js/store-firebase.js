// Firebase（Google ログイン + Firestore）を使うデータ保存
const SDK = "https://www.gstatic.com/firebasejs/10.14.1";

export async function createFirebaseStore(config) {
  const { initializeApp } = await import(`${SDK}/firebase-app.js`);
  const A = await import(`${SDK}/firebase-auth.js`);
  const F = await import(`${SDK}/firebase-firestore.js`);

  const app = initializeApp(config);
  const auth = A.getAuth(app);
  auth.languageCode = "ja";
  const db = F.getFirestore(app);

  const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const denied = (e) => e && e.code === "permission-denied";

  // ログインした人が「管理者」か「家族」かをサーバーのルールに問い合わせて確認する
  async function checkAccess(email) {
    try {
      await F.getDoc(F.doc(db, "adminCheck", "check"));
      return { allowed: true, isOwner: true };
    } catch (e) {
      if (!denied(e)) throw e;
    }
    try {
      await F.getDoc(F.doc(db, "allowed", email));
      return { allowed: true, isOwner: false };
    } catch (e) {
      if (!denied(e)) throw e;
      return { allowed: false, isOwner: false };
    }
  }

  return {
    mode: "firebase",

    onAuth(cb) {
      return A.onAuthStateChanged(auth, async (u) => {
        if (!u) return cb({ status: "signedOut" });
        const email = (u.email || "").toLowerCase();
        const user = { name: u.displayName || email, email, isOwner: false };
        try {
          const acc = await checkAccess(email);
          user.isOwner = acc.isOwner;
          cb({ status: acc.allowed ? "ready" : "notAllowed", user });
        } catch (e) {
          console.error(e);
          cb({ status: "error", user, error: e });
        }
      });
    },

    async signIn() {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        await A.signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === "auth/popup-blocked") return A.signInWithRedirect(auth, provider);
        if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
        throw e;
      }
    },

    signOut() {
      return A.signOut(auth);
    },

    subscribeMembers(cb, onErr) {
      const q = F.query(F.collection(db, "members"), F.orderBy("order"));
      return F.onSnapshot(q, (s) => cb(docs(s)), onErr);
    },

    subscribeEvents(from, to, cb, onErr) {
      const q = F.query(
        F.collection(db, "events"),
        F.where("date", ">=", from),
        F.where("date", "<=", to),
      );
      return F.onSnapshot(q, (s) => cb(docs(s)), onErr);
    },

    async saveMember({ id, ...data }) {
      const ref = id ? F.doc(db, "members", id) : F.doc(F.collection(db, "members"));
      await F.setDoc(ref, data);
      return ref.id;
    },

    deleteMember(id) {
      return F.deleteDoc(F.doc(db, "members", id));
    },

    async saveEvent({ id, ...data }) {
      const ref = id ? F.doc(db, "events", id) : F.doc(F.collection(db, "events"));
      await F.setDoc(ref, data);
      return ref.id;
    },

    deleteEvent(id) {
      return F.deleteDoc(F.doc(db, "events", id));
    },

    subscribeAllowed(cb, onErr) {
      return F.onSnapshot(F.collection(db, "allowed"), (s) => cb(s.docs.map((d) => d.id)), onErr);
    },

    addAllowed(email) {
      return F.setDoc(F.doc(db, "allowed", email.toLowerCase()), { addedAt: F.serverTimestamp() });
    },

    removeAllowed(email) {
      return F.deleteDoc(F.doc(db, "allowed", email));
    },
  };
}
