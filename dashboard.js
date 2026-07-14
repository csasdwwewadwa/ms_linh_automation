// dashboard.js - Updated Isolated Orchestrator Window

const TARGET_URL_PREFIX = "https://actasp.misa.vn/app/IP/IPOutputInvoice/IPOutputInvoiceAutomaticList";
const VOUCHER_DETAIL_URL_PREFIX = "https://actasp.misa.vn/app/popup/SAVoucherDetail";
const NAVIGATION_TIMEOUT_MS = 60000;
const CUSTOMER_TITLE_TIMEOUT_MS = 30000;
const CUSTOMER_TITLE_SETTLE_MS = 200;
const TABLE_TIMEOUT_MS = 30000;
const TABLE_SETTLE_MS = 200;

const runButton = document.getElementById("runAutomation");
const statusText = document.getElementById("status");
const cycleCounterText = document.getElementById("cycleCounter");

let isLooping = false;
let skipWarningsCache = null; 
let targetTabId = null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setStatus(message) {
  // Clear layout colors during active working updates
  statusText.classList.remove("error-state", "success-state");
  statusText.textContent = message;
  console.log(`[Automation Status]: ${message}`);
}


function showFailure(message) {
  statusText.classList.remove("success-state", "warning-state");
  statusText.classList.add("error-state");
  statusText.textContent = message || "Automation failed.";
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

async function isTargetWindowMinimized(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.windowId) return false;
    
    const win = await chrome.windows.get(tab.windowId);
    return win.state === "minimized";
  } catch (err) {
    console.error("Failed to check window state:", err);
    return false;
  }
}

async function forceRestoreDashboardWindow() {
  try {
    const currentWin = await chrome.windows.getCurrent();
    // Setting state to "normal" expands it if it was minimized
    await chrome.windows.update(currentWin.id, { state: "normal", focused: true }); //
  } catch (err) {
    console.error("Failed to restore dashboard window:", err);
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
        await sendTabMessage(tabId, { action: "waitForDOMToSettle" });
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

function waitForVoucherDetailPage(tabId) {
  return new Promise((resolve, reject) => {
    let isSettling = false;

    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Timed out waiting for SAVoucherDetail to load."));
    }, NAVIGATION_TIMEOUT_MS);

    async function complete() {
      if (isSettling) return;
      isSettling = true;

      try {
        await sendTabMessage(tabId, {
          action: "waitForCustomerTitle",
          timeoutMs: CUSTOMER_TITLE_TIMEOUT_MS,
          settleMs: CUSTOMER_TITLE_SETTLE_MS
        });
        await sendTabMessage(tabId, { action: "waitForDOMToSettle" });
        await delay(200);
      } catch (error) {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(error);
        return;
      }

      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
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
  });
}

let currentPass = 1; 

async function runAutomation() {
  try {
    if (!skipWarningsCache) {
      const response = await fetch(chrome.runtime.getURL("skip_warning.json"));
      skipWarningsCache = await response.json();
    }

    setStatus(`[Pass ${currentPass}] Waiting for invoice table...`);
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
        setStatus(`[Pass ${currentPass}] No matching rows on this page. Advancing page...`);
        
        const pageClicked = await sendTabMessage(targetTabId, { action: "clickNextPageButton" });
        
        if (!pageClicked?.success) {
          if (pageClicked?.reason === "last_page_reached") {
            // Signal to the loop runner that this pass is officially finished!
            return { status: "pass_complete" };
          }
          showFailure(`Pagination error: ${pageClicked?.message || "Finished."}`);
          return { status: "halt" }; 
        }

        setStatus(`[Pass ${currentPass}] Waiting for next page table...`);
        await sendTabMessage(targetTabId, {
          action: "waitForInvoiceTableLoaded",
          timeoutMs: TABLE_TIMEOUT_MS,
          settleMs: TABLE_SETTLE_MS
        });

        await sendTabMessage(targetTabId, { action: "waitForDOMToSettle" });
        return { status: "continue" }; 
      }
      showFailure(clicked?.message || "Row manipulation halted.");
      return { status: "halt" }; 
    }

    setStatus(`[Pass ${currentPass}] Waiting for voucher detail...`);
    await waitForVoucherDetailPage(targetTabId);

    if (!isLooping) return { status: "halt" };

    const result = await sendTabMessage(targetTabId, { action: "selectImmediatePaymentWhenCustomerIsBL" });
    if (!result?.success) {
      showFailure(result?.message || "Could not finish detail page action.");
      return { status: "halt" };
    }

    setStatus(`[Pass ${currentPass}] Waiting for selection adjustments to settle...`);
    await sendTabMessage(targetTabId, {
      action: "waitForDOMToSettle",
      settleMs: 500,
      maxTimeoutMs: 3000
    });

    setStatus(`[Pass ${currentPass}] Returning to invoice list...`);
    await sendTabMessage(targetTabId, { action: "pressCtrlQ" });

    await delay(200);
    if (!isLooping) return { status: "halt" };

    setStatus(`[Pass ${currentPass}] Monitoring for warning modals or redirection...`);
    let warningCheckComplete = false;
    let warningSuccess = false;
    let warningMessage = "";
    const warningStart = Date.now();
    const MAX_WARNING_WAIT_MS = 6000; 

    while (!warningCheckComplete) {
      if (!isLooping) return { status: "halt" };

      const currentTab = await chrome.tabs.get(targetTabId);
      if (currentTab.url?.startsWith(TARGET_URL_PREFIX)) {
        warningSuccess = true;
        warningMessage = "Redirect complete.";
        warningCheckComplete = true;
        break;
      }

      if (Date.now() - warningStart > MAX_WARNING_WAIT_MS) {
        warningSuccess = false;
        warningMessage = "Warning/Redirect processing timed out.";
        warningCheckComplete = true;
        break;
      }

      try {
        const warningResult = await sendTabMessage(targetTabId, {
          action: "confirmSkipWarningIfPresent",
          skipWarnings: skipWarningsCache,
          targetUrlPrefix: TARGET_URL_PREFIX
        });

        if (warningResult.redirected) {
          warningSuccess = true;
          warningCheckComplete = true;
        } else if (!warningResult.success) {
          warningSuccess = false;
          warningMessage = warningResult.message || "Unknown modal blockage error.";
          warningCheckComplete = true;
        } else if (warningResult.foundWarning) {
          setStatus(`[Pass ${currentPass}] Warning popup cleared. Stabilizing...`);
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
      showFailure(`Halt in Warning processing: ${warningMessage}`);
      return { status: "halt" };
    }

    if (!isLooping) return { status: "halt" };

    setStatus(`[Pass ${currentPass}] Verifying list layout stability...`);
    await waitForInvoiceListPage(targetTabId);
    return { status: "continue" }; 
  } catch (error) {
    showFailure(`Execution Error: ${error.message}`);
    return { status: "halt" };
  }
}

async function runAutomationOnLoop() {
  let counter = 0;
  currentPass = 1; // Reset to the initial processing pass
  cycleCounterText.textContent = "0";
  
  const browserTabs = await chrome.tabs.query({ active: true });
  const currentMisaTab = browserTabs.find(t => t.url?.includes("misa.vn"));

  if (!currentMisaTab) {
    showFailure("Error: The active tab is not a MISA page.");
    resetButtonState();
    return;
  }

  if (!currentMisaTab.url?.startsWith(TARGET_URL_PREFIX)) {
    showFailure(`Error: Active tab is not on the correct page.\nExpected: ${TARGET_URL_PREFIX}`);
    resetButtonState();
    return;
  }

  targetTabId = currentMisaTab.id;

  try {
    await ensureContentScriptActive(targetTabId);
  } catch (e) {
    showFailure("Initialization error connecting with active MISA tab.");
    resetButtonState();
    return;
  }

  while (isLooping) {
    let minimizedWarningShown = false;
    
    // Check if the MAIN MISA CHROME WINDOW is minimized
    while (await isTargetWindowMinimized(targetTabId)) {
      if (!isLooping) break;
      
      if (!minimizedWarningShown) {
        statusText.classList.remove("error-state", "success-state");
        statusText.classList.add("warning-state");
        statusText.textContent = "⚠️ WARNING: The MISA Chrome window is minimized!\n\nAutomation is paused. Please restore the MISA window to resume.";
        minimizedWarningShown = true;
        
        // --- NEW: Forcibly pull the extension dashboard to the top to alert the user ---
        forceRestoreDashboardWindow(); 
      }
      await delay(1000);
    }
    
    if (minimizedWarningShown) statusText.classList.remove("warning-state");
    if (!isLooping) break;

    counter++;
    setStatus(`--- Pass #${currentPass} | Loop Cycle #${counter} ---`);
    
    // Execute a standard cycle transaction
    const stepResult = await runAutomation();
    
    if (stepResult.status === "halt" || !isLooping) {
      if (!isLooping) setStatus("Automation stopped manually by user.");
      break;
    }

    // Dynamic UI counter update
    cycleCounterText.textContent = counter;

    // HANDLE PASSED THRESHOLD COMPLETIONS
    if (stepResult.status === "pass_complete") {
      if (currentPass === 1) {
        setStatus("🎉 First full pass complete! Hard reloading page back to Page 1 to begin verification pass...");
        
        currentPass = 2; // Elevate to the validation pass
        chrome.tabs.reload(targetTabId);
        
        await delay(5000); // Generous delay to let context dump and refresh run cleanly
        await ensureContentScriptActive(targetTabId);
        await waitForInvoiceListPage(targetTabId);
        continue; // Cycle immediately back to work on the fresh page sequence
      } else {
        // Pass 2 complete! Everything has been explicitly swept and confirmed
        showSuccessSummary(`✅ Double-check verification complete!\n\nAll documents across all pages successfully matched and validated over 2 full engine runs. Total operational steps: ${counter}`);
        break;
      }
    }

    // SYSTEMIC GC REBOOT (Every 50 single modifications, perform structural memory wipe)
    if (counter % 50 === 0) {
      setStatus("Cycle block milestone hit. Hard reloading target tab to wipe systemic application memory leaks...");
      chrome.tabs.reload(targetTabId);
      await delay(4000); 
      await ensureContentScriptActive(targetTabId);
      await waitForInvoiceListPage(targetTabId);
    }

    await delay(500); 
  }

  resetButtonState();
}

function resetButtonState() {
  isLooping = false;
  runButton.textContent = "Start";
  runButton.classList.remove("stop-state");
}

function handleButtonClick() {
  if (isLooping) {
    isLooping = false;
    setStatus("Stop requested. Awaiting current row transaction step down...");
    runButton.textContent = "Stopping...";
  } else {
    isLooping = true;
    runButton.textContent = "Stop";
    runButton.classList.add("stop-state");
    runAutomationOnLoop();
  }
}

runButton.addEventListener("click", handleButtonClick);