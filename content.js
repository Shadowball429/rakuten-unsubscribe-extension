(() => {
  "use strict";

  const isConfirmationPage = () => location.origin === "https://cart.step.rakuten.co.jp" &&
    /^\/order-confirmation\/?$/.test(location.pathname);
  if (location.origin !== "https://cart.step.rakuten.co.jp") return;

  const checkboxSelector = 'input[type="checkbox"], [role="checkbox"]';
  const normalize = (text) => (text || "").replace(/\s+/g, "");
  const title = "メルマガ配信設定";
  const description = "楽天会員情報にご登録されているメールアドレス宛に";
  const targetLabel = "全てのお知らせを受け取る";
  let attempts = new WeakMap();
  let userInteracted = false;
  let inConfirmationPage = false;

  function updateVisit() {
    const current = isConfirmationPage();
    if (current === inConfirmationPage) return;
    inConfirmationPage = current;
    userInteracted = false;
    attempts = new WeakMap();
    observer.disconnect();
    if (current) observer.observe(document, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["checked", "aria-checked", "disabled", "aria-disabled", "readonly", "aria-readonly", "role", "type"],
    });
  }

  // Find the smallest matching ancestor without crossing a form/page boundary.
  function newsletterRegion(element) {
    for (let region = element.parentElement; region && !region.matches("body, html, form");
      region = region.parentElement) {
      const text = normalize(region.textContent);
      if (text.includes(title) && text.includes(description)) return region;
    }
    return null;
  }

  function newsletterRegions() {
    const regions = [];
    for (const button of document.querySelectorAll('button[type="button"]')) {
      if (normalize(button.getAttribute("aria-label") || button.textContent) !== "すべての選択を解除") continue;
      const region = newsletterRegion(button);
      if (region) regions.push(region);
    }
    return regions;
  }

  function labelText(box) {
    const ids = (box.getAttribute("aria-labelledby") || "").split(/\s+/);
    return normalize([
      ...Array.from(box.labels || [], (label) => label.textContent),
      box.getAttribute("aria-label"),
      ...ids.map((id) => document.getElementById(id)?.textContent),
      // Custom checkboxes often place their caption beside the control.
      box.parentElement?.textContent,
    ].join(" "));
  }

  function isTarget(box, regions) {
    return regions.some((region) => region.contains(box)) ||
      (labelText(box).includes(targetLabel) && newsletterRegion(box) !== null);
  }

  function canOperate(control) {
    return !control.disabled && !control.readOnly &&
      control.getAttribute("aria-disabled") !== "true" &&
      control.getAttribute("aria-readonly") !== "true";
  }

  function needsOff(box) {
    return box.checked === true || ["true", "mixed"].includes(box.getAttribute("aria-checked"));
  }

  function retryClick(control) {
    const now = Date.now();
    const previous = attempts.get(control);
    if (previous && now < previous.next) return;
    // Keep retrying after slow initialization, but back off to one click per 5s.
    const delay = previous ? Math.min(previous.delay * 2, 5000) : 500;
    attempts.set(control, { delay, next: now + delay });
    control.click();
  }

  function turnOff() {
    updateVisit();
    if (userInteracted || !inConfirmationPage) return;
    const regions = newsletterRegions();
    const handled = new Set();
    for (const region of regions) {
      const boxes = [...region.querySelectorAll(checkboxSelector)];
      const button = [...region.querySelectorAll('button[type="button"]')].find((candidate) =>
        normalize(candidate.getAttribute("aria-label") || candidate.textContent) === "すべての選択を解除");
      if (!button || !canOperate(button)) continue;
      boxes.forEach((box) => handled.add(box));
      if (boxes.some((box) => canOperate(box) && needsOff(box))) {
        // The page's clear-all action is idempotent, including when checked and
        // aria-checked disagree. Never toggle an unchecked input back on.
        retryClick(button);
      } else {
        attempts.delete(button);
      }
    }
    for (const box of document.querySelectorAll(checkboxSelector)) {
      if (handled.has(box) || !canOperate(box) || !isTarget(box, regions)) continue;
      const checked = box.matches('input[type="checkbox"]')
        ? box.checked : box.getAttribute("aria-checked") === "true";
      if (checked) retryClick(box);
      else if (!needsOff(box)) attempts.delete(box);
    }
  }

  function stopAutomaticChanges() {
    userInteracted = true;
    observer.disconnect();
  }

  // Honor an explicit user choice after the initial automatic opt-out.
  function respectUser(event) {
    updateVisit();
    if (!inConfirmationPage || userInteracted || !event.isTrusted || !(event.target instanceof Element)) return;
    const regions = newsletterRegions();
    const button = event.target.closest("button");
    if (button && regions.some((region) => region.contains(button))) {
      stopAutomaticChanges();
      return;
    }
    const box = event.target.closest(checkboxSelector) ||
      event.target.closest("label")?.control;
    if (box && isTarget(box, regions)) stopAutomaticChanges();
  }
  function respectKey(event) {
    if (event.key === " " || event.key === "Enter") respectUser(event);
  }
  document.addEventListener("click", respectUser, true);
  document.addEventListener("keydown", respectKey, true);

  const observer = new MutationObserver(turnOff);
  window.addEventListener("popstate", turnOff);
  window.addEventListener("pageshow", turnOff);
  turnOff();
  // pushState/replaceState do not emit popstate. Poll the URL even when the
  // observer is stopped; also detect property-only changes on the target page.
  setInterval(turnOff, 500);
})();
