# WhatsApp koppelen aan Domli (Cloud API)

Berichtkosten betaalt u rechtstreeks aan Meta, via uw eigen Meta-factuuraccount. Domli rekent hier niets bovenop.

## Wat u nodig hebt
- Een Meta Business-account (business.facebook.com), geverifieerd op uw bedrijfsnaam
- Een telefoonnummer dat **niet** al in de gewone WhatsApp- of WhatsApp Business-app wordt gebruikt (of verwijder het daar eerst)
- Een betaalmethode in Meta Business (voor berichtkosten)

## Stappen bij Meta
1. Ga naar developers.facebook.com -> Mijn apps -> App maken -> type **Bedrijf** -> voeg het product **WhatsApp** toe.
2. Onder WhatsApp -> API-instellingen: voeg uw telefoonnummer toe en verifieer het. Noteer het **Telefoonnummer-ID** en de **WhatsApp Business-account-ID**.
3. Maak een permanente toegangstoken: Business-instellingen -> Gebruikers -> Systeemgebruikers -> toevoegen (rol Admin) -> app toewijzen -> token genereren met de rechten `whatsapp_business_messaging` en `whatsapp_business_management`. Bewaar de token veilig.

## Stappen in Domli
1. Instellingen -> Inboxen -> Inbox toevoegen -> **WhatsApp** -> provider **WhatsApp Cloud**.
2. Vul in: naam van de inbox, telefoonnummer (met landcode, bijv. +31612345678), Telefoonnummer-ID, Business-account-ID en de token. Opslaan.
3. Domli toont een **Callback-URL** en een **Verify token**. Ga terug naar Meta -> WhatsApp -> Configuratie -> Webhook -> Bewerken: plak beide, klik Verifiëren en opslaan, en abonneer op het veld **messages**.
4. Stuur een testbericht naar uw nummer. Het verschijnt in Domli; antwoorden vanuit Domli komen bij de klant aan.

## Goed om te weten
- U kunt klanten vrij antwoorden binnen 24 uur nadat zij u een bericht stuurden. Daarbuiten kan alleen met een door Meta goedgekeurd **sjabloonbericht** (aan te maken in Meta Business Manager).
- Testen kan eerst met het gratis testnummer van Meta (alleen naar nummers die u in Meta hebt toegevoegd).
- Gezondheidsgegevens: de AI-assistent beantwoordt geen medische vragen en draagt die altijd over aan een medewerker.
