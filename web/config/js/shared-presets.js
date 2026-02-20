(() => {
  const Shared = window.ConfigPageShared;
  if (!Shared) throw new Error("Missing ConfigPageShared. Load shared-core.js before shared-presets.js.");

  async function listRelativePresetNames(
    baseUrl,
    {
      include = new Set(["default.json", "empty.json"]),
      exclude = new Set(["presets.json"]),
    } = {},
  ) {
    let names = Array.from(include);
    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (!response.ok) return names.sort((a, b) => a.localeCompare(b));
      names = Shared.parseJsonNamesFromDirectoryIndex(await response.text(), { include, exclude });
    } catch {
      // Keep fallback include list.
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  async function loadRelativePresetObject(baseUrl, fileName) {
    const response = await fetch(`${baseUrl}${encodeURIComponent(fileName)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Cannot load preset: ${fileName}`);
    return JSON.parse(await response.text());
  }

  window.ConfigPagePresets = {
    listRelativePresetNames,
    loadRelativePresetObject,
  };
})();
