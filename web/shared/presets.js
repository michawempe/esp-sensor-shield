import { parseJsonNamesFromDirectoryIndex } from "./core.js";

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
