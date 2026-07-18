chrome.action.onClicked.addListener(async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const targetUrl = new URL(chrome.runtime.getURL("dashboard.html"));
  if (activeTab?.url?.includes("misa.vn") && activeTab.id && activeTab.windowId) {
    targetUrl.searchParams.set("targetTabId", activeTab.id);
    targetUrl.searchParams.set("targetWindowId", activeTab.windowId);
  }
  const allWindows = await chrome.windows.getAll({ populate: true });
  
  const existingDashboardWindow = allWindows.find(win => 
    win.tabs && win.tabs.some(tab => tab.url?.startsWith(chrome.runtime.getURL("dashboard.html")))
  );

  if (existingDashboardWindow) {
    const dashboardTab = existingDashboardWindow.tabs.find((tab) =>
      tab.url?.startsWith(chrome.runtime.getURL("dashboard.html"))
    );
    if (dashboardTab?.id) {
      await chrome.tabs.update(dashboardTab.id, { url: targetUrl.href });
    }
    await chrome.windows.update(existingDashboardWindow.id, {
      state: "normal",
      focused: true
    });
    return;
  }

  // 1. Create the base standalone window structure
  const newWindow = await chrome.windows.create({
    url: targetUrl.href,
    type: "popup",
    width: 380,
    height: 450,
    focused: true
  });
});