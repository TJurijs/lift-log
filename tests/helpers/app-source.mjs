import { readFile } from "node:fs/promises";

/** Legacy architectural checks inspect the app's feature source, not its physical file layout. */
export async function readAppSource() {
  const root = new URL("../../", import.meta.url);
  let source = await readFile(new URL("app/LiftLogApp.tsx", root), "utf8");
  for (const match of source.matchAll(/\/\/ Extracted authoring: ([^\r\n]+)/g)) {
    source = source.replace(match[0], await readFile(new URL(match[1], root), "utf8"));
  }
  const sharedUi = await Promise.all(["app/ui-semantics.ts", "app/object-action-menu.tsx"].map((path) => readFile(new URL(path, root), "utf8")));
  return [source, ...sharedUi].join("\n");
}
