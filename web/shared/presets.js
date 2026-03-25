import { parseJsonNamesFromDirectoryIndex } from "./core.js";

async function listRelativePresetNames(
  baseUrl,
  {
    include = new Set(["default.json", "empty.json"]),
    exclude = new Set(["presets.json"]),
  } = {},
) {
  // Primary: fetch the presets.json manifest — more reliable than HTML directory parsing.
  try {
    const manifestRes = await fetch(`${baseUrl}presets.json`, { cache: "no-store" });
    if (manifestRes.ok) {
      const raw = await manifestRes.json();
      if (Array.isArray(raw)) {
        const names = new Set(include);
        for (const fileName of raw) {
          if (typeof fileName !== "string") continue;
          const lower = fileName.toLowerCase();
          if (!lower.endsWith(".json")) continue;
          if (exclude.has(lower)) continue;
          names.add(fileName);
        }
        return Array.from(names).sort((a, b) => a.localeCompare(b));
      }
    }
  } catch {
    // Fall through to HTML directory listing parsing.
  }

  // Fallback: parse the HTML directory listing for .json file links.
  let names = Array.from(include);
  try {
    const response = await fetch(baseUrl, { cache: "no-store" });
    if (!response.ok) return names.sort((a, b) => a.localeCompare(b));
    names = parseJsonNamesFromDirectoryIndex(await response.text(), { include, exclude });
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

export { listRelativePresetNames, loadRelativePresetObject };
