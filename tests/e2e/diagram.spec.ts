import { expect, test } from "@playwright/test";
import { EXAMPLE_NAMES, anglesOf, chooseLens, collectProblems, openExample, panOf, scaleOf } from "./helpers.ts";

test.describe("every example", () => {
  for (const name of EXAMPLE_NAMES) {
    test(`${name} renders its cards without errors`, async ({ page }) => {
      const problems = collectProblems(page);
      await openExample(page, name);
      await expect(page.locator(".adx-errors")).toHaveCount(0);
      expect(await page.locator(".adg-card").count()).toBeGreaterThan(1);
      await expect(page.locator(".adg-info h3")).not.toBeEmpty();
      expect(problems).toEqual([]);
    });
  }
});

test.describe("keyboard", () => {
  test("tab order runs toolbar, then the viewport, then cards, then arrow chips", async ({ page }) => {
    await openExample(page, "simple-web-app");
    const rank = { toolbar: 0, stage: 1, card: 2, chip: 3 } as const;
    type Group = keyof typeof rank;
    const seen: Group[] = [];
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a) return "none";
        if (a.closest(".adg-bar")) return "toolbar";
        if (a.classList.contains("adg-view")) return "stage";
        if (a.closest(".adg-card")) return "card";
        if (a.closest(".adg-chip")) return "chip";
        return "other";
      });
      if (!(where in rank)) continue;
      const group = where as Group;
      const last = seen[seen.length - 1];
      // Going back to an earlier group is fine only once every group has been visited: that is focus wrapping round to the top of the page.
      if (last && rank[group] < rank[last]) {
        expect(new Set(seen), `tab order went ${last} -> ${group} before visiting everything: ${seen.join(" ")}`).toEqual(new Set(Object.keys(rank)));
        break;
      }
      seen.push(group);
    }
    expect(new Set(seen)).toEqual(new Set(Object.keys(rank)));
  });

  test("Enter on a focused card selects it and the info strip describes it", async ({ page }) => {
    await openExample(page, "simple-web-app");
    const card = page.locator(".adg-card", { hasText: "Database" }).first();
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".adg-info h3")).toHaveText("Database");
  });

  test("the focused viewport zooms with = and -, and pans with the arrows once zoomed", async ({ page }) => {
    await openExample(page, "platform-stack");
    const stage = page.locator(".adg-view");
    await stage.focus();
    const z0 = await scaleOf(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press("=");
    await expect.poll(async () => (await scaleOf(page)) / z0).toBeCloseTo(1.2 ** 3, 2);
    const p0 = await panOf(page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await panOf(page)).join(",")).not.toBe(p0.join(","));
    for (let i = 0; i < 3; i++) await page.keyboard.press("-");
    await expect.poll(async () => (await scaleOf(page)) / z0).toBeCloseTo(1, 2);
  });
});

test.describe("pointer", () => {
  test("ctrl + wheel zooms and stops at the 3x ceiling; a plain wheel is left alone", async ({ page }) => {
    await openExample(page, "platform-stack");
    const z0 = await scaleOf(page);
    const result = await page.locator(".adg-view").evaluate((el) => {
      const r = el.getBoundingClientRect();
      const send = (ctrlKey: boolean, deltaY: number) => {
        const e = new WheelEvent("wheel", { ctrlKey, deltaY, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true });
        el.dispatchEvent(e);
        return e.defaultPrevented;
      };
      return { plain: send(false, 100), ctrl: send(true, -100) };
    });
    expect(result).toEqual({ plain: false, ctrl: true });
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(z0 * 1.1);
    for (let i = 0; i < 40; i++) await page.locator(".adg-view").evaluate((el) => el.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true })));
    await expect.poll(async () => (await scaleOf(page)) / z0).toBeCloseTo(3, 1);
  });

  test("the Tooling toggle removes the tooling and re-fits, and comes back", async ({ page }) => {
    await openExample(page, "platform-tooling");
    const cards = page.locator(".adg-card");
    const planeWidth = () => page.locator(".adg-plane").evaluate((el) => (el as HTMLElement).offsetHeight);
    const all = await cards.count();
    const tall = await planeWidth();
    await page.getByRole("button", { name: "Tooling" }).click();
    await expect(cards).toHaveCount(4);
    expect(await planeWidth()).toBeLessThan(tall);
    await page.getByRole("button", { name: "Tooling" }).click();
    await expect(cards).toHaveCount(all);
    expect(await planeWidth()).toBe(tall);
  });

  test("hovering a card dims the unrelated ones", async ({ page }) => {
    await openExample(page, "simple-web-app");
    await page.locator(".adg-card", { hasText: "Browser" }).hover();
    await expect(page.locator(".adg-card.dim")).not.toHaveCount(0);
    await page.mouse.move(2, 2);
    await expect(page.locator(".adg-card.dim")).toHaveCount(0);
  });
});

test.describe("the static trace path", () => {
  test("numbers every step on its card and lights the route between them", async ({ page }) => {
    await openExample(page, "simple-web-app");
    const button = page.getByRole("button", { name: /the path/ });
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".adg-frame[data-step]")).toHaveCount(0);
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const steps = await page.locator(".adg-frame[data-step]").evaluateAll((els) => els.map((e) => e.getAttribute("data-step")));
    expect(steps.sort()).toEqual(["1", "2", "3", "4"]);
    // four trace steps over a chain of three links: all three are lit, and the backup link that no step uses is not
    await expect(page.locator(".adg-edge-base.hot")).toHaveCount(3);
    // the number is also in the card's accessible name, since it is drawn from CSS
    const names = await page.locator(".adg-card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    expect(names.filter((n) => /trace step \d/.test(n))).toHaveLength(4);
    await button.click();
    await expect(page.locator(".adg-frame[data-step]")).toHaveCount(0);
    await expect(page.locator(".adg-edge-base.hot")).toHaveCount(0);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("starts with the whole path shown, still and numbered", async ({ page }) => {
    await openExample(page, "simple-web-app");
    await expect(page.getByRole("button", { name: /the path/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".adg-frame[data-step]")).toHaveCount(4);
  });

  test("turns off the flow animation and the plane's easing", async ({ page }) => {
    await openExample(page, "simple-web-app");
    const flow = await page.locator(".adg-edge-flow").first().evaluate((el) => getComputedStyle(el).animationName);
    expect(flow).toBe("none");
    const plane = await page.locator(".adg-plane").evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(plane).toBe("0s");
  });
});

test.describe("forced colours", () => {
  test.use({ forcedColors: "active" });

  test("level badges still carry a text glyph and words, not colour alone", async ({ page }) => {
    await openExample(page, "simple-web-app");
    await chooseLens(page, "security");
    const badges = page.locator(".adg-badge");
    await expect(badges.first()).toBeVisible();
    for (const text of await badges.allInnerTexts()) expect(text.trim().length).toBeGreaterThan(2);
    // each badge also has an accessible name that states its level
    const labels = await page.locator(".adg-card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    expect(labels.some((l) => /Good|Note|Warning|Risk/.test(l))).toBe(true);
  });
});

test.describe("the 3D plane", () => {
  test("is a preserve-3d context that nothing flattens", async ({ page }) => {
    await openExample(page, "simple-web-app", "iso");
    const bad = await page.locator(".adg-plane").evaluate((plane) => {
      const cs = getComputedStyle(plane);
      const problems: string[] = [];
      if (cs.transformStyle !== "preserve-3d") problems.push(`transform-style is ${cs.transformStyle}`);
      // these values on the element itself force transform-style back to flat (MDN: transform-style)
      if (cs.overflow !== "visible") problems.push(`overflow: ${cs.overflow}`);
      if (parseFloat(cs.opacity) < 1) problems.push(`opacity: ${cs.opacity}`);
      if (cs.filter !== "none") problems.push(`filter: ${cs.filter}`);
      if (cs.clipPath !== "none") problems.push(`clip-path: ${cs.clipPath}`);
      if (cs.mixBlendMode !== "normal") problems.push(`mix-blend-mode: ${cs.mixBlendMode}`);
      if (cs.isolation !== "auto") problems.push(`isolation: ${cs.isolation}`);
      if (/paint/.test(cs.contain)) problems.push(`contain: ${cs.contain}`);
      const strays = [...plane.querySelectorAll(".adg-anchor")].filter((a) => a.parentElement !== plane).length;
      if (strays) problems.push(`${strays} anchors are not direct children of the plane`);
      return problems;
    });
    expect(bad).toEqual([]);
  });
});

test.describe("buttons for everything dragging does (WCAG 2.5.7)", () => {
  test("pan buttons are off while the diagram fits, and move it once zoomed", async ({ page }) => {
    await openExample(page, "platform-stack");
    for (const name of ["Pan left", "Pan right", "Pan up", "Pan down"]) await expect(page.getByRole("button", { name })).toBeDisabled();
    // zoom until the content is wider than the stage too (a wide window needs more steps than a narrow one), so both axes can pan
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByRole("button", { name: "Pan left" })).toBeEnabled();
    const [x0, y0] = await panOf(page);
    await page.getByRole("button", { name: "Pan right" }).click();
    await expect.poll(async () => (await panOf(page))[0]).toBeLessThan(x0); // like scrolling right: the content moves left
    await page.getByRole("button", { name: "Pan down" }).click();
    await expect.poll(async () => (await panOf(page))[1]).toBeLessThan(y0);
    await page.getByRole("button", { name: "Pan left" }).click();
    await page.getByRole("button", { name: "Pan left" }).click();
    await expect.poll(async () => (await panOf(page))[0]).toBeGreaterThan(x0);
  });

  test("rotate and tilt buttons turn the isometric view, within the same limits as dragging", async ({ page }) => {
    test.slow(); // twenty clicks, each followed by a 0.9 s transition: about 45 s in WebKit, which is the whole default limit
    await openExample(page, "simple-web-app", "iso");
    const a0 = await anglesOf(page);
    await page.getByRole("button", { name: "Rotate right" }).click();
    await expect.poll(async () => (await anglesOf(page)).turn).toBeCloseTo(a0.turn + 15, 1);
    await page.getByRole("button", { name: "Rotate left" }).click();
    await page.getByRole("button", { name: "Rotate left" }).click();
    await expect.poll(async () => (await anglesOf(page)).turn).toBeCloseTo(a0.turn - 15, 1);
    for (let i = 0; i < 10; i++) await page.getByRole("button", { name: "Tilt up" }).click();
    await expect.poll(async () => (await anglesOf(page)).tilt).toBe(75);
    for (let i = 0; i < 10; i++) await page.getByRole("button", { name: "Tilt down" }).click();
    await expect.poll(async () => (await anglesOf(page)).tilt).toBe(30);
  });

  test("the rotate buttons only exist in the isometric view", async ({ page }) => {
    await openExample(page, "simple-web-app", "top");
    await expect(page.getByRole("button", { name: "Rotate left" })).toHaveCount(0);
  });

  test("every toolbar control is at least 24 by 24 CSS px (WCAG 2.5.8)", async ({ page }) => {
    await openExample(page, "platform-stack");
    const small = await page.locator(".adg-bar button, .adg-bar select").evaluateAll((els) =>
      els.map((e) => ({ name: e.getAttribute("aria-label") ?? e.textContent?.trim() ?? e.tagName, box: e.getBoundingClientRect() })).filter((x) => x.box.width < 24 || x.box.height < 24).map((x) => `${x.name}: ${Math.round(x.box.width)}x${Math.round(x.box.height)}`),
    );
    expect(small).toEqual([]);
  });
});

test.describe("the diagram as text", () => {
  test("lists every component and every connection", async ({ page }) => {
    await openExample(page, "simple-web-app");
    const panel = page.locator("details.adg-text");
    await expect(panel).not.toHaveAttribute("open", "");
    await panel.locator("summary").click();
    await expect(panel).toHaveAttribute("open", "");
    const labels = await page.locator(".adg-name").allInnerTexts();
    for (const label of labels) await expect(panel).toContainText(label);
    const links = await page.locator(".adg-chip").count();
    expect(await panel.getByText(/^Outgoing:/).count()).toBe(links);
    await expect(panel).toContainText("Request trace");
  });

  test("each card is described by what it sends and receives", async ({ page }) => {
    await openExample(page, "simple-web-app");
    const described = await page.locator(".adg-card").evaluateAll((cards) =>
      cards.map((c) => {
        const id = c.getAttribute("aria-describedby");
        return { id, text: id ? (document.getElementById(id)?.textContent ?? "") : "" };
      }),
    );
    expect(described.length).toBeGreaterThan(3);
    for (const d of described) expect(d.text).toMatch(/Outgoing:|Incoming:|No connections/);
  });
});

test.describe("keyboard focus does what hover does", () => {
  test("focusing a card dims the others and shows its details; Escape dismisses that", async ({ page }) => {
    await openExample(page, "simple-web-app");
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.classList.contains("adg-card"))) break;
    }
    await expect(page.locator(".adg-card:focus-visible")).toHaveCount(1);
    await expect(page.locator(".adg-card.dim")).not.toHaveCount(0);
    const focusedName = await page.evaluate(() => document.activeElement?.querySelector(".adg-name")?.textContent ?? "");
    await expect(page.locator(".adg-info h3")).toHaveText(focusedName);
    await page.keyboard.press("Escape");
    await expect(page.locator(".adg-card.dim")).toHaveCount(0);
    await expect(page.locator(".adg-card:focus-visible")).toHaveCount(1); // focus stays where it was
  });

  test("a card reached by keyboard while zoomed in is brought into view", async ({ page }) => {
    await openExample(page, "platform-stack");
    for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(1000);
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => (document.activeElement?.classList.contains("adg-card") ? (document.activeElement.querySelector(".adg-name")?.textContent ?? "") : ""));
      if (!name) continue;
      seen.add(name);
      // the pan eases over about a second; a slower machine (WebKit on a CI runner) takes longer, so wait for it to arrive rather than for a fixed time
      await expect.poll(() => page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        const s = document.querySelector(".adg-view")!.getBoundingClientRect();
        const r = a.getBoundingClientRect();
        return r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
      }), { message: `${name} is inside the viewport once focused`, timeout: 6000 }).toBe(true);
      expect(await page.locator(".adg-view").evaluate((el) => el.scrollLeft + el.scrollTop)).toBe(0);
      if (seen.size >= 6) break;
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  test("the selected card is marked by more than colour", async ({ page }) => {
    await openExample(page, "simple-web-app");
    await page.locator(".adg-card", { hasText: "Database" }).click();
    const marker = await page.locator(".adg-card[aria-pressed=true] .adg-name").evaluate((el) => getComputedStyle(el, "::before").content);
    expect(marker).toContain("▸");
    // and only the selected card has it
    expect(await page.locator(".adg-card:not([aria-pressed=true]) .adg-name").first().evaluate((el) => getComputedStyle(el, "::before").content)).toBe("none");
  });
});

test.describe("targets", () => {
  for (const name of EXAMPLE_NAMES) {
    test(`${name}: every arrow label is at least 24 by 24 CSS px (WCAG 2.5.8)`, async ({ page }) => {
      await openExample(page, name);
      const small = await page.locator(".adg-chip").evaluateAll((els) =>
        els.map((e) => ({ name: e.getAttribute("aria-label") ?? "", box: e.getBoundingClientRect() })).filter((x) => x.box.width < 23.5 || x.box.height < 23.5).map((x) => `${x.name}: ${Math.round(x.box.width)}x${Math.round(x.box.height)}`),
      );
      expect(small).toEqual([]);
    });
  }
});

test.describe("forced colours: state is not left to colour", () => {
  test.use({ forcedColors: "active" });

  test("a pressed toggle and a selected card get an outline", async ({ page }) => {
    await openExample(page, "simple-web-app");
    const toggle = page.getByRole("button", { name: /the path/ });
    await toggle.click();
    expect(await toggle.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.locator(".adg-card", { hasText: "Database" }).click();
    expect(await page.locator(".adg-card[aria-pressed=true] .adg-name").evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  });
});

test.describe("switching between the views", () => {
  // Regression: for most of the 0.9 s turn the cards used to sit behind the plane's pedestals, so icons showed as slivers or not at all.
  // The browser's running transitions are paused at fixed points so each frame is the same every time, and the share of the API icon that
  // is actually its purple is counted in a real screenshot.
  for (const [from, to] of [["iso", "Top view"], ["top", "Isometric"]] as const) {
    for (const at of [150, 400, 700]) {
      test(`the API icon stays visible ${at} ms into the switch to ${to}`, async ({ page, browserName }) => {
        test.skip(browserName === "webkit" && process.platform === "linux", "WebKit on Linux does not hold paused CSS transitions at a fixed time, so the pixel count differs; the check passes in WebKit on Windows and macOS and in Chromium everywhere (see backlog R0)");
        await openExample(page, "simple-web-app", from);
        await page.getByRole("button", { name: to }).click();
        await page.evaluate((t) => {
          for (const a of document.getAnimations()) {
            a.pause();
            a.currentTime = t;
          }
        }, at);
        await page.waitForTimeout(100);
        const rect = await page.locator(".adg-card", { hasText: "API" }).locator(".adg-icon").boundingBox();
        expect(rect).not.toBeNull();
        const png = (await page.screenshot({ clip: rect! })).toString("base64");
        const visible = await page.evaluate(async (b64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let purple = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i]! > 80 && d[i + 2]! > 160 && d[i + 1]! < 130) purple++;
          return purple / (d.length / 4);
        }, png);
        // the icon is a rounded purple tile with a white glyph: about 70% of its box is purple when it is all there
        expect(visible).toBeGreaterThan(0.5);
      });
    }
  }
});

test.describe("the trace callout", () => {
  const callout = (page: import("@playwright/test").Page) => page.getByRole("group", { name: "Request trace" });

  test("starts on step 1 and waits for the visitor", async ({ page }) => {
    await openExample(page, "simple-web-app");
    await expect(callout(page)).not.toContainText("Step 1");
    await page.getByRole("button", { name: "Start the trace" }).click();
    await expect(callout(page)).toContainText("Step 1 of 4");
    await expect(page.getByRole("button", { name: "Start the trace" })).toHaveCount(0);
    await page.waitForTimeout(2500); // longer than a step of autoplay: nothing moves on its own
    await expect(callout(page)).toContainText("Step 1 of 4");
  });

  test("Next and Back step through, and the ends are disabled", async ({ page }) => {
    await openExample(page, "simple-web-app");
    await page.getByRole("button", { name: "Start the trace" }).click();
    await expect(callout(page).getByRole("button", { name: /Back/ })).toBeDisabled();
    for (let i = 2; i <= 4; i++) {
      await callout(page).getByRole("button", { name: /Next/ }).click();
      await expect(callout(page)).toContainText(`Step ${i} of 4`);
    }
    await expect(callout(page).getByRole("button", { name: /Next/ })).toBeDisabled();
    await callout(page).getByRole("button", { name: /Back/ }).click();
    await expect(callout(page)).toContainText("Step 3 of 4");
  });

  test("arrow keys step and Escape ends the trace, returning focus to the start button", async ({ page }) => {
    await openExample(page, "simple-web-app");
    await page.getByRole("button", { name: "Start the trace" }).click();
    await callout(page).getByRole("button", { name: /Next/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(callout(page)).toContainText("Step 2 of 4");
    await page.keyboard.press("ArrowLeft");
    await expect(callout(page)).toContainText("Step 1 of 4");
    await page.keyboard.press("Escape");
    await expect(callout(page)).not.toContainText("Step");
    await expect(page.getByRole("button", { name: "Start the trace" })).toBeFocused();
  });

  test("autoplay is opt-in, can be paused, and stops at the last step", async ({ page }) => {
    await openExample(page, "simple-web-app");
    await page.getByRole("button", { name: "Start the trace" }).click();
    await callout(page).getByRole("combobox", { name: "Autoplay speed" }).selectOption({ label: "Fast" });
    await callout(page).getByRole("button", { name: "Play" }).click();
    await expect(callout(page)).toContainText("Step 2 of 4");
    await callout(page).getByRole("button", { name: "Pause" }).click();
    const text = await callout(page).innerText();
    await page.waitForTimeout(1500);
    expect(await callout(page).innerText()).toBe(text);
    await callout(page).getByRole("button", { name: "Play" }).click();
    await expect(callout(page)).toContainText("Step 4 of 4", { timeout: 8000 });
    await expect(callout(page).getByRole("button", { name: "Replay" })).toBeVisible();
  });

  test("announces each step to a screen reader once", async ({ page }) => {
    await openExample(page, "simple-web-app");
    await page.getByRole("button", { name: "Start the trace" }).click();
    await expect(page.getByRole("status")).toContainText("Step 1 of 4");
    await callout(page).getByRole("button", { name: /Next/ }).click();
    await expect(page.getByRole("status")).toContainText("Step 2 of 4");
  });

  test("is one row directly under the viewport, so it covers no card, and offers Start there", async ({ page }) => {
    for (const [w, ex] of [[1280, "platform-stack"], [375, "simple-web-app"]] as const) {
      await page.setViewportSize({ width: w, height: 900 });
      await openExample(page, ex);
      const view = (await page.locator(".adg-view").boundingBox())!;
      const start = (await page.getByRole("button", { name: "Start the trace" }).boundingBox())!;
      expect(start.y).toBeGreaterThanOrEqual(view.y + view.height - 1); // the same row the controls will use
      await page.getByRole("button", { name: "Start the trace" }).click();
      for (let i = 0; i < 3; i++) {
        const v = (await page.locator(".adg-view").boundingBox())!; // measured again: focusing Next may have scrolled the page
        const box = (await callout(page).boundingBox())!;
        expect(box.y, "starts under the viewport").toBeGreaterThanOrEqual(v.y + v.height - 1);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(w + 1);
        expect(box.height, "slim").toBeLessThan(w > 700 ? 60 : 130);
        await callout(page).getByRole("button", { name: /Next/ }).click();
      }
      await page.getByRole("button", { name: "End the trace" }).click();
    }
  });

  test("starting by keyboard lands focus on Next, and the Show the path toggle works in both states", async ({ page }) => {
    await openExample(page, "simple-web-app");
    const start = page.getByRole("button", { name: "Start the trace" });
    await start.focus();
    await page.keyboard.press("Enter");
    await expect(callout(page).getByRole("button", { name: /Next/ })).toBeFocused();
    const toggle = callout(page).getByRole("button", { name: /the path/ });
    await toggle.click();
    await expect(page.locator(".adg-frame[data-step]")).toHaveCount(4);
    await toggle.click();
    await expect(page.locator(".adg-frame[data-step]")).toHaveCount(0);
  });

  test("reduced motion: still waits for the visitor", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await openExample(page, "simple-web-app");
    await page.getByRole("button", { name: "Start the trace" }).click();
    await page.waitForTimeout(2500);
    await expect(callout(page)).toContainText("Step 1 of 4");
    await ctx.close();
  });
});

test.describe("off-path links step back", () => {
  test("their cables fade and their labels wait until the link is pointed at", async ({ page }) => {
    await openExample(page, "hospital-event-backbone");
    const quiet = page.locator(".adg-edge.quiet");
    expect(await quiet.count()).toBe(7);
    expect(await quiet.first().evaluate((el) => getComputedStyle(el).opacity)).toBe("0.4");
    const chip = page.locator(".adg-chip", { hasText: "Reads contract" }).first();
    expect(await chip.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    // pointing at the component they belong to brings them back
    await page.locator(".adg-card", { hasText: "Event contract registry" }).hover();
    await expect(page.locator(".adg-chip.show", { hasText: "Reads contract" }).first()).toBeVisible();
    await expect(page.locator(".adg-edge.quiet")).not.toHaveCount(7);
    // the labels on the main path stay visible throughout
    await page.mouse.move(2, 2);
    await expect(page.locator(".adg-chip", { hasText: "Appointment events" })).not.toHaveCSS("opacity", "0");
  });
});
