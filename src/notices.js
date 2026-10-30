'use strict';

// Feste Hinweistexte, die per ?hinweis=… angezeigt werden. Es wird nie
// Nutzereingabe zurückgespiegelt, nur ein Schlüssel aus dieser Liste.
const NOTICES = {
  'abgemeldet': ['ok', 'Du bist abgemeldet. Bis bald.'],
  'email-bestaetigt': ['ok', 'Deine E-Mail ist bestätigt. Du kannst dich jetzt anmelden.'],
  'link-ungueltig': ['warn', 'Dieser Link ist ungültig oder abgelaufen. Fordere bei Bedarf einen neuen an.'],
  'passwort-neu': ['ok', 'Dein Passwort ist geändert. Melde dich mit dem neuen Passwort an.'],
  'passwort-geaendert': ['ok', 'Dein Passwort ist geändert. Andere Geräte wurden abgemeldet.'],
  'name-gespeichert': ['ok', 'Gespeichert.'],
  '2fa-an': ['ok', 'Zwei-Faktor-Anmeldung ist aktiv. Dein Konto ist jetzt deutlich besser geschützt.'],
  '2fa-aus': ['ok', 'Zwei-Faktor-Anmeldung ist ausgeschaltet.'],
  '2fa-admin': ['warn', 'Für den Adminbereich musst du zuerst die Zwei-Faktor-Anmeldung einschalten.'],
  'abo-gekuendigt': ['ok', 'Dein Abo ist gekündigt. Du behältst den Zugang bis zum Ende des bezahlten Zeitraums.'],
  'abo-fortgesetzt': ['ok', 'Schön, dass du bleibst. Dein Abo läuft weiter.'],
  'abo-fehler': ['warn', 'Das hat nicht geklappt. Bitte versuche es später erneut oder schreib uns.'],
  'kein-zugang': ['warn', 'Für diesen Bereich brauchst du eine aktive Mitgliedschaft.'],
  'gesperrt': ['warn', 'Dieses Seminar öffnet sich erst, wenn du die Aufgabe des vorherigen abgegeben hast.'],
  'video-zuerst': ['warn', 'Schau dir zuerst das ganze Seminar an. Danach kannst du die Aufgabe abgeben.'],
  'aufgabe-leer': ['warn', 'Deine Antwort ist noch zu kurz. Nimm dir einen Moment und schreib ein paar ehrliche Sätze.'],
  'bewertet': ['ok', 'Danke für deine Bewertung. Sie hilft uns, besser zu werden.'],
  'selbsttest': ['ok', 'Selbsttest gespeichert. Das ist dein Ausgangspunkt.'],
  'ziel': ['ok', 'Dein Ziel ist gespeichert. Schreib es dir zusätzlich irgendwo hin, wo du es täglich siehst.'],
  'routine': ['ok', 'Abgehakt. Jeder Tag zählt.'],
  'bestaetigen-erst': ['warn', 'Bitte bestätige zuerst deine E-Mail-Adresse. Den Link findest du in deinem Postfach.'],
  'gespeichert': ['ok', 'Gespeichert.'],
  'geloescht': ['ok', 'Gelöscht.'],
  'konto-geloescht': ['ok', 'Dein Konto und deine Daten sind gelöscht. Alles Gute für deinen Weg.'],
  'zahlung-abgebrochen': ['warn', 'Die Zahlung wurde abgebrochen. Es wurde nichts berechnet.'],
  'video-hochgeladen': ['ok', 'Video hochgeladen.'],
  'video-fehler': ['warn', 'Das Video konnte nicht verarbeitet werden. Erlaubt sind MP4 und WebM.'],
  'veroeffentlichen-video': ['warn', 'Ein Seminar kann erst veröffentlicht werden, wenn ein Video mit Länge hinterlegt ist.'],
};

function lookup(key) {
  if (typeof key !== 'string' || !Object.hasOwn(NOTICES, key)) return null;
  const [kind, text] = NOTICES[key];
  return { kind, text };
}

module.exports = { lookup, NOTICES };
