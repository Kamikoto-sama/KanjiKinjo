import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import type {
  CollectionData,
  Config,
  Snapshot,
  StudiedNote,
} from "../src/types";

const auth = { email: "study@example.test", hkey: "fixture", endpoint: "" };
const config: Config = {
  deckId: 2,
  includeChildren: true,
  mappings: {
    "3": {
      status: "configured",
      spelling: "Word",
      translation: "Meaning",
      reading: "Reading",
    },
  },
};

const resolved: StudiedNote = {
  id: "1",
  modelId: 3,
  fields: ["転勤", "転[てん]勤[きん]", "job transfer"],
};
const missing: StudiedNote = {
  id: "2",
  modelId: 3,
  fields: ["工場", "", "factory"],
};
const otherMissing: StudiedNote = {
  id: "3",
  modelId: 3,
  fields: ["会社", "", "company"],
};

function collection(
  name: string,
  notes: StudiedNote[] = [resolved],
): CollectionData {
  return {
    decks: [{ id: 2, name }],
    noteTypes: {
      "2": [
        {
          id: 3,
          name: "Words",
          fields: ["Word", "Reading", "Meaning"],
          count: notes.length,
          samples: [],
        },
      ],
    },
    studiedNotes: { "2": notes },
  };
}

function snapshot(name: string, words: Snapshot["words"] = []): Snapshot {
  return {
    schemaVersion: 1,
    snapshotVersion: "seed",
    datasetVersion: "fixture",
    syncedAt: new Date().toISOString(),
    deck: { id: 2, name, includeChildren: true },
    words,
    unresolved: [],
    duplicateGroups: [],
  };
}

async function mockManifest(page: Page) {
  await page.route("**/api/dictionary/manifest", (route) =>
    route.fulfill({ json: { datasetVersion: "fixture", files: [] } }),
  );
}

async function seed(page: Page, values: Record<string, unknown> = {}) {
  await mockManifest(page);
  await page.route("**/test-seed", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto("/test-seed");
  await page.evaluate(
    async (stored) => {
      const modulePath = "/src/cache.ts";
      const { cache } = (await import(
        modulePath
      )) as typeof import("../src/cache");
      await cache.values.bulkPut(
        Object.entries(stored).map(([key, value]) => ({ key, value })),
      );
      cache.close();
    },
    { dictionaryVersion: "fixture", ...values },
  );
}

async function stored<T>(page: Page, key: string): Promise<T | undefined> {
  return page.evaluate(async (key) => {
    const modulePath = "/src/cache.ts";
    const { cache } = (await import(
      modulePath
    )) as typeof import("../src/cache");
    return (await cache.values.get(key))?.value as T | undefined;
  }, key);
}

async function syncInOtherTab(page: Page, next: CollectionData) {
  const tab = await page.context().newPage();
  await mockManifest(tab);
  await tab.route("**/api/anki/sync", (route) =>
    route.fulfill({ json: { jobId: "other-tab" } }),
  );
  await tab.goto("/import");
  const committed = await tab.evaluate(
    async (data) => {
      const modulePath = "/src/api.ts";
      const { api } = (await import(modulePath)) as typeof import("../src/api");
      const { source } = await api.sync();
      return Boolean(await api.applySync(data, source));
    },
    { auth, collection: next },
  );
  await tab.close();
  expect(committed).toBe(true);
}

test("startup reports denied IndexedDB access and retries in the same document", async ({
  page,
}) => {
  await mockManifest(page);
  await page.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      if (document.documentElement?.dataset.allowDatabase !== "yes") {
        throw new DOMException("Storage is disabled", "SecurityError");
      }
      return original.apply(this, args);
    };
  });
  await page.goto("/search");
  await expect(page.getByRole("alert")).toContainText(
    "Could not open local storage",
  );
  await page.evaluate(() => {
    document.documentElement.dataset.allowDatabase = "yes";
  });
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(
    page.getByRole("button", { name: "Choose file", exact: true }),
  ).toBeVisible();
  expect(await page.locator("html").getAttribute("data-allow-database")).toBe(
    "yes",
  );
});

test("login retries a lost result response and opens the new setup without reloading", async ({
  page,
}) => {
  await mockManifest(page);
  let posts = 0;
  let reads = 0;
  await page.route("**/api/anki/login", async (route) => {
    posts++;
    await route.fulfill({ json: { jobId: "login" } });
  });
  await page.route("**/api/jobs/login", async (route) => {
    reads++;
    if (reads === 1) await route.abort("connectionreset");
    else if (reads === 2)
      await route.fulfill({
        status: 503,
        json: { detail: "Temporary failure" },
      });
    else
      await route.fulfill({
        json: {
          status: "complete",
          result: { auth, collection: collection("Signed-in deck") },
        },
      });
  });
  await page.goto("/login");
  await page.evaluate(() => {
    document.documentElement.dataset.sameDocument = "yes";
    sessionStorage.setItem("setupDraft", JSON.stringify({ deckId: 999 }));
  });
  await page.getByLabel("Email").fill(auth.email);
  await page.getByLabel("Password").fill("fixture password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dictionaries$/);
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await page.getByRole("button", { name: "Continue to deck setup" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(
    page.getByRole("option", { name: "Signed-in deck" }),
  ).toBeAttached();
  await expect(page.getByLabel("Deck", { exact: true })).toHaveValue("0");
  expect(await page.locator("html").getAttribute("data-same-document")).toBe(
    "yes",
  );
  expect({ posts, reads }).toEqual({ posts: 1, reads: 3 });
});

test("file import errors open a modal and return focus to Choose file", async ({
  page,
}) => {
  const message =
    "This package has no recorded answers; studied words cannot be determined";
  await page.route("**/api/anki/import", (route) =>
    route.fulfill({ status: 400, json: { detail: message } }),
  );
  await page.goto("/import");

  const chooseFile = page.getByRole("button", {
    name: "Choose file",
    exact: true,
  });
  const chooser = page.waitForEvent("filechooser");
  await chooseFile.click();
  await (
    await chooser
  ).setFiles({
    name: "unstudied.apkg",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("fixture"),
  });

  const dialog = page.getByRole("alertdialog", { name: "Import failed" });
  await expect(dialog).toHaveAccessibleDescription(message);
  const close = dialog.getByRole("button", { name: "OK" });
  await expect(close).toBeFocused();
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(message, { exact: true })).toHaveCount(0);
  await expect(chooseFile).toBeFocused();
});

test("dictionary download starts on demand, cancels on Back, and waits for Continue", async ({
  page,
}) => {
  const files = [
    { path: "words.json.gz", kind: "words", body: gzipSync("[]") },
    {
      path: "similar.json.gz",
      kind: "similar",
      body: gzipSync('{"転":["伝"]}'),
    },
  ];
  let manifestRequests = 0;
  await page.route("**/api/dictionary/manifest", (route) => {
    manifestRequests++;
    return route.fulfill({
      json: {
        datasetVersion: "fixture",
        files: files.map(({ path, kind, body }) => ({
          path,
          kind,
          bytes: body.length,
          sha256: createHash("sha256").update(body).digest("hex"),
        })),
      },
    });
  });
  const firstDownload = Promise.withResolvers<void>();
  const secondDownload = Promise.withResolvers<void>();
  let similarDownloads = 0;
  for (const { path, body } of files) {
    await page.route(`**/api/dictionary/${path}`, async (route) => {
      if (path === "similar.json.gz") {
        similarDownloads++;
        if (similarDownloads === 1) await firstDownload.promise;
        if (similarDownloads === 2) {
          await secondDownload.promise;
          return route.fulfill({ status: 503 });
        }
      }
      return route.fulfill({ body, contentType: "application/gzip" });
    });
  }
  await page.route("**/api/anki/import", (route) =>
    route.fulfill({ json: { collection: collection("Imported deck") } }),
  );

  await page.goto("/import");
  const chooseFile = page.getByRole("button", {
    name: "Choose file",
    exact: true,
  });
  await expect(chooseFile).toBeVisible();
  expect(manifestRequests).toBe(0);
  const chooser = page.waitForEvent("filechooser");
  await chooseFile.click();
  await (
    await chooser
  ).setFiles({
    name: "fixture.apkg",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("fixture"),
  });

  await expect(page).toHaveURL(/\/dictionaries$/);
  await expect(
    page.getByRole("heading", { name: "Dictionaries", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("About 1 KB")).toBeVisible();
  expect(similarDownloads).toBe(0);

  const download = page.getByRole("button", { name: "Download", exact: true });
  const canceled = page.waitForEvent("requestfailed", (request) =>
    request.url().endsWith("/api/dictionary/similar.json.gz"),
  );
  await download.click();
  await expect(page.getByRole("status")).toContainText(
    "1 of 2 files downloaded",
  );
  await expect(page.getByLabel("Deck", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/import$/);
  await canceled;
  firstDownload.resolve();
  expect(
    (await stored<CollectionData>(page, "collection"))?.decks[0].name,
  ).toBe("Imported deck");
  expect(await stored(page, "dictionaryVersion")).toBeUndefined();

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/dictionaries$/);
  await expect(download).toBeEnabled();
  expect(similarDownloads).toBe(1);
  await download.click();
  await expect(page.getByRole("status")).toContainText(
    "1 of 2 files downloaded",
  );
  secondDownload.resolve();
  await expect(page.getByRole("alert")).toContainText(
    "Could not load dictionaries",
  );
  await page.getByRole("button", { name: "Retry download" }).click();
  const continueSetup = page.getByRole("button", {
    name: "Continue to deck setup",
  });
  await expect(continueSetup).toBeVisible();
  await expect(page).toHaveURL(/\/dictionaries$/);
  expect(await stored(page, "dictionaryVersion")).toBe("fixture");
  expect(await stored(page, "similar")).toEqual({ 転: ["伝"] });
  await continueSetup.click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(
    page.getByRole("option", { name: "Imported deck" }),
  ).toBeAttached();
  expect(similarDownloads).toBe(3);

  await page.route("**/api/dictionary/manifest", (route) => route.abort());
  await page.reload();
  await expect(
    page.getByRole("option", { name: "Imported deck" }),
  ).toBeAttached();
  expect(similarDownloads).toBe(3);
});

test("an older snapshot triggers automatic AnkiWeb sync on startup", async ({
  page,
}) => {
  await seed(page, {
    auth,
    collection: collection("Old deck"),
    config,
    snapshot: {
      ...snapshot("Old deck"),
      syncedAt: new Date(Date.now() - 16 * 60_000).toISOString(),
    },
  });
  let jobs = 0;
  await page.route("**/api/anki/sync", async (route) => {
    jobs++;
    await route.fulfill({ json: { jobId: "automatic" } });
  });
  await page.route("**/api/jobs/automatic", (route) =>
    route.fulfill({
      json: {
        status: "complete",
        result: { auth, collection: collection("Updated deck") },
      },
    }),
  );
  await page.goto("/search");
  await expect(page.getByText("Updated deck", { exact: true })).toBeVisible();
  expect(jobs).toBe(1);
});

test("import in one tab invalidates a sync started in another tab", async ({
  page,
  context,
}) => {
  await seed(page, {
    auth,
    collection: collection("Old deck"),
    config,
    snapshot: snapshot("Old deck"),
  });
  await page.route("**/api/anki/sync", (route) =>
    route.fulfill({ json: { jobId: "old-job" } }),
  );
  await page.goto("/search");
  const token = await page.evaluate(async () => {
    const modulePath = "/src/api.ts";
    const { api } = (await import(modulePath)) as typeof import("../src/api");
    return (await api.sync()).source;
  });

  const applying = page.evaluate(
    async ({ source, result }) => {
      const modulePath = "/src/api.ts";
      const { api } = (await import(modulePath)) as typeof import("../src/api");
      const subtle = crypto.subtle;
      const digest = subtle.digest;
      const ready = new Promise<void>((resolve) =>
        window.addEventListener("finish-sync-build", () => resolve(), {
          once: true,
        }),
      );
      subtle.digest = async (...args) => {
        document.documentElement.dataset.syncBuild = "started";
        await ready;
        return digest.apply(subtle, args);
      };
      try {
        return await api.applySync(result, source);
      } finally {
        subtle.digest = digest;
      }
    },
    { source: token, result: { auth, collection: collection("Stale result") } },
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-sync-build",
    "started",
  );

  const importing = await context.newPage();
  await mockManifest(importing);
  await importing.route("**/api/anki/import", (route) =>
    route.fulfill({ json: { collection: collection("Imported deck") } }),
  );
  await importing.goto("/import");
  await importing.evaluate(() => {
    document.documentElement.dataset.sameDocument = "yes";
    sessionStorage.setItem("setupDraft", JSON.stringify({ deckId: 2 }));
  });
  await importing
    .getByRole("button", { name: "Choose file", exact: true })
    .click();
  const chooser = importing.waitForEvent("filechooser");
  await importing
    .getByRole("alertdialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "fixture.apkg",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("fixture"),
  });
  await expect(importing).toHaveURL(/\/dictionaries$/);
  await importing
    .getByRole("button", { name: "Continue to deck setup" })
    .click();
  await expect(importing).toHaveURL(/\/setup$/);
  await expect(
    importing.getByRole("option", { name: "Imported deck" }),
  ).toBeAttached();
  await expect(importing.getByLabel("Deck", { exact: true })).toHaveValue("0");
  expect(
    await importing.locator("html").getAttribute("data-same-document"),
  ).toBe("yes");

  await page.evaluate(() =>
    window.dispatchEvent(new Event("finish-sync-build")),
  );
  expect(await applying).toBeNull();
  expect(
    (await stored<CollectionData>(importing, "collection"))?.decks[0].name,
  ).toBe("Imported deck");
  expect(await stored(importing, "auth")).toBeUndefined();
  expect(await stored(importing, "snapshot")).toBeUndefined();
});

test("confirming a current preview persists the prepared snapshot", async ({
  page,
}) => {
  await seed(page, {
    collection: collection("Setup deck", [resolved, missing]),
    config,
  });
  await page.addInitScript(() => {
    const original = crypto.randomUUID.bind(crypto);
    const ids: string[] = [];
    Object.assign(window, { testSnapshotIds: ids });
    crypto.randomUUID = () => {
      const id = original();
      ids.push(id);
      return id;
    };
  });
  await page.goto("/setup");
  const continueSetup = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  await continueSetup.click();
  const warning = page.getByRole("alertdialog", {
    name: "Continue without 1 word?",
  });
  await expect(warning).toBeVisible();

  await warning.getByRole("button", { name: "Cancel" }).click();
  await expect(continueSetup).toBeFocused();
  await continueSetup.click();

  const readIds = () =>
    page.evaluate(
      () => (window as Window & { testSnapshotIds: string[] }).testSnapshotIds,
    );
  const before = await readIds();
  expect(before).toHaveLength(1);
  expect(await stored(page, "snapshot")).toBeUndefined();
  await warning.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/search$/);
  expect(await readIds()).toEqual(before);
  const committed = await stored<Snapshot>(page, "snapshot");
  expect(committed?.snapshotVersion).toBe(before[0]);
  expect(committed?.words.map((word) => word.spelling)).toEqual(["転勤"]);
});

test("a refreshed preview asks again when the unresolved records change", async ({
  page,
}) => {
  const first = collection("Synced deck", [resolved, missing]);
  await seed(page, {
    auth,
    collection: first,
    config,
    snapshot: snapshot("Synced deck"),
  });
  await page.goto("/setup");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const warning = page.getByRole("alertdialog", {
    name: "Continue without 1 word?",
  });
  await expect(warning).toBeVisible();
  await syncInOtherTab(
    page,
    collection("Synced deck", [resolved, otherMissing]),
  );
  const synced = await stored<Snapshot>(page, "snapshot");

  await warning.getByRole("button", { name: "Continue" }).click();
  await expect(warning).toBeVisible();
  await expect(page).toHaveURL(/\/setup$/);
  expect((await stored<Snapshot>(page, "snapshot"))?.snapshotVersion).toBe(
    synced?.snapshotVersion,
  );
  await warning.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/search$/);
  expect(
    (await stored<Snapshot>(page, "snapshot"))?.unresolved.map(
      (word) => word.noteId,
    ),
  ).toEqual(["3"]);
});

test("a refreshed preview with no words stays in setup", async ({ page }) => {
  await seed(page, {
    auth,
    collection: collection("Synced deck", [resolved, missing]),
    config,
    snapshot: snapshot("Synced deck"),
  });
  await page.goto("/setup");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const warning = page.getByRole("alertdialog", {
    name: "Continue without 1 word?",
  });
  await expect(warning).toBeVisible();
  await syncInOtherTab(page, collection("Synced deck", [missing]));
  const synced = await stored<Snapshot>(page, "snapshot");

  await warning.getByRole("button", { name: "Continue" }).click();
  await expect(warning).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  await expect(page).toHaveURL(/\/setup$/);
  expect((await stored<Snapshot>(page, "snapshot"))?.snapshotVersion).toBe(
    synced?.snapshotVersion,
  );
});

test("two tabs can save corrections without losing either record", async ({
  page,
  context,
}) => {
  await seed(page, {
    collection: collection("Study", [missing, otherMissing]),
    config,
    snapshot: snapshot("Study"),
  });
  const second = await context.newPage();
  await mockManifest(second);
  await Promise.all([page.goto("/corrections"), second.goto("/corrections")]);
  await page.getByRole("button", { name: /工場/ }).click();
  await second.getByRole("button", { name: /会社/ }).click();
  await page.getByLabel("Furigana").fill("工[こう]場[じょう]");
  await second.getByLabel("Furigana").fill("会[かい]社[しゃ]");
  await Promise.all([
    page.getByRole("button", { name: "Save correction" }).click(),
    second.getByRole("button", { name: "Save correction" }).click(),
  ]);
  await expect
    .poll(async () =>
      (await stored<Snapshot>(page, "snapshot"))?.words
        .map((word) => word.spelling)
        .sort(),
    )
    .toEqual(["会社", "工場"]);
  expect(
    Object.keys(
      (await stored<Record<string, unknown>>(page, "corrections")) ?? {},
    ).sort(),
  ).toEqual(["2", "3"]);
});

test("search Back, related-word pagination, swipe and menu focus work together", async ({
  page,
}) => {
  const words: Snapshot["words"] = Array.from({ length: 125 }, (_, i) => {
    const spelling = i ? `転${String.fromCharCode(0x4e00 + i)}` : "転勤";
    return {
      wordId: `word-${i}`,
      noteIds: [String(i)],
      spelling,
      reading: "てんきん",
      ruby: [{ text: spelling, reading: "てんきん" }],
      translations: [`meaning ${i}`],
      match: "dictionary",
    };
  });
  await seed(page, {
    collection: collection("Study"),
    config,
    snapshot: snapshot("Study", words),
  });
  await page.goto("/search");
  const search = page.getByRole("searchbox");
  await search.fill("転勤");
  await page.getByRole("link", { name: /転勤/ }).click();
  const all = page.getByRole("tab", { name: /^All/ });
  await expect(all).toHaveAttribute("aria-selected", "true");
  const activePanel = page.getByRole("tabpanel");
  const rows = () => activePanel.locator('a[href^="/word"]');
  await expect(rows()).toHaveCount(50);
  await activePanel.getByRole("button", { name: "Show more" }).click();
  await expect(rows()).toHaveCount(100);

  const same = page.getByRole("tab", { name: /^Same kanji/ });
  await activePanel.evaluate((panel) => {
    panel.parentElement!.scrollTo({
      left: panel.clientWidth,
      behavior: "instant",
    });
  });
  await expect(same).toHaveAttribute("aria-selected", "true");
  await expect(rows()).toHaveCount(50);

  const menu = page.getByRole("button", { name: "Open menu" });
  await menu.click();
  await page.getByRole("menuitem", { name: "Show card link template" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(menu).toBeFocused();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(search).toHaveValue("転勤");
});
