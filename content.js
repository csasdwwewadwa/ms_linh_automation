// content.js - Single instance content runner

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function waitForElementToSettle(element, settleMs = 1000, maxTimeoutMs = 10000) {
  return new Promise((resolve) => {
    let settleTimeout = null;
    let maxTimeout = null;
    const settleObserver = new MutationObserver(resetSettleTimer);

    const cleanup = () => {
      settleObserver.disconnect();
      if (settleTimeout) clearTimeout(settleTimeout);
      if (maxTimeout) clearTimeout(maxTimeout);
    };

    function resetSettleTimer() {
      if (settleTimeout) clearTimeout(settleTimeout);
      settleTimeout = setTimeout(() => {
        cleanup();
        resolve({ success: true, message: `Element went quiet for ${settleMs}ms.` });
      }, settleMs);
    }

    resetSettleTimer();
    settleObserver.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    maxTimeout = setTimeout(() => {
      cleanup();
      resolve({ success: true, message: "Element settle timeout reached." });
    }, maxTimeoutMs);
  });
}

function waitForDOMToSettle(settleMs = 1000, maxTimeoutMs = 10000) {
  return waitForElementToSettle(document.body, settleMs, maxTimeoutMs);
}

function waitForFirstElementToSettle(selector, elementTimeoutMs, settleMs, maxTimeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    function checkElement() {
      const element = document.querySelector(selector);
      if (element) {
        waitForElementToSettle(element, settleMs, maxTimeoutMs).then(resolve);
        return;
      }

      if (Date.now() - startedAt >= elementTimeoutMs) {
        reject(new Error(`Timed out waiting for ${selector}.`));
        return;
      }

      requestAnimationFrame(checkElement);
    }

    checkElement();
  });
}

function waitForInvoiceTableLoaded(timeoutMs, settleMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    function checkTable() {
      const table = document.querySelector("table.ms-table-viewer");
      const rows = table?.querySelectorAll("tbody tr.ms-tr-viewer") || [];
      const hasLoadedRow = Array.from(rows).some((row) => row.querySelectorAll(":scope > td").length > 0);

      if (hasLoadedRow) {
        setTimeout(resolve, settleMs + 200);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Timed out waiting for invoice table to load."));
        return;
      }
      requestAnimationFrame(checkTable);
    }
    checkTable();
  });
}

function clickFirstUnpostedRowAction() {
  const table = document.querySelector("table.ms-table-viewer");
  if (!table) return { success: false, reason: "error", message: "Could not find table.ms-table-viewer." };

  const rows = table.querySelectorAll("tbody tr.ms-tr-viewer");
  for (const row of rows) {
    const cells = row.querySelectorAll(":scope > td");
    const statusCell = cells[1];

    if (!statusCell || statusCell.textContent.trim() !== "Chưa hạch toán") continue;

    const actionCell = cells[cells.length - 1];
    const nestedDiv = actionCell?.querySelector("div div");
    const buttons = nestedDiv ? nestedDiv.querySelectorAll("button") : [];
    const firstButton = buttons[0];

    if (!firstButton || buttons.length < 2) {
      return { success: false, reason: "error", message: "Found row, but missing active actions." };
    }

    firstButton.click();
    return { success: true, message: "Clicked Row action." };
  }
  return { success: false, reason: "no_unposted_rows", message: "No data rows left with Unposted state." };
}

function clickNextPageButton() {
  const paginationDiv = document.querySelector(".ms-pagination");
  if (!paginationDiv) return { success: false, message: "Missing pagination index structure." };

  const nextButton = paginationDiv.querySelector("button[title='Sau']");
  if (!nextButton) return { success: false, message: "Pagination trigger button not found." };

  // Strict evaluation of MISA's disabled attributes/properties
  const isDisabled = 
    nextButton.disabled || 
    nextButton.getAttribute("isdisabled") === "true" || 
    nextButton.classList.contains("disabled");

  if (isDisabled) {
    // Return a specific reason so the dashboard orchestrator knows we hit the absolute end
    return { success: false, reason: "last_page_reached", message: "Pagination threshold reached (End of document feed)." };
  }

  nextButton.click();
  return { success: true, message: "Moved to next page data grid feed." };
}

function waitForCustomerTitle(timeoutMs, settleMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    function checkTitle() {
      const firstInput = document.querySelector("div.customer-info input");
      if (firstInput?.title.trim()) {
        setTimeout(resolve, settleMs + 200);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Timed out waiting for customer entity fields."));
        return;
      }
      requestAnimationFrame(checkTitle);
    }
    checkTitle();
  });
}

function selectImmediatePaymentWhenCustomerIsBL() {
  const customerInfo = document.querySelector("div.customer-info");
  if (!customerInfo) return { success: false, message: "Missing customer contextual container." };

  const firstInput = customerInfo.querySelector("input");
  if (!firstInput) return { success: false, message: "Missing reference identity input." };

  if (firstInput.title !== "BL") {
    return { success: true, message: `Customer validation skipped: Title match code is ${firstInput.title}.` };
  }

  const radioButtons = document.querySelectorAll(".con-ms-radio");
  const immediatePaymentRadio = Array.from(radioButtons)
    .map((radioButton) => radioButton.closest("label"))
    .find((label) => label?.textContent.includes("Thu tiền ngay"));

  if (!immediatePaymentRadio) return { success: false, message: "Failed to locate matching configuration radio." };

  immediatePaymentRadio.click();
  return { success: true, message: "Adjusted payment processing type to Immediate." };
}

function pressCtrlQ() {
  const target = document.activeElement || document.body || document.documentElement;
  const eventOptions = { key: "q", code: "KeyQ", ctrlKey: true, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
  target.dispatchEvent(new KeyboardEvent("keyup", eventOptions));
  return { success: true, message: "Dispatched return command." };
}

function warningTextMatches(warningText, configuredText) {
  const normalizedPattern = normalizeText(configuredText).replace(/\*\*/g, "");
  const escapedPattern = normalizedPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexPattern = escapedPattern.replace(/<1>/g, "\\d+");
  return new RegExp(`^${regexPattern}$`).test(warningText);
}

function checkWarningIfPresent(warnings, targetUrlPrefix) {
  const messageBox = document.querySelector(".con-ms-message-box");
  if (!messageBox) {
    return {
      success: true,
      redirected: window.location.href.startsWith(targetUrlPrefix),
      foundWarning: false
    };
  }

  const contentDiv = messageBox.querySelector(".message-content");
  const warningText = normalizeText(contentDiv ? contentDiv.textContent : "");

  if (!warningText) {
    return {
      success: true,
      redirected: window.location.href.startsWith(targetUrlPrefix),
      foundWarning: false
    };
  }

  const matchedWarning = warnings.find((warning) => warningTextMatches(warningText, warning.text));
  if (!matchedWarning) {
    return { success: false, redirected: false, message: `Unexpected critical modal validation failure: "${warningText}"` };
  }

  if (matchedWarning.action === "reload") {
    return { success: true, redirected: false, foundWarning: true, action: "reload", message: `Reload required for warning modal: ${warningText}` };
  }

  if (matchedWarning.action !== "confirm") {
    return { success: false, redirected: false, message: `Unsupported warning action: "${matchedWarning.action}"` };
  }

  const footer = messageBox.querySelector(".mess-footer");
  const yesButton = Array.from(footer?.querySelectorAll("button") || []).find((button) =>
    normalizeText(button.textContent || "") === "Có"
  );

  if (!yesButton) return { success: false, redirected: false, message: "Failed to identify validation clear button element." };

  yesButton.click();
  return { success: true, redirected: false, foundWarning: true, action: "confirm", message: `Handled warning modal: ${warningText}` };
}

// Global Router Map Injection Intermediary
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case "ping":
          sendResponse({ success: true });
          break;
        case "waitForInvoiceTableLoaded":
          await waitForInvoiceTableLoaded(request.timeoutMs, request.settleMs);
          sendResponse({ success: true });
          break;
        case "waitForDOMToSettle":
          const settleRes = await waitForDOMToSettle(request.settleMs, request.maxTimeoutMs);
          sendResponse(settleRes);
          break;
        case "waitForContentsLayoutToSettle":
          const contentsLayoutResult = await waitForFirstElementToSettle(
            ".contents-layout",
            request.elementTimeoutMs,
            request.settleMs,
            request.maxTimeoutMs
          );
          sendResponse(contentsLayoutResult);
          break;
        case "clickFirstUnpostedRowAction":
          sendResponse(clickFirstUnpostedRowAction());
          break;
        case "clickNextPageButton":
          sendResponse(clickNextPageButton());
          break;
        case "waitForCustomerTitle":
          await waitForCustomerTitle(request.timeoutMs, request.settleMs);
          sendResponse({ success: true });
          break;
        case "selectImmediatePaymentWhenCustomerIsBL":
          sendResponse(selectImmediatePaymentWhenCustomerIsBL());
          break;
        case "pressCtrlQ":
          sendResponse(pressCtrlQ());
          break;
        case "checkWarningIfPresent":
          sendResponse(checkWarningIfPresent(request.warnings, request.targetUrlPrefix));
          break;
        default:
          sendResponse({ success: false, message: "Unknown incoming query key designation." });
      }
    } catch (err) {
      sendResponse({ success: false, message: err.message });
    }
  })();
  return true; 
});