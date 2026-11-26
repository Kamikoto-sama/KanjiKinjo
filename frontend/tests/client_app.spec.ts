import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";
import type { CollectionData, CollectionNote, Config, Snapshot, } from "../src/types";

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

const resolved: CollectionNote = {
  id: "1",
  modelId: 3,
  fields: ["転勤", "転[てん]勤[きん]", "job transfer"],
};
const missing: CollectionNote = {
  id: "2",
  modelId: 3,
  fields: ["工場", "", "factory"],
};
const otherMissing: CollectionNote = {
  id: "3",
  modelId: 3,
  fields: ["会社", "", "company"],
};

function collection(
  name: string,
  notes: CollectionNote[] = [resolved],
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

test("the home route opens import until setup is complete", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/import$/);

  await seed(page, { collection: collection("Imported deck") });
  await page.goto("/");
  await expect(page).toHaveURL(/\/import$/);
  await expect(
      page.getByRole("heading", { name: "Import deck", exact: true }),
  ).toBeVisible();
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

test("the home route opens search and syncs an older snapshot", async ({
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
  await page.goto("/");
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByText("Updated deck", { exact: true })).toBeVisible();
  expect(jobs).toBe(1);
});

test("unstudied visibility follows both switches across word lists and works offline", async ({ page, context }) => {
    const factory: CollectionNote = { id: "4", modelId: 3, fields: ["工場", "工[こう]場[じょう]", "factory"] };
    const alternative: CollectionNote = { id: "5", modelId: 3, fields: ["工場", "工[こう]場[ば]", "workshop"] };
    const duplicate: CollectionNote = {
        id: "6",
        modelId: 3,
        fields: ["工場", "工場[こうじょう]", "manufacturing plant"]
    };
    const construction: CollectionNote = { id: "7", modelId: 3, fields: ["工事", "工[こう]事[じ]", "construction"] };
    await seed(page, {
        collection: {
            ...collection("Mixed deck", [factory]),
            unstudiedNotes: { "2": [alternative, duplicate, construction, otherMissing] },
        },
        hasUnstudiedData: true,
        config,
    });
    await page.goto("/setup");
    const preference = page.getByRole("switch", { name: "Show unstudied words" });
    const preview = page.locator('[aria-label="Record preview"]');
    await expect(preference).not.toBeChecked();
    await expect(preview.getByText("factory", { exact: true })).toBeVisible();
    await expect(preview.getByText("Unstudied", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Manage" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "View" })).toHaveCount(0);

    await preference.click();
    await expect(preference).toBeChecked();
    await expect(preview.getByText("factory · manufacturing plant")).toBeVisible();
    await expect(preview.getByText("Unstudied", { exact: true })).toHaveCount(2);

    await page.getByRole("button", { name: "View" }).click();
    await expect(page.getByRole("heading", { name: "Duplicate words" })).toBeVisible();
    await expect(page.getByText("Unstudied", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Manage" }).click();
    await expect(page.getByRole("button", { name: /会社.*Unstudied/ })).toBeVisible();
    await page.getByLabel("Furigana").fill("会[かい]社[しゃ]");
    await page.getByRole("button", { name: "Save correction" }).click();
    await expect(page.getByText("All words in this card type are resolved.")).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/search$/);
    await page.reload();

    const search = page.getByRole("searchbox");
    const menu = page.getByRole("button", { name: "Open menu" });
    const menuPreference = page.getByRole("menuitemcheckbox", { name: "Show unstudied words" });
    const results = page.getByRole("group", { name: "Search results" });
    await search.fill("工場");
    await expect(results.getByRole("link")).toHaveCount(2);
    await expect(results.getByText("Unstudied", { exact: true })).toBeVisible();
    await menu.click();
    await expect(menuPreference).toBeChecked();
    const track = menuPreference.locator('[data-slot="dropdown-menu-switch-track"]');
    await expect(track).toBeVisible();
    const onColor = await track.evaluate((element) => getComputedStyle(element).backgroundColor);
    await menuPreference.click();
    await expect(menuPreference).not.toBeChecked();
    await expect(track).not.toHaveCSS("background-color", onColor);
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(results.getByRole("link")).toHaveCount(1);
    await expect(results.getByText("factory", { exact: true })).toBeVisible();
    await expect(results.getByText(/manufacturing plant/)).toHaveCount(0);

    const constructionPath = `/word?${new URLSearchParams({ spelling: "工事", reading: "こうじ" })}`;
    await page.goto(constructionPath);
    await expect(page.locator(".word-hero").getByText("Unstudied", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /factory/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /workshop/ })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await context.setOffline(true);
    await menu.click();
    await menuPreference.press("Space");
    await expect(menuPreference).toBeChecked();
    await expect(page.getByRole("link", { name: /workshop/ }).getByText("Unstudied", { exact: true })).toBeVisible();
    await menuPreference.press("Enter");
    await expect(menuPreference).not.toBeChecked();
    await expect(page.getByRole("link", { name: /workshop/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(page).toHaveURL(constructionPath);
    await context.setOffline(false);

    await page.goto(`/word?${new URLSearchParams({ spelling: "工場" })}`);
    const readings = page.getByRole("group", { name: "Available readings" });
    await expect(readings.getByRole("link")).toHaveCount(1);
    await menu.click();
    await menuPreference.click();
    await expect(readings.getByRole("link")).toHaveCount(2);
    await expect(readings.getByRole("link", { name: /Unstudied.*こうば/ })).toBeVisible();
});

test("sync upgrades an older cached deck and refreshes the studied status after the first answer", async ({ page }) => {
    const fresh: CollectionNote = { id: "4", modelId: 3, fields: ["工場", "工[こう]場[じょう]", "factory"] };
    await seed(page, { auth, collection: collection("Cached deck"), config, snapshot: snapshot("Cached deck") });

    let download: CollectionData = { ...collection("Cached deck"), unstudiedNotes: { "2": [fresh, missing] } };
    await page.route("**/api/anki/sync", (route) => route.fulfill({ json: { jobId: "refresh" } }));
    await page.route("**/api/jobs/refresh", (route) => route.fulfill({
        json: {
            status: "complete",
            result: { auth, collection: download }
        }
    }));
    await page.goto("/search");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Show unstudied words" }).click();
    const outdated = page.getByText("Sync the deck to show unstudied words.");
    await expect(outdated).toBeVisible();
    await page.keyboard.press("Escape");
    const sync = page.getByRole("button", { name: "Sync", exact: true });
    await sync.click();
    await expect(outdated).toBeHidden();
    const syncIssues = page.getByRole("dialog", { name: "Review synced words" });
    await expect(syncIssues).toContainText(/1 new word/);
    await syncIssues.getByRole("button", { name: "Close" }).click();

    await page.getByRole("searchbox").fill("工場");
    const results = page.getByRole("group", { name: "Search results" });
    await expect(results.getByText("Unstudied", { exact: true })).toBeVisible();

    download = { ...collection("Cached deck", [resolved, fresh]), unstudiedNotes: { "2": [missing, otherMissing] } };
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Show unstudied words" }).click();
    await expect(results.getByRole("link")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await sync.click();
    await expect(results.getByRole("link", { name: /factory/ })).toBeVisible();
    await expect(results.getByText("Unstudied", { exact: true })).toHaveCount(0);
    await expect(syncIssues).toHaveCount(0);
});

test("a legacy file import can be replaced without resetting the word display preference", async ({ page }) => {
    const imported = {
        ...collection("New deck"),
        unstudiedNotes: {
            "2": [{ ...missing, fields: ["工場", "工[こう]場[じょう]", "factory"] }],
        },
    };
    await seed(page, {
        collection: collection("Old deck"), config, snapshot: snapshot("Old deck"),
    });
    await page.route("**/api/anki/import", async (route) =>
        route.fulfill({ json: { collection: imported } }),
    );

    await page.goto("/search");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Show unstudied words" }).click();
    await expect(page.getByText("Re-import the deck to show unstudied words.")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Re-import deck" }).click();
    await page.getByRole("button", { name: "Choose file", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click();
    await (await chooser).setFiles({
        name: "new-deck.apkg",
        mimeType: "application/octet-stream",
        buffer: Buffer.from("fixture"),
    });
    await page.getByRole("button", { name: "Continue to deck setup" }).click();
    await expect(page.getByRole("switch", { name: "Show unstudied words" })).toBeChecked();
    await page.getByLabel("Deck", { exact: true }).selectOption({ label: "New deck" });
    await expect(page.locator('[aria-label="Record preview"]').getByText("Unstudied", { exact: true })).toBeVisible();
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

test("Back is disabled when import, search, and word routes open in a new tab", async ({
                                                                                         page,
                                                                                         context,
                                                                                       }) => {
  const words: Snapshot["words"] = ["こうじょう", "こうば"].map(
      (reading, index) => ({
        wordId: `word-${index}`,
        noteIds: [String(index)],
        spelling: "工場",
        reading,
        ruby: [{ text: "工場", reading }],
        translations: ["factory"],
        match: "dictionary",
      }),
  );
  await seed(page, {
    collection: collection("Study"),
    config,
    snapshot: snapshot("Study", words),
  });

  for (const path of [
    "/import",
    "/search",
    `/word?${new URLSearchParams({ spelling: "工場", reading: "こうじょう" })}`,
    `/word?${new URLSearchParams({ spelling: "工場" })}`,
  ]) {
    const tab = await context.newPage();
    await mockManifest(tab);
    await tab.goto(path);
    await expect(tab).toHaveURL(path);
    await expect(tab.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
    await tab.close();
  }
});

test("All relationship dividers open their tabs with mouse and keyboard", async ({
                                                                                     page,
                                                                                 }) => {
    const words: Snapshot["words"] = [
        ["工事", "こうじ", "construction"],
        ["工場", "こうじょう", "factory"],
        ["土地", "とち", "land"],
        ["麹", "こうじ", "malt"],
        ["古字", "こじ", "old character"],
    ].map(([spelling, reading, translation], index) => ({
        wordId: `word-${index}`,
        noteIds: [String(index)],
        spelling,
        reading,
        translations: [translation],
        match: "dictionary",
    }));
    await seed(page, {
        collection: collection("Study"),
        config,
        similar: { 工: ["土"] },
        snapshot: snapshot("Study", words),
    });
    await page.goto(
        `/word?${new URLSearchParams({ spelling: "工事", reading: "こうじ" })}`,
    );
    const all = page.getByRole("tab", { name: /^All/ });
    for (const name of [
        "Similar reading",
        "Lookalikes",
        "Same kanji",
        "Same reading",
    ]) {
        await expect(all).toHaveAttribute("aria-selected", "true");
        const panel = page.getByRole("tabpanel");
        const section = panel.getByRole("group", { name, exact: true });
        if (name === "Same reading") {
            await section.getByRole("button", { name }).press("Enter");
        } else {
            await section.getByRole("heading").click({ position: { x: 4, y: 4 } });
        }
        const tab = page.getByRole("tab", { name });
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(tab).toBeFocused();
        await expect(section).toBeInViewport();
        await all.click();
    }
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
