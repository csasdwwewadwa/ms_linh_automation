# MISA Output Invoice Action Highlighter

Chrome extension that runs only on:

```text
https://actasp.misa.vn/app/IP/IPOutputInvoice/IPOutputInvoiceAutomaticList
```

When the popup button is clicked, it finds the first `table.ms-table-viewer`, scans `tbody > tr.ms-tr-viewer`, checks the second direct `td` for `Chưa hạch toán`, then clicks the first action button in the last direct `td`.

After the browser reaches `https://actasp.misa.vn/app/popup/SAVoucherDetail`, it waits for the page load to complete, checks the first `input` inside `div.customer-info`, and if that input has `title="BL"`, clicks the `Thu tiền ngay` radio label.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.
5. Open the target MISA page and click the extension button.

## Launch with PowerShell

After the extension has been loaded in the selected Chrome profile, double-click `launch-misa.cmd` or run:

```bat
.\launch-misa.cmd
```

The launcher selects Chrome's recently used profile, restores minimized Chrome windows, opens the MISA list and extension dashboard, applies browser background-throttling and native-occlusion mitigations, and marks the dashboard window as Windows-level always-on-top.

The controller binds to the exact MISA tab and Chrome window created by the launcher. It will not switch to another open MISA window. The dashboard can stay on top while the bound MISA window is behind other applications.

Use **Ẩn cửa sổ MISA** to move the bound MISA window off-screen without minimizing it. `launch-misa.cmd` starts an authenticated loopback Win32 helper that owns only the Chrome window created by that launch. Chrome is launched with native occlusion calculation disabled, which can keep a covered window active without requiring a virtual monitor. This is still subject to Chrome and Windows version behavior; a window outside every display may not be painted reliably. Use **Hiện cửa sổ MISA** to restore its original position and size.

The native hide/show button is available only when the controller is opened through `launch-misa.cmd`. The helper listens only on `127.0.0.1`, requires a random per-launch token, and exits when its PowerShell process is closed or Windows ends the session.

## Vietnamese localization

The dashboard loads its Vietnamese interface text from `locales/vi.json`. Edit the values in that file to adjust labels or status messages. Keys are referenced by `dashboard.js` and placeholders such as `{pass}`, `{counter}`, `{message}`, and `{url}` are filled at runtime.

The native window title remains `MISA Auto Controller` because `launch-misa.ps1` uses it to find the dashboard and apply Windows-level always-on-top behavior.
