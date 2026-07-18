(async () => {
  const launchParameters = new URLSearchParams(window.location.search);
  const helperPort = launchParameters.get("helperPort");
  const helperToken = launchParameters.get("helperToken");
  const windowMarker = launchParameters.get("windowMarker");
  const currentTab = await chrome.tabs.getCurrent();

  if (helperPort && helperToken && windowMarker) {
    document.title = windowMarker;
    if (currentTab?.id) {
      await chrome.tabs.update(currentTab.id, { active: true });
    }
    const registerUrl = new URL(`http://127.0.0.1:${helperPort}/register`);
    registerUrl.searchParams.set("token", helperToken);
    registerUrl.searchParams.set("title", windowMarker);

    let registered = false;
    for (let attempt = 0; attempt < 40 && !registered; attempt++) {
      try {
        const response = await fetch(registerUrl);
        const result = await response.json();
        registered = response.ok && result.success;
      } catch (error) {
        console.debug("Waiting for native window helper registration...", error);
      }
      if (!registered) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    if (!registered) {
      throw new Error("Could not register the launched Chrome window with the native helper.");
    }
  }

  const targetTabs = currentTab?.windowId
    ? await chrome.tabs.query({ windowId: currentTab.windowId })
    : [];
  const targetTab = targetTabs.find((tab) =>
    tab.url?.startsWith("https://actasp.misa.vn/app/IP/IPOutputInvoice/IPOutputInvoiceAutomaticList")
  );
  const dashboardUrl = new URL(chrome.runtime.getURL("dashboard.html"));

  if (targetTab?.id && targetTab.windowId) {
    dashboardUrl.searchParams.set("targetTabId", targetTab.id);
    dashboardUrl.searchParams.set("targetWindowId", targetTab.windowId);
  }
  if (helperPort && helperToken) {
    dashboardUrl.searchParams.set("helperPort", helperPort);
    dashboardUrl.searchParams.set("helperToken", helperToken);
  }

  const windows = await chrome.windows.getAll({ populate: true });
  const existingDashboard = windows.find((window) =>
    window.tabs?.some((tab) => tab.url?.startsWith(chrome.runtime.getURL("dashboard.html")))
  );

  if (existingDashboard) {
    const dashboardTab = existingDashboard.tabs.find((tab) =>
      tab.url?.startsWith(chrome.runtime.getURL("dashboard.html"))
    );
    if (dashboardTab?.id) {
      await chrome.tabs.update(dashboardTab.id, { url: dashboardUrl.href });
    }
    await chrome.windows.update(existingDashboard.id, {
      state: "normal",
      focused: true
    });
  } else {
    const dashboardWindow = await chrome.windows.create({
      url: dashboardUrl.href,
      type: "popup",
      width: 380,
      height: 450,
      focused: true
    });
    if (dashboardWindow?.id) {
      await chrome.windows.update(dashboardWindow.id, {
        state: "normal",
        width: 380,
        height: 450,
        focused: true
      });
    }
  }

  if (currentTab?.id) {
    await chrome.tabs.remove(currentTab.id);
  }
})();