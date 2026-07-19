// dashboard.js - Updated Isolated Orchestrator Window

const TARGET_URL_PREFIX = "https://actasp.misa.vn/app/IP/IPOutputInvoice/IPOutputInvoiceAutomaticList";
const VOUCHER_DETAIL_URL_PREFIX = "https://actasp.misa.vn/app/popup/SAVoucherDetail";
const NAVIGATION_TIMEOUT_MS = 60000;
const CUSTOMER_TITLE_TIMEOUT_MS = 30000;
const CUSTOMER_TITLE_SETTLE_MS = 200;
const TABLE_TIMEOUT_MS = 30000;
const TABLE_SETTLE_MS = 200;

const runButton = document.getElementById("runAutomation");
const toggleTargetWindowButton = document.getElementById("toggleTargetWindow");
const statusText = document.getElementById("status");
const cycleCounterText = document.getElementById("cycleCounter");
const dashboardParameters = new URLSearchParams(window.location.search);

let isLooping = false;
let warningsCache = null;
let targetTabId = Number.parseInt(dashboardParameters.get("targetTabId"), 10) || null;
let targetWindowId = Number.parseInt(dashboardParameters.get("targetWindowId"), 10) || null;
const helperPort = Number.parseInt(dashboardParameters.get("helperPort"), 10) || null;
const helperToken = dashboardParameters.get("helperToken");
let isTargetWindowHidden = false;
let stopReason = null;
let translations = {};

function t(key, parameters = {}, fallback = key) {
  const template = translations[key] || fallback;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : match
  );
}

async function loadLocalization() {
  try {
    const response = await fetch(chrome.runtime.getURL("locales/vi.json"));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    translations = await response.json();
  } catch (error) {
    console.error("Failed to load Vietnamese localization:", error);
  }

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n, {}, element.textContent);
  });
}

const localizationReady = loadLocalization();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getBoundTargetTab() {
  if (!targetTabId || !targetWindowId) return null;

  try {
    const tab = await chrome.tabs.get(targetTabId);
    if (tab.windowId !== targetWindowId || !tab.url?.includes("misa.vn")) return null;
    return tab;
  } catch (error) {
    return null;
  }
}

async function sendNativeWindowCommand(action) {
  if (!helperPort || !helperToken) {
    throw new Error(t("status.nativeHelperRequired", {}, "Launch the app with launch-misa.cmd to use native window controls."));
  }

  const helperUrl = new URL(`http://127.0.0.1:${helperPort}/${action}`);
  helperUrl.searchParams.set("token", helperToken);
  let response;
  try {
    response = await fetch(helperUrl);
  } catch (error) {
    throw new Error(
      "Native window helper is unavailable. Relaunch the application with launch-misa.cmd, then try again."
    );
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error("Native window helper returned an invalid response.");
  }
  if (!response.ok || !result.success) {
    throw new Error(result.message || `Native window command failed: ${action}`);
  }
  return result;
}

async function toggleTargetWindowVisibility() {
  const targetTab = await getBoundTargetTab();
  if (!targetTab) {
    showFailure(t("status.targetUnavailable", {}, "The bound MISA window is no longer available."));
    toggleTargetWindowButton.disabled = true;
    return;
  }

  try {
    if (isTargetWindowHidden) {
      await sendNativeWindowCommand("show");
      isTargetWindowHidden = false;
      toggleTargetWindowButton.textContent = t("button.hideTarget", {}, "Hide MISA window");
      setStatus(t("status.targetRestored", {}, "MISA window restored."));
      return;
    }

    await sendNativeWindowCommand("hide");
    isTargetWindowHidden = true;
    toggleTargetWindowButton.textContent = t("button.restoreTarget", {}, "Show MISA window");
    setStatus(t("status.targetHidden", {}, "MISA window moved off-screen. Automation remains active."));
  } catch (error) {
    showFailure(t("status.targetVisibilityError", { message: error.message }, `Could not move the MISA window: ${error.message}`));
  }
}

function setStatus(message) {
  // Clear layout colors during active working updates
  statusText.classList.remove("error-state", "success-state", "warning-state");
  statusText.textContent = message;
  console.log(`[Automation Status]: ${message}`);
}


function showFailure(message) {
  statusText.classList.remove("success-state", "warning-state");
  statusText.classList.add("error-state");
  statusText.textContent = message || t("status.failed", {}, "Automation failed.");
  console.error(`[Automation Error]: ${message}`);
  
  forceRestoreDashboardWindow(); // <-- Jumps onto your screen on a hard crash
}

function showSuccessSummary(message) {
  statusText.classList.remove("error-state");
  statusText.classList.add("success-state");
  statusText.textContent = message;
}

function sendTabMessage(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function ensureContentScriptActive(tabId) {
  try {
    await sendTabMessage(tabId, { action: "ping" });
  } catch (err) {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"]
    });
    await delay(300);
  }
}

async function startTargetWindowMinimizeMonitor(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.windowId) {
    throw new Error("Could not identify the MISA browser window.");
  }

  const monitoredWindowId = tab.windowId;
  let isCheckingWindow = false;
  let hasStoppedAutomation = false;

  function stopForMinimization() {
    if (hasStoppedAutomation || !isLooping) return;

    hasStoppedAutomation = true;
    stopReason = "minimized";
    isLooping = false;
    statusText.classList.remove("error-state", "success-state");
    statusText.classList.add("warning-state");
    statusText.textContent = t(
      "status.minimized",
      {},
      "Automation stopped because the MISA Chrome window was minimized."
    );
    resetButtonState();
    forceRestoreDashboardWindow();
  }

  function onWindowBoundsChanged(changedWindow) {
    if (changedWindow.id === monitoredWindowId && changedWindow.state === "minimized") {
      stopForMinimization();
    }
  }

  async function checkWindowState() {
    if (isCheckingWindow || hasStoppedAutomation || !isLooping) return;
    isCheckingWindow = true;
    try {
      const targetWindow = await chrome.windows.get(monitoredWindowId);
      if (targetWindow.state === "minimized") {
        stopForMinimization();
      }
    } catch (error) {
      console.error("Failed to monitor MISA window state:", error);
    } finally {
      isCheckingWindow = false;
    }
  }

  chrome.windows.onBoundsChanged.addListener(onWindowBoundsChanged);
  const pollInterval = setInterval(checkWindowState, 250);
  await checkWindowState();

  return () => {
    clearInterval(pollInterval);
    chrome.windows.onBoundsChanged.removeListener(onWindowBoundsChanged);
  };
}

async function forceRestoreDashboardWindow() {
  try {
    const currentWin = await chrome.windows.getCurrent();
    if (!currentWin || !currentWin.id) return;

    await chrome.windows.update(currentWin.id, { state: "normal" });
    await chrome.windows.update(currentWin.id, {
      focused: true,
      drawAttention: true
    });
  } catch (err) {
    console.error("Failed to aggressively restore dashboard window:", err);
  }
}



function waitForInvoiceListPage(tabId) {
  return new Promise((resolve, reject) => {
    let isWaitingForTable = false;
    const startedAt = Date.now();

    const timeoutId = setTimeout(() => {
      reject(new Error("Timed out waiting for invoice list to load."));
    }, NAVIGATION_TIMEOUT_MS + TABLE_TIMEOUT_MS);

    async function waitForTable() {
      try {
        await sendTabMessage(tabId, {
          action: "waitForInvoiceTableLoaded",
          timeoutMs: TABLE_TIMEOUT_MS,
          settleMs: TABLE_SETTLE_MS
        });
        await sendTabMessage(tabId, {
          action: "waitForContentsLayoutToSettle",
          elementTimeoutMs: TABLE_TIMEOUT_MS,
          settleMs: 500,
          maxTimeoutMs: 5000
        });
        await delay(200);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
        return;
      }
      clearTimeout(timeoutId);
      resolve();
    }

    function checkCurrentTab() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || isWaitingForTable) return;

        if (tab.url?.startsWith(TARGET_URL_PREFIX)) {
          isWaitingForTable = true;
          waitForTable();
          return;
        }

        if (Date.now() - startedAt >= NAVIGATION_TIMEOUT_MS) {
          clearTimeout(timeoutId);
          reject(new Error("Timed out waiting for invoice list redirect."));
          return;
        }
        setTimeout(checkCurrentTab, 100);
      });
    }
    checkCurrentTab();
  });
}

function waitForVoucherDetailPage(tabId, tableWarnings) {
  return new Promise((resolve, reject) => {
    let isSettling = false;
    let isComplete = false;
    let warningCheckTimeout = null;

    function cleanup() {
      isComplete = true;
      clearTimeout(timeoutId);
      if (warningCheckTimeout) clearTimeout(warningCheckTimeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve({ action: "detail_timeout" });
    }, NAVIGATION_TIMEOUT_MS);

    async function complete() {
      if (isSettling) return;
      isSettling = true;

      try {
        const customerTitleResult = await sendTabMessage(tabId, {
          action: "waitForCustomerTitle",
          timeoutMs: CUSTOMER_TITLE_TIMEOUT_MS,
          settleMs: CUSTOMER_TITLE_SETTLE_MS
        });
        if (!customerTitleResult?.success) {
          throw new Error(customerTitleResult?.message || "Customer title is empty or unavailable.");
        }
        await sendTabMessage(tabId, { action: "waitForDOMToSettle" });
        await delay(200);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }

      cleanup();
      resolve({ action: "detail_loaded" });
    }

    async function checkForTableWarning() {
      if (isComplete || isSettling) return;

      try {
        const warningResult = await sendTabMessage(tabId, {
          action: "checkWarningIfPresent",
          warnings: tableWarnings,
          targetUrlPrefix: VOUCHER_DETAIL_URL_PREFIX
        });

        if (warningResult.action === "reload") {
          cleanup();
          resolve({ action: "reload" });
          return;
        }

        if (!warningResult.success) {
          cleanup();
          reject(new Error(warningResult.message || "Unknown modal blockage while opening voucher detail."));
          return;
        }
      } catch (error) {
        console.log("Waiting for detail-page messaging pipe alignment...", error.message);
      }

      if (!isComplete && !isSettling) {
        warningCheckTimeout = setTimeout(checkForTableWarning, 150);
      }
    }

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId || !tab.url?.startsWith(VOUCHER_DETAIL_URL_PREFIX)) return;
      if (changeInfo.status === "complete") {
        complete();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab.url?.startsWith(VOUCHER_DETAIL_URL_PREFIX) && tab.status === "complete") {
        complete();
      }
    });
    checkForTableWarning();
  });
}

let currentPass = 1; 

async function runAutomation() {
  try {
    if (!warningsCache) {
      const warningFiles = ["invoice_warning.json", "table_warning.json"];
      const responses = await Promise.all(warningFiles.map((file) => fetch(chrome.runtime.getURL(file))));
      warningsCache = (await Promise.all(responses.map((response) => response.json()))).flat();
    }

    setStatus(t("status.waitingInvoiceTable", { pass: currentPass }, `[Pass ${currentPass}] Waiting for invoice table...`));
    await sendTabMessage(targetTabId, {
      action: "waitForInvoiceTableLoaded",
      timeoutMs: TABLE_TIMEOUT_MS,
      settleMs: TABLE_SETTLE_MS
    });
    
    await delay(200);
    if (!isLooping) return { status: "halt" };

    const clicked = await sendTabMessage(targetTabId, { action: "clickFirstUnpostedRowAction" });

    if (!clicked?.success) {
      if (clicked?.reason === "no_unposted_rows") {
        setStatus(t("status.noMatchingRows", { pass: currentPass }, `[Pass ${currentPass}] No matching rows on this page. Advancing page...`));
        
        const pageClicked = await sendTabMessage(targetTabId, { action: "clickNextPageButton" });
        
        if (!pageClicked?.success) {
          if (pageClicked?.reason === "last_page_reached") {
            // Signal to the loop runner that this pass is officially finished!
            return { status: "pass_complete" };
          }
          showFailure(t("status.paginationError", {
            message: pageClicked?.message || t("status.finished", {}, "Finished.")
          }, `Pagination error: ${pageClicked?.message || "Finished."}`));
          return { status: "halt" }; 
        }

        setStatus(t("status.waitingNextPage", { pass: currentPass }, `[Pass ${currentPass}] Waiting for next page table...`));
        await sendTabMessage(targetTabId, {
          action: "waitForInvoiceTableLoaded",
          timeoutMs: TABLE_TIMEOUT_MS,
          settleMs: TABLE_SETTLE_MS
        });

        await sendTabMessage(targetTabId, { action: "waitForDOMToSettle" });
        return { status: "continue" }; 
      }
      showFailure(clicked?.message || t("status.rowHalted", {}, "Row manipulation halted."));
      return { status: "halt" }; 
    }

    setStatus(t("status.waitingVoucherDetail", { pass: currentPass }, `[Pass ${currentPass}] Waiting for voucher detail...`));
    const detailPageResult = await waitForVoucherDetailPage(
      targetTabId,
      warningsCache.filter((warning) => warning.action === "reload")
    );

    if (!isLooping) return { status: "halt" };

    if (detailPageResult.action === "reload") {
      setStatus(t("status.postedWarningReload", { pass: currentPass }, `[Pass ${currentPass}] Posted invoice warning found. Reloading invoice list...`));
      await chrome.tabs.reload(targetTabId);
      await waitForInvoiceListPage(targetTabId);
      await ensureContentScriptActive(targetTabId);
      return { status: "continue" };
    }

    if (detailPageResult.action === "detail_timeout") {
      setStatus(t("status.detailTimeout", { pass: currentPass }, `[Pass ${currentPass}] Voucher detail timed out. Reopening invoice list...`));
      await chrome.tabs.update(targetTabId, { url: TARGET_URL_PREFIX });
      await waitForInvoiceListPage(targetTabId);
      await ensureContentScriptActive(targetTabId);
      return { status: "continue" };
    }

    const result = await sendTabMessage(targetTabId, { action: "selectImmediatePaymentWhenCustomerIsBL" });
    if (!result?.success) {
      showFailure(result?.message || t("status.detailActionFailed", {}, "Could not finish detail page action."));
      return { status: "halt" };
    }

    setStatus(t("status.waitingSelectionSettle", { pass: currentPass }, `[Pass ${currentPass}] Waiting for selection adjustments to settle...`));
    await sendTabMessage(targetTabId, {
      action: "waitForDOMToSettle",
      settleMs: 500,
      maxTimeoutMs: 3000
    });

    setStatus(t("status.returningToList", { pass: currentPass }, `[Pass ${currentPass}] Returning to invoice list...`));
    await sendTabMessage(targetTabId, { action: "pressCtrlQ" });

    await delay(200);
    if (!isLooping) return { status: "halt" };

    setStatus(t("status.monitoringWarnings", { pass: currentPass }, `[Pass ${currentPass}] Monitoring for warning modals or redirection...`));
    let warningCheckComplete = false;
    let warningSuccess = false;
    let warningMessage = "";
    const warningStart = Date.now();
    const MAX_WARNING_WAIT_MS = 6000; 

    while (!warningCheckComplete) {
      if (!isLooping) return { status: "halt" };

      if (Date.now() - warningStart > MAX_WARNING_WAIT_MS) {
        warningSuccess = false;
        warningMessage = t("status.warningTimeout", {}, "Warning/Redirect processing timed out.");
        warningCheckComplete = true;
        break;
      }

      try {
        const warningResult = await sendTabMessage(targetTabId, {
          action: "checkWarningIfPresent",
          warnings: warningsCache,
          targetUrlPrefix: TARGET_URL_PREFIX
        });

        if (!isLooping) return { status: "halt" };

        if (warningResult.redirected) {
          warningSuccess = true;
          warningCheckComplete = true;
        } else if (!warningResult.success) {
          warningSuccess = false;
          warningMessage = warningResult.message || t("status.unknownModal", {}, "Unknown modal blockage error.");
          warningCheckComplete = true;
        } else if (warningResult.action === "reload") {
          setStatus(t("status.postedWarningReload", { pass: currentPass }, `[Pass ${currentPass}] Posted invoice warning found. Reloading invoice list...`));
          await chrome.tabs.reload(targetTabId);
          await waitForInvoiceListPage(targetTabId);
          await ensureContentScriptActive(targetTabId);
          return { status: "continue" };
        } else if (warningResult.foundWarning) {
          setStatus(t("status.warningCleared", { pass: currentPass }, `[Pass ${currentPass}] Warning popup cleared. Stabilizing...`));
          await sendTabMessage(targetTabId, {
            action: "waitForDOMToSettle",
            settleMs: 300,
            maxTimeoutMs: 2000
          });
        }
      } catch (err) {
        console.log("Waiting for messaging pipe alignment...", err.message);
      }

      await delay(150);
    }

    if (!warningSuccess) {
      showFailure(t("status.warningHalt", { message: warningMessage }, `Halt in Warning processing: ${warningMessage}`));
      return { status: "halt" };
    }

    if (!isLooping) return { status: "halt" };

    setStatus(t("status.verifyingList", { pass: currentPass }, `[Pass ${currentPass}] Verifying list layout stability...`));
    await waitForInvoiceListPage(targetTabId);
    return { status: "continue" }; 
  } catch (error) {
    if (!isLooping) return { status: "halt" };

    if (error.message === "Timed out waiting for invoice list to load.") {
      setStatus(t("status.listTimeout", { pass: currentPass }, `[Pass ${currentPass}] Invoice list timed out. Reopening invoice list...`));
      await chrome.tabs.update(targetTabId, { url: TARGET_URL_PREFIX });
      await waitForInvoiceListPage(targetTabId);
      await ensureContentScriptActive(targetTabId);
      return { status: "continue" };
    }

    showFailure(t("status.executionError", { message: error.message }, `Execution Error: ${error.message}`));
    return { status: "halt" };
  }
}

async function runAutomationOnLoop() {
  let counter = 0;
  let stopMinimizeMonitor = null;
  currentPass = 1; // Reset to the initial processing pass
  stopReason = null;
  cycleCounterText.textContent = "0";
  
  const currentMisaTab = await getBoundTargetTab();

  if (!currentMisaTab) {
    showFailure(t("status.notMisaPage", {}, "Error: The launched MISA tab is not available."));
    resetButtonState();
    return;
  }

  if (!currentMisaTab.url?.startsWith(TARGET_URL_PREFIX)) {
    showFailure(t("status.wrongPage", { url: TARGET_URL_PREFIX }, `Error: Active tab is not on the correct page.\nExpected: ${TARGET_URL_PREFIX}`));
    resetButtonState();
    return;
  }

  try {
    await ensureContentScriptActive(targetTabId);
    stopMinimizeMonitor = await startTargetWindowMinimizeMonitor(targetTabId);
  } catch (e) {
    showFailure(t("status.initializationError", {}, "Initialization error connecting with active MISA tab."));
    resetButtonState();
    return;
  }

  while (isLooping) {
    counter++;
    setStatus(t("status.loopCycle", { pass: currentPass, counter }, `--- Pass #${currentPass} | Loop Cycle #${counter} ---`));
    
    // Execute a standard cycle transaction
    const stepResult = await runAutomation();
    
    if (stepResult.status === "halt" || !isLooping) {
      if (!isLooping && stopReason !== "minimized") {
        setStatus(t("status.stoppedManually", {}, "Automation stopped manually by user."));
      }
      break;
    }

    // Dynamic UI counter update
    cycleCounterText.textContent = counter;

    // HANDLE PASSED THRESHOLD COMPLETIONS
    if (stepResult.status === "pass_complete") {
      if (!isLooping) break;

      if (currentPass === 1) {
        setStatus(t("status.firstPassComplete", {}, "First full pass complete! Hard reloading page back to Page 1 to begin verification pass..."));
        
        currentPass = 2; // Elevate to the validation pass
        chrome.tabs.reload(targetTabId);
        
        await delay(5000); // Generous delay to let context dump and refresh run cleanly
        if (!isLooping) break;
        await ensureContentScriptActive(targetTabId);
        await waitForInvoiceListPage(targetTabId);
        if (!isLooping) break;
        continue; // Cycle immediately back to work on the fresh page sequence
      } else {
        // Pass 2 complete! Everything has been explicitly swept and confirmed
        showSuccessSummary(t("status.success", { counter }, `Double-check verification complete!\n\nAll documents across all pages successfully matched and validated over 2 full engine runs. Total operational steps: ${counter}`));
        break;
      }
    }

    // SYSTEMIC GC REBOOT (Every 50 single modifications, perform structural memory wipe)
    if (counter % 50 === 0) {
      if (!isLooping) break;
      setStatus(t("status.maintenanceReload", {}, "Cycle block milestone hit. Hard reloading target tab to wipe systemic application memory leaks..."));
      chrome.tabs.reload(targetTabId);
      await delay(4000); 
      if (!isLooping) break;
      await ensureContentScriptActive(targetTabId);
      await waitForInvoiceListPage(targetTabId);
      if (!isLooping) break;
    }

    await delay(500); 
  }

  if (stopMinimizeMonitor) stopMinimizeMonitor();
  if (stopReason !== "manual") {
    await forceRestoreDashboardWindow();
  }
  resetButtonState();
}

function resetButtonState() {
  isLooping = false;
  runButton.textContent = t("button.start", {}, "Start");
  runButton.classList.remove("stop-state");
}

async function handleButtonClick() {
  await localizationReady;

  if (isLooping) {
    stopReason = "manual";
    isLooping = false;
    setStatus(t("status.stopRequested", {}, "Stop requested. Awaiting current row transaction step down..."));
    runButton.textContent = t("button.stopping", {}, "Stopping...");
  } else {
    isLooping = true;
    runButton.textContent = t("button.stop", {}, "Stop");
    runButton.classList.add("stop-state");
    runAutomationOnLoop();
  }
}

runButton.addEventListener("click", handleButtonClick);
toggleTargetWindowButton.addEventListener("click", toggleTargetWindowVisibility);
toggleTargetWindowButton.disabled = !targetTabId || !targetWindowId || !helperPort || !helperToken;
if (!helperPort || !helperToken) {
  toggleTargetWindowButton.title = t(
    "status.nativeHelperRequired",
    {},
    "Launch the app with launch-misa.cmd to use native window controls."
  );
}