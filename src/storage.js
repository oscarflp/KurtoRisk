// Prototype was authored inside a Claude-artifact sandbox that provides a
// global `window.storage` key-value API. That API doesn't exist in a real
// browser, so this installs a same-shaped, localStorage-backed replacement
// before the app ever calls it. No business logic or data changed.
export function installStorageShim() {
  if (typeof window === "undefined") return;
  if (window.storage && window.storage.__isShim) return;

  window.storage = {
    __isShim: true,
    async get(key) {
      try {
        const raw = window.localStorage.getItem(key);
        return { value: raw === null ? undefined : raw };
      } catch (e) {
        return { value: undefined };
      }
    },
    async set(key, value) {
      try {
        window.localStorage.setItem(key, value);
        return true;
      } catch (e) {
        return false;
      }
    },
  };
}
