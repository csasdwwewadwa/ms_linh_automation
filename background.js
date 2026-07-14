chrome.action.onClicked.addListener(async () => {
  const targetUrl = chrome.runtime.getURL("dashboard.html");
  const allWindows = await chrome.windows.getAll({ populate: true });
  
  const existingDashboardWindow = allWindows.find(win => 
    win.tabs && win.tabs.some(tab => tab.url === targetUrl)
  );

  if (existingDashboardWindow) {
    // Force it un-minimized if it was hidden, and bring it to front
    chrome.windows.update(existingDashboardWindow.id, { 
      state: "normal", 
      focused: true 
    });
    return;
  }

  // Create a clean standalone dashboard panel that stays pinned on top
  chrome.windows.create({
    url: "dashboard.html",
    type: "popup",
    width: 380,
    height: 450,
    focused: true,
    alwaysOnTop: true // <-- Keeps panel pinned on top of desktop apps
  });
});