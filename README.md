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
