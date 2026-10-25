# IONOS-Mail-Konnektor für Claude (nur Lesen)

Ein kleiner Server, der deine IONOS-Postfächer per IMAP liest und sie Claude als
eigenen Konnektor zur Verfügung stellt.

- **Nur Lesen:** Ordner werden schreibgeschützt geöffnet (IMAP `EXAMINE`). Nichts wird
  gelöscht, verschoben, gesendet oder als gelesen markiert.
- **Zugangsdaten bleiben beim Hoster:** Du trägst Mailadresse und Passwort nur in
  die Umgebungsvariablen deines Servers ein, nie in einen Chat.
- **Geschützt durch einen geheimen Link:** Der Server antwortet nur unter
  `/mcp/<ACCESS_TOKEN>`. Wer den Link kennt, kann deine Mails lesen, also behandle
  ihn wie ein Passwort.

Werkzeuge, die Claude bekommt: `list_accounts`, `list_folders`, `list_messages`,
`search_messages`, `read_message`.

## Einrichtung mit Render (kostenlos, Server in Frankfurt)

1. **Code auf GitHub legen.** Ein öffentliches Repository reicht, im Code stehen
   keine Zugangsdaten.
2. **Bei Render anmelden:** <https://render.com>, am einfachsten mit „Sign in with GitHub“.
3. **Blueprint anlegen:** Im Render-Dashboard *New → Blueprint*, das Repository
   auswählen. Render liest `render.yaml` und legt den Dienst an.
4. **Zugangsdaten eintragen:** Render fragt nach genau zwei Werten:
   - `IMAP_USER`: deine volle IONOS-Mailadresse
   - `IMAP_PASSWORD`: das Passwort dieses Postfachs
   
   Dann *Apply*. Nach 1–2 Minuten läuft der Dienst.
5. **Link zusammensetzen:** Im Dienst unter *Environment* den Wert von
   `ACCESS_TOKEN` kopieren (Render hat ihn zufällig erzeugt). Oben auf der Seite
   steht die Adresse, z. B. `https://ionos-imap-mcp-xxxx.onrender.com`. Dein
   Konnektor-Link ist dann:

   `https://ionos-imap-mcp-xxxx.onrender.com/mcp/<ACCESS_TOKEN>`
6. **In Claude hinzufügen:** claude.ai → *Einstellungen → Konnektoren → Eigenen
   Konnektor hinzufügen*. Name z. B. „IONOS Mail“, als URL den Link aus Schritt 5.
   Keine OAuth-Felder ausfüllen. (In einem Team- oder Enterprise-Konto muss das
   ggf. ein Owner unter *Organisationseinstellungen → Konnektoren* tun.)

Fertig. Du kannst Claude jetzt z. B. fragen: „Was gibt es Neues in meinem Posteingang?“

### Weitere Postfächer

Im Render-Dienst unter *Environment* einfach `IMAP_USER_2` / `IMAP_PASSWORD_2`,
`IMAP_USER_3` / `IMAP_PASSWORD_3` usw. (bis 10) hinzufügen und speichern. Claude
sieht dann alle Konten über `list_accounts`.

### Gut zu wissen

- **Kostenloser Tarif schläft ein:** Nach 15 Minuten ohne Nutzung fährt Render den
  Dienst herunter, der erste Aufruf danach dauert etwa eine Minute. Schlägt der erste
  Versuch fehl, einfach noch einmal fragen. Der Tarif *Starter* (ca. 7 $/Monat)
  hält ihn wach.
- **Link geleakt?** In Render `ACCESS_TOKEN` durch einen neuen langen Zufallswert
  ersetzen und den Konnektor in Claude mit dem neuen Link neu anlegen.
- **Passwort geändert?** `IMAP_PASSWORD` in Render aktualisieren.
- **Anderer Anbieter als IONOS:** `IMAP_HOST` / `IMAP_PORT` anpassen
  (pro Konto auch `IMAP_HOST_2` usw.).

## Alternativ: eigener Server mit Docker

```sh
docker build -t ionos-imap-mcp .
docker run -d -p 3000:3000 \
  -e ACCESS_TOKEN="$(openssl rand -hex 24)" \
  -e IMAP_USER="name@deinedomain.de" \
  -e IMAP_PASSWORD="..." \
  ionos-imap-mcp
```

Der Server muss per HTTPS aus dem Internet erreichbar sein (z. B. hinter Caddy,
nginx oder einem Cloudflare Tunnel), damit claude.ai ihn ansprechen kann.

## Testen

`node tools/test-client.mjs https://…/mcp/<ACCESS_TOKEN>` ruft alle Werkzeuge einmal auf.
