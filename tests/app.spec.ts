import { test, expect } from "@playwright/test";

test.describe("Handy App", () => {
  test("dev server responds", async ({ page }) => {
    // Just verify the dev server is running and responds
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("page has html structure", async ({ page }) => {
    await page.goto("/");

    // Verify basic HTML structure exists
    const html = await page.content();
    expect(html).toContain("<html");
    expect(html).toContain("<body");
  });
});

test("setup uses Prism's light palette and keeps the language picker editable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_OS_PLUGIN_INTERNALS__", {
      value: { platform: "macos", os_type: "macos", locale: "en-US" },
    });
    localStorage.setItem(
      "handy.onboarding",
      JSON.stringify({ step: "welcome", languages: ["en"] }),
    );
  });
  await page.route("**/src/main.tsx", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        `import { mockIPC } from "/node_modules/@tauri-apps/api/mocks.js";
mockIPC((cmd) => {
  if (cmd === "get_app_settings") {
    return { app_language: "en", theme: "dark", onboarding_completed: false, shortcut_activation: "push_to_talk" };
  }
  if (cmd.includes("permission")) return true;
  if (cmd.startsWith("get_available") || cmd === "get_active_notices") return [];
  if (cmd.includes("locale")) return "en-US";
}, { shouldMockEvents: true });
` + (await response.text()),
    });
  });

  const requestedLocales = new Set<string>();
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    const match = pathname.match(/\/i18n\/locales\/([^/]+)\/translation\.json$/);
    if (match) requestedLocales.add(match[1]);
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Free Voice Transcription" }),
  ).toBeVisible();
  await expect(page.locator("[data-onboarding]")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(
    page.getByRole("group", { name: "Languages", exact: true }),
  ).toHaveCount(0);

  const search = page.locator("[data-onboarding] input[type=text]");
  await search.fill("Spanish");
  await search.press("Enter");
  await expect(
    page.getByRole("button", { name: /Remove Spanish/ }),
  ).toBeVisible();
  await search.press("Escape");
  await expect(
    page.getByRole("group", { name: "Languages", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();

  expect([...requestedLocales]).toEqual(["en"]);
  await page.getByRole("button", { name: "App language" }).click();
  await page.getByRole("option", { name: "Español", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(
    page.getByRole("button", { name: "Idioma de la app" }),
  ).toBeVisible();
  expect([...requestedLocales]).toEqual(["en", "es"]);
});
