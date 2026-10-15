# Website chat button

1. Settings -> Inboxes -> Add inbox -> Website. Enter the site name and domain, pick a color (brand teal `#00969C` suggested), save.
2. The next screen shows the **embed snippet**. Paste it before `</body>` on the client's site (any CMS: WordPress, Wix, plain HTML).
3. In the inbox settings (Configuration tab) set Dutch texts: welcome heading and tagline, business hours (Business hours tab), away message ("Wij zijn nu gesloten, we reageren op de eerstvolgende werkdag"), and the optional pre-chat form (Pre chat form tab: ask name and e-mail).
4. "Powered by" shows the Domli name and links to domli.nl (from `BRAND_NAME` and `WIDGET_BRAND_URL` in `config/installation_config.yml`).

The snippet keeps the identifiers `window.chatwootSDK` and `chatwootSettings`. Those are the widget's public API and are intentionally not renamed.

Test: save a plain HTML file containing the snippet and open it in a browser.
