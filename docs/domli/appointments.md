# Appointments (OnlineAfspraken.nl)

## Status
- **Working now: booking link.** When a customer asks about an appointment, the bot replies with the client's booking page. No API needed, works for any booking system.
- **API mode: prepared, not verified.** `domli-bot/src/appointments/onlineafspraken.js` implements the documented request signing (verified against https://onlineafspraken.nl/en/how-does-api-work, covered by a unit test) and falls back to the booking link on any error. The **method names and parameters** (`getBookableTimes`, `appointmentTypeId`, response field names) are assumptions: the public documentation pages do not list them. Open the API reference in the client's OnlineAfspraken backend (Settings -> Additional functionality -> API data) or ask support (info@onlineafspraken.nl) and adjust `METHODS` and the response parsing before enabling.
- **Creating appointments through the API is not built.** Needs the verified method list (the docs show `SetCustomer` exists, so a set-appointment method likely exists too).

## Enable API mode for a client (after verification)
In `domli-bot/data/accounts.json`:
```json
"appointments": {
  "provider": "onlineafspraken",
  "bookingUrl": "https://client.onlineafspraken.nl",
  "apiKey": "...", "apiSecret": "...", "appointmentTypeId": 123
}
```
Keys give full access to the client's agenda data: store the file only on the server, treat as a secret, list OnlineAfspraken in the DPA as the client's own processor.

## Adding another booking system
Create `domli-bot/src/appointments/<name>.js` exporting a factory that returns `{ name, reply() }` and register it in `appointments/index.js`.
