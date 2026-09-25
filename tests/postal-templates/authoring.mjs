import assert from "node:assert/strict";

// Real editor commands only. DOM ranges simulate mouse selection, never mutations.
export async function exerciseAuthoring(page, origin) {
  const id = value => `[data-testid="${value}"]`;
  const editor = id("fixture-email");
  const source = () => page.$eval(id("fixture-email-source"), el => el.textContent);
  const click = async value => {
    if (value.endsWith("-raw-mode")) {
      const target = await page.$(id(value));
      const visible = target && await target.evaluate(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      const editorTestId = value.replace(/-raw-mode$/, "");
      const toolbarSelector = `div:has(> ${id(editorTestId)}) [data-template-design-toolbar]`;
      if (!visible && await page.$(toolbarSelector)) {
        const more = await page.$(`${toolbarSelector} button[aria-label="More formatting"]`);
        if (more) await more.click();
      }
    }
    await page.waitForSelector(id(value), { visible: true });
    await page.click(id(value));
  };
  const key = async key => {
    await page.keyboard.down("Control");
    await page.keyboard.press(key);
    await page.keyboard.up("Control");
  };
  const set = async (selector, value) => {
    if (selector.includes('Text link URL') || selector.includes('Text color hex')) await page.focus(selector);
    else await page.click(selector);
    await key("KeyA");
    await page.keyboard.sendCharacter(value);
  };
  const select = async (selector, collapse = false) => page.$eval(selector, (el, collapse) => {
    el.closest("[contenteditable]")?.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    if (collapse) range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, collapse);
  const selectText = async (selector, selectedText) => page.$eval(selector, (el, selectedText) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const start = node.textContent.indexOf(selectedText);
      if (start < 0) continue;
      el.closest("[contenteditable]")?.focus();
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + selectedText.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
    throw new Error(`Cannot select text: ${selectedText}`);
  }, selectedText);
  await page.goto(`${origin}/editor-fixture`);
  await page.waitForSelector(editor);
  const mountedEditor = await page.$(editor);
  await page.click(editor);
  await page.keyboard.sendCharacter("Authored document A");
  const documentA = await source();
  await click("fixture-email-save");
  await click("fixture-email-load-other");
  assert.equal(await page.$eval(editor, el => el.textContent), "External document B");
  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-email-undo"]')?.disabled === true);
  assert.equal(await page.$eval(id("fixture-email-undo"), el => el.disabled), true);
  await click("fixture-email-reopen");
  assert.equal(await mountedEditor.evaluate(el => el === document.querySelector('[data-testid="fixture-email"]')), true,
    "A/B/A must use the same mounted editor DOM, not a remount");
  assert.equal(await page.$eval(editor, el => el.textContent), "Authored document A");
  assert.equal(await source(), documentA);
  assert.equal(await page.$eval(id("fixture-email-undo"), el => el.disabled), true);
  assert.equal(await page.$eval(id("fixture-email-redo"), el => el.disabled), true);
  await select(editor, true);
  await page.keyboard.sendCharacter(" next edit");
  assert.equal(await page.$eval(editor, el => el.textContent), "Authored document A next edit");
  assert.match(await source(), /Authored document A next edit/);
  await click("fixture-email-undo");
  assert.equal(await source(), documentA);
  assert.equal(await page.$eval(editor, el => el.textContent), "Authored document A");
  assert.equal(await page.$eval(id("fixture-email-undo"), el => el.disabled), true,
    "Undo cannot return to B or to edits before the external replacement");
  console.log("PASS same-mounted external A/B/A hydration, next edit and reset history");
  await page.reload();
  await page.waitForSelector(editor);
  assert.equal(await page.$eval(id("fixture-email-undo"), el => el.disabled), true);
  assert.equal(await page.$eval(id("fixture-email-redo"), el => el.disabled), true);
  await page.click(editor);
  await page.keyboard.sendCharacter("History button check");
  const historyButtonValue = await source();
  assert.equal(await page.$eval(id("fixture-email-undo"), el => el.disabled), false);
  await click("fixture-email-undo");
  assert.equal(await source(), "");
  assert.equal(await page.$eval(id("fixture-email-undo"), el => el.disabled), true);
  assert.equal(await page.$eval(id("fixture-email-redo"), el => el.disabled), false);
  await click("fixture-email-redo");
  assert.equal(await source(), historyButtonValue);
  assert.equal(await page.$eval(id("fixture-email-redo"), el => el.disabled), true);
  await click("fixture-email-raw-mode");
  await click("fixture-email-undo");
  assert.equal(await page.$eval(id("fixture-email-raw"), el => el.value), "");
  await click("fixture-email-redo");
  assert.equal(await page.$eval(id("fixture-email-raw"), el => el.value), historyButtonValue);
  await click("fixture-email-raw-mode");
  await click("fixture-email-undo");
  console.log("PASS visible undo/redo buttons, boundary states and source-mode history");
  assert.equal(await page.$(id("fixture-email-page-break")), null, "Email has no physical page break control");
  await page.click(editor);
  await page.keyboard.type("Email heading");
  const typed = await source();
  await key("KeyZ");
  assert.notEqual(await source(), typed, "Typing participates in undo");
  await key("KeyY");
  assert.equal(await source(), typed, "Typing redo restores authored text");
  await select(editor);
  await click("fixture-email-bold");
  assert.match(await source(), /<(b|strong)[ >]|font-weight:bold/);
  await key("KeyZ");
  assert.equal(await source(), typed, "Formatting is one undoable command");
  await key("KeyY");
  await select(editor, true);
  const beforeToken = await source();
  await click("fixture-email-token");
  assert.match(await source(), /\{\{contact.field\(name="firstName"\)\}\}/);
  await key("KeyZ");
  assert.equal(await source(), beforeToken, "External token insertion is undoable");
  await key("KeyY");
  const beforePaste = await source();
  await page.$eval(editor, el => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", '<table style="width:100%"><tbody><tr><td style="padding:8px">Outer<table><tbody><tr><td>Nested</td></tr></tbody></table></td><td>Right</td></tr></tbody></table>');
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  assert.equal(await page.$$eval(`${editor} table`, els => els.length), 2);
  await key("KeyZ");
  assert.equal(await source(), beforePaste, "Nested layout paste is one undoable command");
  await key("KeyY");
  assert.equal(await page.$$eval(`${editor} table`, els => els.length), 2);
  await click("fixture-email-raw-mode");
  const tokenized = '<div style="color:#123456"><p>Quoted token layout</p><table style="width:100%"><tr><td><table><tr><td>Nested</td></tr></table></td><td><a href="{{contact.field(name="url")}}">Link</a><span style="color:{{contact.field(name="color")}}">{{contact.field(name="firstName")}}</span></td></tr></table></div>';
  await set(id("fixture-email-raw"), tokenized);
  await click("fixture-email-raw-mode");
  const canonical = await source();
  assert.match(canonical, /\{\{contact.field\(name="url"\)\}\}/);
  assert.match(canonical, /\{\{contact.field\(name="color"\)\}\}/);
  assert.doesNotMatch(canonical, /sirius\w+slot|siriustemplateplaceholder/);
  await click("fixture-email-save");
  await page.reload();
  await click("fixture-email-reopen");
  await page.waitForFunction(expected => document.querySelector('[data-testid="fixture-email-source"]').textContent === expected, {}, canonical);
  assert.equal(await page.$$eval(`${editor} table`, els => els.length), 2);
  await click("fixture-email-raw-mode");
  assert.equal(await page.$eval(id("fixture-email-raw"), el => el.value), canonical);
  await page.click(id("fixture-email-raw"), { button: "right" });
  assert.equal(await page.$('[role="menu"][aria-label="Editor selection actions"]'), null,
    "Source mode cannot expose rich-text selection actions");
  await click("fixture-email-raw-mode");
  await click("fixture-email-disabled");
  assert.equal(await page.$eval(editor, el => el.isContentEditable), false);
  assert.equal(await page.$eval(id("fixture-email-undo"), el => el.disabled), true);
  assert.equal(await page.$eval(id("fixture-email-redo"), el => el.disabled), true);
  await page.click(editor, { button: "right" });
  assert.equal(await page.$('[role="menu"][aria-label="Editor selection actions"]'), null,
    "Disabled editor cannot expose selection actions");
  await click("fixture-email-token");
  assert.equal(await source(), canonical, "Disabled imperative insertion is refused");
  await click("fixture-email-disabled");
  const tools = `div:has(> ${editor})`;
  const toolbarSelector = `${tools} [data-template-design-toolbar]`;
  const control = label => ["Font", "Size", "Paragraph", "Line spacing", "Space after"].includes(label)
    ? `${toolbarSelector} [aria-label="${label}"]`
    : `[aria-label="${label}"]`;
  const toolbarLayoutFailures = [];
  const direct = label => `${toolbarSelector} [data-promoted-tools] [aria-label="${label}"]`;
  const overflow = label => `[data-state="open"] [aria-label="${label}"]`;
  const assertLocation = async (labels, main) => {
    for (const label of labels) {
      assert.equal(await page.$(direct(label)) !== null, main, `${label} direct location`);
      if (!main) {
        await openToolbarPopover("More formatting");
        await page.waitForSelector(overflow(label), { visible: true });
        assert.equal(await page.$$(overflow(label)).then(items => items.length), 1, `${label} has one overflow action`);
        await page.keyboard.press("Escape");
      }
    }
  };
  const openToolbarPopover = async label => {
    const trigger = await page.$(`${toolbarSelector} button[aria-label="${label}"]`);
    assert.ok(trigger, `Missing toolbar button: ${label}`);
    await trigger.click();
  };
  const textClick = async (text, tag = "button") => {
    await page.waitForFunction((tag, text) => {
      const target = [...document.querySelectorAll(tag)].find(el => {
        const style = getComputedStyle(el);
        return el.textContent.trim() === text && (el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
          style.display !== "none" && style.visibility !== "hidden" && !el.closest('[data-state="closed"]');
      });
      if (!target) return false;
      target.click();
      return true;
    }, {}, tag, text);
  };
  const openInsertSection = async section => {
    const state = async () => page.$$eval("summary", (nodes, section) => {
      const summary = nodes.find(el => el.textContent.trim() === section);
      const style = summary && getComputedStyle(summary);
      return summary && (summary.offsetWidth || summary.offsetHeight || summary.getClientRects().length) &&
        style.display !== "none" && style.visibility !== "hidden" && !summary.closest('[data-state="closed"]')
        ? { visible: true, open: summary.parentElement.open } : { visible: false, open: false };
    }, section);
    let current = await state();
    const isVisible = current.visible;
    if (!isVisible) {
      const trigger = await page.$(`${toolbarSelector} button[aria-label="Insert"]`);
      const expanded = trigger && await trigger.evaluate(el => el.getAttribute("aria-expanded") === "true");
      if (!expanded) await openToolbarPopover("Insert");
      await page.waitForFunction(section => [...document.querySelectorAll("summary")].some(el =>
        el.textContent.trim() === section && (el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
        getComputedStyle(el).visibility !== "hidden" && !el.closest('[data-state="closed"]')), {}, section);
    }
    current = await state();
    if (!current.open) await textClick(section, "summary");
  };
  const assertToolbarLayout = async width => {
    await page.setViewport({ width, height: 1100 });
    // Container ResizeObserver updates the overflow grouping after layout.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.$eval(toolbarSelector, toolbar => {
      const rect = toolbar.getBoundingClientRect();
      const children = [...toolbar.children].filter(el => {
        const child = el.getBoundingClientRect();
        return child.width > 0 && child.height > 0;
      });
      const tops = children.map(el => el.getBoundingClientRect().top);
      return {
        height: rect.height,
        rows: tops.length ? Math.max(...tops) - Math.min(...tops) : 0,
        toolbarWidth: toolbar.clientWidth,
        toolbarScrollWidth: toolbar.scrollWidth,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    if (layout.height !== 46) toolbarLayoutFailures.push(`${width}px: toolbar height ${layout.height}px (expected 46px)`);
    if (layout.rows > 8) toolbarLayoutFailures.push(`${width}px: controls span ${layout.rows}px vertically (expected one row)`);
    if (layout.toolbarScrollWidth > layout.toolbarWidth) {
      toolbarLayoutFailures.push(`${width}px: toolbar overflow ${layout.toolbarScrollWidth}/${layout.toolbarWidth}px`);
    }
    if (layout.documentWidth > layout.viewportWidth) {
      toolbarLayoutFailures.push(`${width}px: document overflow ${layout.documentWidth}/${layout.viewportWidth}px`);
    }
  };
  await page.setViewport({ width: 1400, height: 1100 });
  const promoted = ["Line spacing", "Space after", "Clear formatting", "HTML source"];
  await page.waitForSelector(direct("HTML source"));
  await assertLocation(promoted, true);
  const canvasBeforePopover = await page.$eval(editor, el => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  });
  await openToolbarPopover("More formatting");
  const canvasAfterPopover = await page.$eval(editor, el => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  });
  assert.deepEqual(canvasAfterPopover, canvasBeforePopover, "Opening a toolbar popover must not move or resize the canvas");
  await page.keyboard.press("Escape");
  // Build a fresh email entirely through the visual controls.
  await click("fixture-email-raw-mode");
  await set(id("fixture-email-raw"), "<p>Designed email</p>");
  await click("fixture-email-raw-mode");
  await page.waitForSelector(`${toolbarSelector} [aria-label="Font"]`, { visible: true });
  await select(`${editor} p`);
  await page.select(control("Font"), "Georgia, serif");
  await page.select(control("Size"), "24px");
  await openToolbarPopover("Alignment");
  await page.click('button[aria-label="Align center"]');
  await page.keyboard.press("Escape");
  await select(`${editor} p`);
  await page.select(control("Line spacing"), "1.5");
  await select(`${editor} p`);
  await page.select(control("Space after"), "16px");
  assert.match(await source(), /font-family:Georgia,serif/);
  assert.match(await source(), /font-size:24px/);
  assert.match(await source(), /text-align:center/);
  await selectText(`${editor} p`, "Designed");
  await page.keyboard.down("Shift");
  await page.keyboard.press("F10");
  await page.keyboard.up("Shift");
  await page.waitForSelector('[role="menu"][aria-label="Editor selection actions"]');
  assert.match(await page.$eval('[role="menu"][aria-label="Editor selection actions"]', el => el.textContent), /Font….*Text color….*Highlight color…/s);
  await page.click('[role="menu"][aria-label="Editor selection actions"] button:nth-child(7)');
  const beforeColor = await source();
  await set(control("Text color hex"), "#12"); // incomplete RGB is only a draft
  assert.equal(await source(), beforeColor);
  await set(control("Text color hex"), "#123456");
  assert.match(await source(), /color:(?:#123456|rgb\(18,52,86\))/);
  assert.equal(await page.$eval(`${editor} span[style*="color"]`, el => el.textContent), "Designed",
    "Focusing the color input must preserve the original selected text only");
  await key("KeyZ");
  assert.equal(await source(), beforeColor);
  await select(`${editor} p`);
  await openInsertSection("Link");
  await set(control("Text link URL"), "https://example.invalid/help");
  await textClick("Add text link");
  assert.equal(await page.$eval(`${editor} a`, el => el.getAttribute("href")), "https://example.invalid/help");
  await page.click(`${editor} a`);
  await select(`${editor} a`);
  await openInsertSection("Link");
  await set(control("Text link URL"), "https://example.invalid/updated-help");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(el =>
    el.textContent.trim() === "Update text link" && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)));
  await textClick("Update text link");
  assert.equal(await page.$eval(`${editor} a`, el => el.getAttribute("href")), "https://example.invalid/updated-help");
  await select(`${editor} a`);
  await openInsertSection("Link");
  await textClick("Remove text link");
  assert.equal(await page.$(`${editor} a`), null);
  assert.match(await source(), /Designed email/);
  const beforeClear = await source();
  assert.match(beforeClear, /line-height:1.5/);
  assert.match(beforeClear, /margin-bottom:16px/);
  await select(`${editor} p`);
  await page.click(direct("Clear formatting"));
  assert.doesNotMatch(await source(), /font-family:|font-size:|text-align:|line-height:/);
  assert.match(await source(), /Designed email/);
  await key("KeyZ");
  assert.equal(await source(), beforeClear, "Clear formatting is undoable");
  await page.keyboard.press("Escape");
  await page.setViewport({ width: 390, height: 1100 });
  await page.waitForFunction(() => !document.querySelector('[data-template-design-toolbar] [data-promoted-tools] [aria-label="HTML source"]'));
  await assertLocation(promoted, false);
  await assertToolbarLayout(390);
  await click("fixture-email-raw-mode");
  assert.match(await page.$eval(id("fixture-email-raw"), el => el.value), /Designed email/);
  await click("fixture-email-raw-mode");
  await select(`${editor} p`);
  await openToolbarPopover("More formatting");
  await page.select(overflow("Line spacing"), "2");
  if (!await page.$(overflow("Space after"))) await openToolbarPopover("More formatting");
  await page.select(overflow("Space after"), "24px");
  await page.keyboard.press("Escape");
  assert.match(await source(), /line-height:2/);
  assert.match(await source(), /margin-bottom:24px/);
  const beforeNarrowClear = await source();
  await select(`${editor} p`);
  await openToolbarPopover("More formatting");
  await page.click(overflow("Clear formatting"));
  assert.doesNotMatch(await source(), /line-height:2|margin-bottom:24px/);
  await key("KeyZ");
  assert.equal(await source(), beforeNarrowClear, "Overflow clear formatting is undoable");
  await page.keyboard.press("Escape");
  await page.setViewport({ width: 980, height: 1100 });
  await page.waitForFunction(() => {
    const count = document.querySelectorAll('div:has(> [data-testid="fixture-email"]) [data-promoted-tools] [aria-label]').length;
    return count > 0 && count < 4;
  });
  await assertToolbarLayout(980);
  for (const label of promoted) {
    if (await page.$(direct(label))) continue;
    await openToolbarPopover("More formatting");
    await page.waitForSelector(overflow(label), { visible: true });
    await page.keyboard.press("Escape");
  }
  await page.setViewport({ width: 1400, height: 1100 });
  await page.waitForSelector(direct("HTML source"));
  await assertLocation(promoted, true);
  console.log("PASS ordinary text links add/update/remove and selection clear formatting/undo");
  await select(editor, true);
  await openInsertSection("Table");
  await set(control("Table rows"), "2");
  await set(control("Table columns"), "2");
  await textClick("Insert table");
  assert.equal(await page.$$eval(`${editor} td`, els => els.length), 4);
  await select(`${editor} td`, true);
  await openInsertSection("Table");
  await textClick("Row below");
  assert.equal(await page.$$eval(`${editor} tr`, els => els.length), 3);
  await select(`${editor} td`, true);
  await openInsertSection("Table");
  await textClick("Column right");
  assert.equal(await page.$$eval(`${editor} td`, els => els.length), 9);
  await select(`${editor} td`, true);
  await openInsertSection("Table");
  await textClick("Merge right");
  assert.equal(await page.$eval(`${editor} td`, el => el.colSpan), 2);
  await select(`${editor} td`, true);
  await openInsertSection("Table");
  await textClick("Split cell");
  assert.equal(await page.$$eval(`${editor} td`, els => els.length), 9);
  await select(`${editor} td`, true);
  await openInsertSection("Table");
  await set(control("Table width"), "80");
  await set(control("Cell padding"), "16");
  await openInsertSection("Table");
  await textClick("Apply table and cell properties");
  assert.equal(await page.$eval(`${editor} table`, el => el.style.width), "80%");
  assert.equal(await page.$eval(`${editor} td`, el => el.style.padding), "16px");
  await select(`${editor} td`, true);
  await openInsertSection("Table");
  await textClick("Delete column");
  await select(`${editor} td`, true);
  await openInsertSection("Table");
  await textClick("Delete row");
  assert.equal(await page.$$eval(`${editor} td`, els => els.length), 4);
  await select(editor, true);
  await openInsertSection("Layout");
  await textClick("2-column layout");
  assert.equal(await page.$$eval(`${editor} table`, els => els.length), 2);
  await select(editor, true);
  await openInsertSection("Button");
  await set(control("Button text"), "View benefits");
  await set(control("Button link"), "https://example.invalid/benefits");
  await textClick("Insert linked button");
  assert.equal(await page.$eval(`${editor} a`, el => el.textContent), "View benefits");
  await select(editor, true);
  await openInsertSection("Image");
  await set(control("Image URL"), "javascript:alert(1)");
  await textClick("Insert image");
  assert.equal(await page.$(`${editor} img`), null);
  assert.match(await page.$eval("body", el => el.textContent), /HTTPS image URL/);
  await set(control("Image URL"), "https://fixture-images.invalid/logo.png");
  await set(control("Image alternative text"), "Benefits logo");
  await set(control("Image width"), "120");
  await textClick("Insert image");
  assert.equal(await page.$eval(`${editor} img`, el => el.alt), "Benefits logo");
  assert.equal(await page.$eval(`${editor} img`, el => el.style.height), "auto");
  await page.click(`${editor} img`);
  const handles = '[aria-label="Selected image"] button';
  await page.waitForSelector(handles);
  assert.equal(await page.$$eval(handles, nodes => nodes.length), 4);
  const overlayPosition = () => page.$eval(`${tools} [aria-label="Selected image"]`, el => {
    const image = document.querySelector('[data-testid="fixture-email"] img').getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return Math.abs(image.left - rect.left) < 2 && Math.abs(image.top - rect.top) < 2;
  });
  assert.equal(await overlayPosition(), true);
  const beforePointerResize = await source();
  const handle = await page.$(`${handles}[aria-label="Resize image SE"]`);
  const rect = await handle.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 32, rect.y + rect.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.$eval(`${editor} img`, el => el.width), 152);
  assert.equal(await page.$eval(`${editor} img`, el => el.style.height), "auto");
  assert.doesNotMatch(await source(), /Selected image|Resize image|templateMovingImage/);
  await click("fixture-email-undo");
  assert.equal(await source(), beforePointerResize, "Pointer drag makes exactly one history entry");
  await click("fixture-email-redo");
  await page.click(`${editor} img`);
  await page.focus(`${handles}[aria-label="Resize image NE"]`);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.$eval(`${editor} img`, el => el.width), 160);
  await click("fixture-email-undo");
  await page.click(`${editor} img`, { button: "right" });
  await page.waitForSelector('[role="menu"][aria-label="Image actions"]');
  for (const alignment of ["center", "right", "left"]) {
    if (alignment !== "center") await page.click(`${editor} img`, { button: "right" });
    await page.click(`[aria-label="Image actions"] button[aria-label="Align ${alignment}"]`);
    assert.equal(await page.$eval(`${editor} img`, el => el.style.marginLeft), alignment === "left" ? "0px" : "auto");
    assert.equal(await page.$eval(`${editor} img`, el => el.style.marginRight), alignment === "right" ? "0px" : "auto");
  }
  await click("fixture-email-undo");
  assert.equal(await page.$eval(`${editor} img`, el => el.style.marginLeft), "auto");
  await click("fixture-email-redo");
  await page.click(`${editor} img`, { button: "right" });
  await page.click('[aria-label="Image actions"] button[aria-label="Edit image"]');
  await page.waitForSelector('[aria-label="Image URL"]:focus');
  await page.click(`${editor} img`, { button: "right" });
  await page.click('[aria-label="Image actions"] button[aria-label="Replace image"]');
  await page.waitForSelector('[aria-label="Image URL"]:focus');
  await page.$eval(editor, el => { el.style.maxHeight = "100px"; el.style.overflow = "auto"; el.scrollTop = 20; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await overlayPosition(), true, "Handles track editor scrolling");
  await click("fixture-email-raw-mode");
  assert.equal(await page.$(handles), null);
  await click("fixture-email-raw-mode");
  assert.doesNotMatch(await source(), /Selected image|Resize image|templateMovingImage/);
  console.log("PASS inline image pointer/keyboard resize, alignment, edit/replace, scroll and source isolation");
  await page.click(`${editor} img`);
  await page.keyboard.down("Shift"); await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift");
  assert.equal(await page.$eval(`${editor} img`, el => el.width), 162, "Keyboard resize preserves the image ratio");
  await key("KeyZ");
  assert.equal(await page.$eval(`${editor} img`, el => el.width), 152);
  await page.$eval(editor, el => {
    const image = el.querySelector("img");
    const target = el.querySelector("p");
    const point = target.getBoundingClientRect();
    const transfer = new DataTransfer();
    image.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: point.left + 8, clientY: point.top + 8,
    }));
  });
  assert.equal(await page.$eval(`${editor} img`, el => el.closest("p")?.textContent), "Designed email",
    "Dropping moves the image to a new insertion point in document flow");
  await key("KeyZ");
  assert.equal(await page.$eval(`${editor} img`, el => el.closest("p")), null);
  await page.click(`${editor} img`);
  await set(control("Image alternative text"), "Updated benefits logo");
  await textClick("Update image");
  assert.equal(await page.$eval(`${editor} img`, el => el.alt), "Updated benefits logo");
  await page.click(`${editor} img`, { button: "right" });
  await page.click('[aria-label="Image actions"] button[aria-label="Delete image"]');
  assert.equal(await page.$(`${editor} img`), null);
  await click("fixture-email-undo");
  assert.equal(await page.$eval(`${editor} img`, el => el.alt), "Updated benefits logo");
  const designed = await source();
  await click("fixture-email-save");
  await click("fixture-email-raw-mode");
  assert.equal(await page.$eval(id("fixture-email-raw"), el => el.value), designed);
  await click("fixture-email-raw-mode");
  await openInsertSection("Image");
  await page.$$eval("summary", nodes => {
    const images = nodes.find(el => el.textContent.trim() === "Image");
    if (images && !images.parentElement.open) images.click();
  });
  await page.click(`${editor} img`);
  await textClick("Delete image");
  assert.equal(await page.$(`${editor} img`), null);
  await click("fixture-email-undo");
  assert.equal(await page.$eval(`${editor} img`, el => el.alt), "Updated benefits logo");
  for (const width of [390, 800, 1400]) await assertToolbarLayout(width);
  await page.setViewport({ width: 1400, height: 1100 });
  await page.screenshot({ path: "screenshots/template-design-authoring.png", fullPage: true });
  await page.reload();
  await click("fixture-email-reopen");
  await page.waitForFunction(expected => document.querySelector('[data-testid="fixture-email-source"]').textContent === expected, {}, designed);
  await click("fixture-email-raw-mode");
  await set(id("fixture-email-raw"), '<p>Before image text</p><p>After image text</p><table><tbody><tr><td>Inside cell</td></tr></tbody></table><p><a href="https://example.invalid/linked"><img src="https://fixture-images.invalid/logo.png" alt="Linked logo" width="120" style="width:120px;height:auto"></a></p>');
  await click("fixture-email-raw-mode");
  await page.waitForSelector(`${editor} img`);
  const linkedBefore = await source();
  const linkedImage = await page.$(`${editor} img`);
  const from = await linkedImage.boundingBox();
  const to = await page.$eval(`${editor} p:nth-of-type(2)`, el => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + 40, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  assert.equal(await page.$eval(`${editor} img`, el => el.closest("a")?.getAttribute("href")), "https://example.invalid/linked");
  assert.notEqual(await source(), linkedBefore, "Real pointer drag moves the linked image");
  await click("fixture-email-undo");
  assert.equal(await source(), linkedBefore);
  await click("fixture-email-redo");
  assert.equal(await page.$$eval(`${editor} img`, els => els.length), 1);
  const intoCellFrom = await (await page.$(`${editor} img`)).boundingBox();
  const cellPoint = await page.$eval(`${editor} td`, el => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + 25, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(intoCellFrom.x + 20, intoCellFrom.y + 20);
  await page.mouse.down();
  await page.mouse.move(cellPoint.x, cellPoint.y, { steps: 12 });
  await page.mouse.up();
  assert.equal(await page.$eval(`${editor} td img`, el => el.closest("a")?.getAttribute("href")), "https://example.invalid/linked");
  await click("fixture-email-undo");
  assert.equal(await page.$(`${editor} td img`), null);
  const beforeCancel = await source();
  const current = await page.$(`${editor} img`);
  const currentBox = await current.boundingBox();
  await page.mouse.move(currentBox.x + 20, currentBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(currentBox.x + 70, currentBox.y + 60, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await source(), beforeCancel, "Escape cancels image movement");
  await page.$eval(editor, el => {
    const image = el.querySelector("img");
    const transfer = new DataTransfer();
    image.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    image.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    image.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
  });
  assert.equal(await source(), beforeCancel, "Dropping on itself is harmless");
  await click("fixture-email-disabled");
  await page.click(`${editor} img`);
  assert.equal(await page.$('[aria-label="Selected image"]'), null);
  assert.equal(await source(), beforeCancel);
  await click("fixture-email-disabled");
  console.log("PASS linked image real drag, undo/redo, canceled/invalid drops and disabled isolation");
  console.log("PASS visual typography, table rows/columns/merge/split/properties, columns, linked button, HTTPS image validation/edit/delete/undo and save/reopen");
  console.log("PASS email history: typing, formatting, token insertion, nested paste; quoted tokens source/save/reopen and disabled isolation");
  return toolbarLayoutFailures;
}