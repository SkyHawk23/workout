import { create } from "zustand";
import { api } from "../lib/api.js";
import { clearUserCache } from "../lib/idb.js";

export const useStore = create((set, get) => ({
  user: null, // {id, email, display_name, role, household_id, birth_year, timezone}
  authChecked: false,
  prefs: { view: "exercise", rest: "manual", secs: 90 },
  sessionsLoggedCount: 0,

  async bootstrap() {
    try {
      const res = await api("auth", "me");
      set({ user: res.user, prefs: res.user.prefs, authChecked: true });
      get().refreshSessionsLoggedCount();
    } catch {
      set({ user: null, authChecked: true });
    }
  },

  async refreshSessionsLoggedCount() {
    try {
      const res = await api("sessions", "count");
      set({ sessionsLoggedCount: res.count });
    } catch {
      // header stat only — never worth failing a screen over
    }
  },

  async login(email, password) {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await api("auth", "login", { email, password, timezone });
    const prevId = get().user?.id;
    if (prevId && prevId !== res.user.id) await clearUserCache();
    set({ user: res.user, prefs: res.user.prefs });
    get().refreshSessionsLoggedCount();
    return res.user;
  },

  async signup(payload) {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await api("auth", "signup", { ...payload, timezone });
    set({ user: res.user, prefs: res.user.prefs, sessionsLoggedCount: 0 });
    return res.user;
  },

  async logout() {
    await api("auth", "logout").catch(() => {});
    await clearUserCache();
    set({ user: null, sessionsLoggedCount: 0 });
  },

  setPrefs(patch) {
    set((s) => ({ prefs: { ...s.prefs, ...patch } }));
    const next = { ...get().prefs };
    api("auth", "update-prefs", next).catch(() => {});
  },
}));
