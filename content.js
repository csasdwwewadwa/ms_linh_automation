// content.js - Single instance content runner

let settleObserver = null;
let settleTimeout = null;

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function waitForDOMToSettle(settleMs = 1000, maxTimeoutMs = 10000) {
  return new Promise((resolve) => {
    const cleanup = () => {
      if (settleObserver) settleObserver.disconnect();
      if (settleTimeout) clearTimeout(settleTimeout);
    };

    const resetSettleTimer = () => {
      if (settleTimeout) clearTimeout(settleTimeout);
      settleTimeout = setTimeout(() => {
        cleanup();
        resolve({ success: true, message: `DOM went quiet for ${settleMs}ms.` });
      }, settleMs);
    };

    resetSettleTimer();
    settleObserver = new MutationObserver(resetSettleTimer);
    settleObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    setTimeout(() => {
      cleanup();
      resolve({ success: true, message: "Settle timeout reached." });
    }, maxTimeoutMs);
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

function confirmSkipWarningIfPresent(skipWarnings, targetUrlPrefix) {
  if (window.location.href.startsWith(targetUrlPrefix)) {
    return { success: true, redirected: true, message: "Navigated." };
  }

  const messageBox = document.querySelector(".con-ms-message-box");
  if (!messageBox) return { success: true, redirected: false, foundWarning: false };

  const contentDiv = messageBox.querySelector(".message-content");
  const warningText = normalizeText(contentDiv ? contentDiv.textContent : "");

  if (!warningText) return { success: true, redirected: false, foundWarning: false };

  const normalizedSkipWarnings = skipWarnings.map(w => normalizeText(w));
  if (!normalizedSkipWarnings.includes(warningText)) {
    return { success: false, redirected: false, message: `Unexpected critical modal validation failure: "${warningText}"` };
  }

  const footer = messageBox.querySelector(".mess-footer");
  const yesButton = Array.from(footer?.querySelectorAll("button") || []).find((button) =>
    normalizeText(button.textContent || "") === "Có"
  );

  if (!yesButton) return { success: false, redirected: false, message: "Failed to identify validation clear button element." };

  yesButton.click();
  return { success: true, redirected: false, foundWarning: true, message: `Handled warning modal: ${warningText}` };
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
        case "confirmSkipWarningIfPresent":
          sendResponse(confirmSkipWarningIfPresent(request.skipWarnings, request.targetUrlPrefix));
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