# Fundament – die digitale Schule

Website, Mitgliederbereich, Abo-Zahlung und Adminbereich in einem System.
Node.js (Express) mit SQLite, serverseitig gerendert, ohne Tracking und ohne externe Skripte.

## Schnellstart (lokal)

```bash
npm install
npm run demo-videos          # optional: kurze Platzhalter-Videos (braucht ffmpeg)
npm run create-admin -- du@example.de Vorname
npm start                    # http://localhost:3000
```

Ohne weitere Einstellungen läuft alles im **Testmodus**: Zahlungen werden simuliert
(„Testzahlung“), Mails (Bestätigungslinks usw.) erscheinen in der Konsole.

Tests: `npm test` (35 Tests: Login, 2FA, CSRF, XSS, Rate-Limits, Reihenfolge der
Seminare, Anti-Vorspulen, Zahlung inkl. Stripe-Webhook, Kündigung, Admin, Uploads).

## Vorschau auf GitHub Pages

GitHub Pages kann keinen Node-Server ausführen. Deshalb gibt es eine statische Vorschau in `docs/` (öffentliche Seiten plus ein Beispiel-Mitgliederbereich mit Demo-Daten). Neu erzeugen mit `npm run build:static`. In den Pages-Einstellungen entweder `main` / `/docs` oder `main` / Root wählen (die `index.html` im Root leitet nach `docs/` weiter). Registrieren und Login führen in der Vorschau direkt in die Demo (Paywall bzw. Mitgliederbereich). Zahlung, Formulare und Videos funktionieren nur auf dem echten Server.

## Was drin ist

**Öffentliche Seiten:** Startseite (alle Abschnitte aus dem Briefing), Fächer und
Fachseiten mit Warteliste (Double-Opt-in), „So läuft’s“ als ausführliche
Erklärseite, Lehrplan, Community, Beiträge, „Verträge hier kündigen“
(ohne Login, § 312k BGB), Impressum/Datenschutz/AGB/Widerruf als Entwürfe.

**Registrierung und Paywall:** Die Registrierung ist kostenlos. Preise stehen nicht auf
den öffentlichen Seiten: Wer ohne Abo einloggt, landet in der Paywall (`/app/freischalten`)
mit allen Lehrgängen, der Mitgliedschaft und dem optionalen Telegram-Kreis.

**Mitgliederbereich:** Übersicht mit „Weitermachen“, Routine-Streak und allen Lehrgängen;
Lehrgänge mit Seminaren in fester Reihenfolge; Seminar-Seite mit Video, Kapitelmarken und Aufgabe;
Zeugnis (Selbsttest Woche 0 und Woche 12, Ziel, Routine, Druckansicht); Community
(Telegram-Kreis als buchbarer Zusatz zum Abo, danach persönliche Einladungen; endet der
Zusatz oder das Abo, entfernt der Bot die Person); Konto & Abo (Kündigen/Fortsetzen, Zahlungsportal,
Passwort, Zwei-Faktor-Anmeldung, Geräte abmelden, Datenexport, Konto löschen).

**Lehrgänge:** Mindset & Persönlichkeit, Fitness & Körper, Geld verdienen, Liebe &
Beziehung und Mentale Stärke sind live, Auftreten & Stil steht auf „bald“ mit Warteliste. Im Admin
unter *Fächer* auf „live“ stellen, sobald Videos hochgeladen und veröffentlicht sind.
Mit der Mitgliedschaft sind alle Fächer freigeschaltet.

**Videos nicht überspringbar:** Der Player hat keine Vorspul-Leiste, sperrt Sprünge
nach vorn und andere Geschwindigkeiten. Entscheidend ist aber der Server: Er rechnet
Fortschritt höchstens in Echtzeit an (Herzschläge alle 5 Sekunden). Wer im Browser
manipuliert, kommt trotzdem nicht schneller voran. Die Aufgabe lässt sich erst nach
dem vollständigen Video abgeben, das nächste Seminar öffnet sich erst nach der Abgabe.
Videos werden nur an berechtigte Mitglieder gestreamt.

**Bewertungstool:** Nach jeder Abgabe Sterne + Kommentar pro Seminar; nach drei
Seminaren eine Bewertung der Schule. Freigabe im Admin, freigegebene Bewertungen
erscheinen auf der Startseite (gekennzeichnet als verifizierte Schüler).

**Adminbereich** (nur mit Zwei-Faktor-Anmeldung): Kennzahlen, Fächer, Seminare mit
Video-Upload, Aufgaben einsehen, Mitglieder (sperren, Freizugang, Rollen), Bewertungen
moderieren, Beiträge schreiben, Warteliste (CSV), Kündigungen, Sicherheitsprotokoll.

## Sicherheit

- Passwörter mit scrypt (gesalzen), Mindestlänge, Sperrliste, Rehash bei neuer Stärke
- Sitzungen: zufälliges Token, nur Hash in der DB, HttpOnly/Secure/SameSite, `__Host-`-Cookies, Ablauf nach 7 Tagen Inaktivität bzw. 30 Tagen
- Zwei-Faktor-Anmeldung (TOTP) mit Schutz gegen Wiederverwendung; Pflicht für Admins
- Sperre nach Fehlversuchen, Rate-Limits auf Login, Registrierung, Reset, Formularen
- Keine Auskunft, ob eine E-Mail existiert (Registrierung, Login, Passwort vergessen)
- CSRF-Token + Origin-Prüfung auf allen Formularen; strikte Content-Security-Policy ohne Inline-Skripte; HSTS, nosniff, frame-ancestors none
- Templates mit Autoescape (XSS), nur parametrisierte SQL-Abfragen, Eingaben begrenzt und geprüft
- Kein Open Redirect, CSV-Export gegen Formel-Injection geschützt
- Uploads: nur Admins, Dateityp per Signatur geprüft, zufällige Dateinamen, außerhalb des Web-Ordners
- Stripe-Webhooks mit Signaturprüfung und Idempotenz; Telegram-Webhook mit Geheimnis
- Produktion startet nicht mit unsicherer Konfiguration (fehlendes Secret, kein HTTPS, Testzahlung)

## Live gehen

1. Server mit Node 22.13+ (oder Docker: `docker build -t schule . && docker run -p 3000:3000 -v schule-data:/data --env-file .env schule`)
2. `.env` nach Vorlage `.env.example` ausfüllen, HTTPS über Reverse-Proxy (z. B. Caddy)
3. Stripe: Produkt mit monatlichem Preis anlegen, Webhook auf `https://deine-domain.de/webhooks/stripe` mit den Ereignissen `checkout.session.completed`, `customer.subscription.created/updated/deleted`; Kundenportal aktivieren
4. Telegram-Kreis (optional): im Stripe-Produkt einen zweiten Monatspreis anlegen (`STRIPE_TELEGRAM_PRICE_ID`), Bot anlegen, als Admin in Gruppe und Kanal, Webhook auf `/webhooks/telegram` mit `secret_token` und `allowed_updates: ["chat_member"]`
5. `npm run create-admin -- deine@mail.de Name`, einloggen, 2FA einrichten, Videos hochladen, Seminare veröffentlichen
6. Backups: den Ordner `DATA_DIR` (Datenbank + Videos) regelmäßig sichern

**Vor dem Start offen** (aus dem Briefing): Schulname, Logo, Domain, endgültige Preise (Platzhalter 39 € und 9 €), Lehrerprofile,
Rechtsform/Impressum. Die Rechtstexte sind Entwürfe und müssen geprüft werden.

## Hausschrift „Fundament Display“

Eigene Display-Schrift für Überschriften (101 Zeichen inkl. Umlaute, ß, €, Satzzeichen,
Kerning). Quadratisch gerundete Bögen und ein schräger Anschnitt oben links an jedem
Hauptstamm, der sich als Markenmotiv durch die ganze Seite zieht (Karten, Buttons, Logo).
Quelle: `tools/font/build_font.py` → `public/fonts/fundament-display.woff2` (+ `.otf` für
Grafikprogramme). Neu bauen: `pip install fonttools skia-pathops brotli && npm run build:font`.
Fließtext: Manrope (SIL Open Font License), lokal ausgeliefert.

## Farben

| Name | Wert | Einsatz |
|---|---|---|
| Kohle | `#16130F` | Hintergrund |
| Knochen | `#F3EDE1` | Text, helle Abschnitte |
| Signal | `#E8642C` | Akzent, Buttons |
| Moos | `#93A061` | Erledigt, Erfolg |
| Messing | `#C9A45C` | Sterne |
