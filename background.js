chrome.action.onClicked.addListener(async () => {
  const targetUrl = chrome.runtime.getURL("dashboard.html");
  const allWindows = await chrome.windows.getAll({ populate: true });
  
  const existingDashboardWindow = allWindows.find(win => 
    win.tabs && win.tabs.some(tab => tab.url === targetUrl)
  );

  if (existingDashboardWindow) {
    // Bring to front, un-minimize, and reinforce PIN on top
    await chrome.windows.update(existingDashboardWindow.id, { 
      state: "normal", 
      focused: true,
      alwaysOnTop: true 
    });
    return;
  }

  // 1. Create the base standalone window structure
  const newWindow = await chrome.windows.create({
    url: "dashboard.html",
    type: "popup",
    width: 380,
    height: 450,
    focused: true
  });

  // 2. Explicitly bind the alwaysOnTop property to the active runtime ID
  if (newWindow && newWindow.id) {
    await chrome.windows.update(newWindow.id, { alwaysOnTop: true });
  }
});