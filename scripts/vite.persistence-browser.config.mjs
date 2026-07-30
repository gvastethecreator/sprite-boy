export default {
  cacheDir: process.env.SPRITE_BOY_PERSISTENCE_CACHE_DIR ?? "node_modules/.vite-persistence-browser",
  optimizeDeps: {
    include: ["jszip"],
    noDiscovery: true,
  },
};
