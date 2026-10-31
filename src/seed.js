'use strict';

const { nowIso } = require('./db');

// Startinhalte. Alles hier ist Entwurf und kann im Adminbereich angepasst werden.

const SUBJECTS = [
  {
    slug: 'persoenlichkeit',
    title: 'Mindset & Persönlichkeit',
    tagline: 'Wer du im Kopf bist, wirst du im Leben.',
    description: 'Hier fängt alles an. Du lernst nach Napoleon Hill, Bob Proctor und Vadim Zeland, wie Gedanken, Selbstbild und tägliche Entscheidungen dein Leben steuern, und du drehst an genau diesen Stellschrauben. Zwölf Seminare, jedes mit einer Aufgabe, die du sofort umsetzt.',
    level_title: 'Grundstufe „Fundament“',
    status: 'live',
    teacher_name: '[Name des Lehrers]',
    teacher_bio: 'Kurzer Werdegang in zwei, drei Sätzen: wer er ist, was ihn qualifiziert und warum er unterrichtet. Dieser Text folgt, sobald das Lehrerprofil steht.',
    seminars: [
      ['Klarheit', 'Der Ausgangspunkt', 'Wo stehst du gerade wirklich? Ehrlich hinschauen ist der erste starke Schritt.', 'text', 'Beschreibe in drei bis fünf Sätzen ehrlich, wo du heute stehst: Körper, Geld, Beziehungen, Kopf.'],
      ['Klarheit', 'Der brennende Wunsch', 'Ein Ziel, das dich morgens aus dem Bett zieht.', 'text', 'Schreibe dein Ziel für die nächsten zwölf Monate auf. Konkret, mit Datum und dem Grund, warum es dir wichtig ist.'],
      ['Klarheit', 'Glaube und Autosuggestion', 'Wie Sätze, die du dir jeden Tag sagst, deine Haltung formen.', 'check', 'Formuliere einen Satz zu deinem Ziel und lies ihn sieben Tage lang morgens und abends laut. Hake ab, wenn du begonnen hast.'],
      ['Paradigmen', 'Was dich wirklich steuert', 'Denkgewohnheiten, die du nie bewusst gewählt hast.', 'text', 'Schreibe drei Überzeugungen auf, die dich heute bremsen.'],
      ['Paradigmen', 'Das Selbstbild', 'Du handelst immer so, wie du dich selbst siehst.', 'text', 'Beschreibe den Mann, der du in einem Jahr sein willst: Wie startet er seinen Tag? Wie spricht er? Was lässt er weg?'],
      ['Paradigmen', 'Das Gesetz der Schwingung', 'Eine Lehre über Stimmung und Wirkung, als Werkzeug für deinen Alltag.', 'text', 'Beobachte drei Tage lang, in welcher Stimmung du wichtige Entscheidungen triffst. Notiere, was dir auffällt.'],
      ['Gleiten', 'Wichtigkeit reduzieren', 'Warum zu viel Druck dich lähmt und wie du locker bleibst.', 'text', 'Nenne eine Sache, die du gerade zu wichtig nimmst, und einen Schritt, mit dem du sie entspannter angehst.'],
      ['Gleiten', 'Pendel erkennen', 'Welche Gruppen und Debatten deine Energie fressen.', 'text', 'Schreibe zwei „Pendel“ auf, die dich Zeit und Kraft kosten, und wie du dich davon löst.'],
      ['Gleiten', 'Spiegel der Welt', 'Was du ausstrahlst, kommt zu dir zurück. Ein Denkmodell mit Wirkung.', 'check', 'Lebe einen Tag bewusst so, als wärst du schon der Mann aus Seminar 5. Hake ab, wenn du es getan hast.'],
      ['Umsetzung', 'Die tägliche Routine', 'Kleine Handlungen, jeden Tag. Genau so entstehen große Veränderungen.', 'text', 'Lege deine Morgenroutine fest: höchstens fünf Punkte, höchstens 30 Minuten. Starte ab morgen den Streak im Zeugnis.'],
      ['Umsetzung', 'Die Mastermind', 'Warum du Männer um dich brauchst, die dich fordern.', 'text', 'Nenne zwei Menschen, mit denen du regelmäßig über deine Ziele sprechen willst, und poste dein Wochenziel in der Community.'],
      ['Umsetzung', 'Die Abschlussprüfung', 'Rückblick, Bilanz und dein nächster großer Schritt.', 'text', 'Vergleiche dich mit Seminar 1: Was hat sich verändert? Was ist dein nächstes Ziel?'],
    ],
  },
  {
    slug: 'fitness',
    title: 'Fitness & Körper',
    tagline: 'Ein Körper, auf den du stolz bist.',
    description: 'Kraft, Ausdauer und ein Körper, der dir Selbstvertrauen gibt. Du bekommst einen Plan, der auch in vollen Wochen funktioniert, und lernst, wie Training, Essen und Schlaf zusammenspielen. Für Anfänger genauso wie für Männer, die wieder einsteigen.',
    level_title: 'Grundstufe „Belastbar“',
    status: 'live',
    teacher_name: '[Trainer folgt]',
    teacher_bio: 'Das Trainerprofil folgt, sobald es feststeht.',
    seminars: [
      ['Start', 'Dein Startpunkt', 'Ein ehrlicher Test von Kraft, Ausdauer und Beweglichkeit.', 'text', 'Mach den Starttest und notiere deine Werte: Liegestütze, Kniebeugen, Plank in Sekunden.'],
      ['Start', 'Der Plan, der hält', 'Drei Einheiten pro Woche, die in dein echtes Leben passen.', 'check', 'Trage deine drei Trainingstermine für die nächste Woche fest in deinen Kalender ein.'],
      ['Start', 'Technik vor Gewicht', 'Die fünf Grundübungen sauber ausführen und Verletzungen vermeiden.', 'check', 'Filme dich bei einer Grundübung und vergleiche deine Technik mit dem Seminar.'],
      ['Aufbau', 'Essen ohne Dogma', 'Eiweiß, Kalorien und Mahlzeiten, die du wirklich durchhältst.', 'text', 'Schreibe auf, was du diese Woche an deiner Ernährung änderst. Eine Sache reicht.'],
      ['Aufbau', 'Schlaf ist Training', 'Warum Regeneration über deinen Fortschritt entscheidet.', 'text', 'Notiere sieben Tage lang, wann du schlafen gehst und aufstehst. Was fällt dir auf?'],
      ['Aufbau', 'Progressive Steigerung', 'Wie du Woche für Woche stärker wirst, ohne auszubrennen.', 'text', 'Lege für deine drei Hauptübungen fest, wie du sie in den nächsten vier Wochen steigerst.'],
      ['Durchziehen', 'Wenn die Motivation weg ist', 'Training an Tagen, an denen du keine Lust hast.', 'text', 'Schreibe deinen Notfallplan für schlechte Tage: die Mindest-Einheit, die du immer schaffst.'],
      ['Durchziehen', 'Der Re-Test', 'Zeit für deinen Vergleich mit Woche eins.', 'text', 'Mach den Starttest erneut und vergleiche die Werte. Was ist besser geworden?'],
    ],
  },
  {
    slug: 'geld-verdienen',
    title: 'Geld verdienen',
    tagline: 'Bau dir etwas Eigenes auf.',
    description: 'Lerne, aus deinen Fähigkeiten ein Angebot zu machen, erste Kunden zu gewinnen und mit Geld klug umzugehen. Mit echtem Handwerk: Angebot, Verkauf, Kalkulation, Rücklagen. Wir versprechen dir kein Einkommen, wir bringen dir bei, wie es entsteht.',
    level_title: 'Grundstufe „Eigenes“',
    status: 'live',
    teacher_name: '[Lehrer folgt]',
    teacher_bio: 'Das Lehrerprofil folgt, sobald es feststeht.',
    seminars: [
      ['Grundlagen', 'Was du wirklich kannst', 'Deine Fähigkeiten sind mehr wert, als du denkst.', 'text', 'Liste zehn Dinge, bei denen andere dich um Rat oder Hilfe fragen.'],
      ['Grundlagen', 'Geld im Griff', 'Einnahmen, Ausgaben und dein erster Puffer.', 'text', 'Schreibe deine festen monatlichen Ausgaben auf und lege einen Betrag fest, den du ab jetzt monatlich zurücklegst.'],
      ['Grundlagen', 'Ein Angebot, das Sinn ergibt', 'Vom Können zu etwas, wofür Menschen gern bezahlen.', 'text', 'Formuliere dein erstes Angebot in einem Satz: für wen, welches Problem, welches Ergebnis.'],
      ['Verkaufen', 'Rechnen statt hoffen', 'Preise, Kosten und Zeit realistisch kalkulieren.', 'text', 'Rechne aus, was eine Stunde deiner Arbeit mindestens kosten muss.'],
      ['Verkaufen', 'Die ersten drei Kunden', 'Wie du ohne Werbebudget an Aufträge kommst.', 'check', 'Sprich drei Menschen aus deinem Umfeld auf dein Angebot an. Hake ab, wenn du es getan hast.'],
      ['Verkaufen', 'Nein hören und weitermachen', 'Absagen gehören dazu. So wirst du dadurch besser.', 'text', 'Schreibe auf, was du aus der letzten Absage gelernt hast.'],
      ['Wachsen', 'Sauber und legal', 'Gewerbe, Steuern und Versicherungen im Überblick.', 'check', 'Kläre, welche Anmeldung du für dein Angebot brauchst, und notiere den nächsten Schritt.'],
      ['Wachsen', 'Dein 90-Tage-Plan', 'Ziele, Zahlen und Wochen-Aufgaben für die nächsten drei Monate.', 'text', 'Schreibe deinen 90-Tage-Plan mit einem Umsatzziel und drei Wochen-Gewohnheiten.'],
    ],
  },
  {
    slug: 'liebe',
    title: 'Liebe & Beziehung',
    tagline: 'Finde eine Frau, die zu dir passt, und halte sie.',
    description: 'Dating ohne Spielchen. Du lernst, mit Selbstwert und Ehrlichkeit auf Frauen zuzugehen, gute Gespräche zu führen, Grenzen zu setzen und zu respektieren und eine Beziehung zu führen, die beide stärker macht.',
    level_title: 'Grundstufe „Echt“',
    status: 'live',
    teacher_name: '[Lehrer folgt]',
    teacher_bio: 'Das Lehrerprofil folgt, sobald es feststeht.',
    seminars: [
      ['Selbstwert', 'Erst du, dann ihr', 'Warum eine gute Beziehung bei deinem Selbstwert anfängt.', 'text', 'Schreibe fünf Dinge auf, die dich als Partner wertvoll machen, und eine Sache, an der du arbeiten willst.'],
      ['Selbstwert', 'Was du wirklich suchst', 'Werte, Wünsche und No-Gos klar kennen.', 'text', 'Beschreibe die Partnerin, die zu deinem Leben passt: drei Werte, die ihr teilen solltet, und zwei No-Gos.'],
      ['Kennenlernen', 'Ansprechen ohne Masche', 'Ehrlich, respektvoll und mit Humor ins Gespräch kommen.', 'check', 'Führe diese Woche drei Gespräche mit fremden Menschen, egal ob Mann oder Frau. Hake ab, wenn du es getan hast.'],
      ['Kennenlernen', 'Das erste Date', 'Planen, führen und echtes Interesse zeigen.', 'text', 'Plane ein Date, das zu dir passt: Ort, Ablauf und drei Fragen, die dich wirklich interessieren.'],
      ['Beziehung', 'Streiten, ohne zu verletzen', 'Konflikte lösen, ohne die Verbindung zu verlieren.', 'text', 'Denke an deinen letzten Streit. Was hättest du anders sagen können?'],
      ['Beziehung', 'Ein Mann, auf den man bauen kann', 'Verlässlichkeit, Führung und Respekt im Alltag.', 'text', 'Nenne drei Dinge, die du ab dieser Woche in deiner Beziehung oder Freundschaft verlässlich tust.'],
    ],
  },
  {
    slug: 'mentale-staerke',
    title: 'Mentale Stärke',
    tagline: 'Ruhig bleiben, wenn es stürmt.',
    description: 'Stress, Druck, Rückschläge und Tage, an denen alles zu viel ist. Du lernst Werkzeuge, mit denen du klar bleibst, wieder aufstehst und auch mal Hilfe annimmst. Dieses Fach ersetzt keine Therapie. Wenn es dir richtig schlecht geht, findest du im Seminar Anlaufstellen, die sofort helfen.',
    level_title: 'Grundstufe „Standfest“',
    status: 'live',
    teacher_name: '[Lehrer folgt]',
    teacher_bio: 'Das Lehrerprofil folgt, sobald es feststeht.',
    seminars: [
      ['Verstehen', 'Was Stress mit dir macht', 'Körper, Kopf und Verhalten unter Druck.', 'text', 'Schreibe auf, woran du merkst, dass du gestresst bist: im Körper, in Gedanken, im Verhalten.'],
      ['Verstehen', 'Gedanken sind keine Fakten', 'Wie du Grübelschleifen erkennst und unterbrichst.', 'text', 'Notiere einen Gedanken, der dich oft runterzieht, und schreibe eine ehrlichere Version daneben.'],
      ['Werkzeuge', 'Atmen, bewegen, runterfahren', 'Drei Techniken, die in zwei Minuten wirken.', 'check', 'Probiere jede der drei Techniken einmal aus. Hake ab, wenn du es getan hast.'],
      ['Werkzeuge', 'Rückschläge verarbeiten', 'Hinfallen gehört dazu. Wie du schneller wieder aufstehst.', 'text', 'Beschreibe einen Rückschlag und was er dir beigebracht hat.'],
      ['Stärke', 'Allein ist schwer', 'Warum starke Männer reden und wie du damit anfängst.', 'text', 'Nenne einen Menschen, dem du diese Woche erzählst, wie es dir wirklich geht.'],
      ['Stärke', 'Dein Notfallplan', 'Was du tust, wenn es richtig dunkel wird.', 'text', 'Schreibe deinen persönlichen Notfallplan: drei Dinge, die dir helfen, und zwei Menschen oder Stellen, die du anrufen kannst.'],
    ],
  },
  {
    slug: 'auftreten',
    title: 'Auftreten & Stil',
    tagline: 'Betritt jeden Raum mit Präsenz.',
    description: 'Körpersprache, Kleidung, Pflege und Stimme. Wie du so auftrittst, dass man dir zuhört und dich ernst nimmt, ohne dich zu verstellen.',
    level_title: 'Grundstufe „Präsenz“',
    status: 'soon',
    teacher_name: '[Lehrer folgt]',
    teacher_bio: 'Das Lehrerprofil folgt zum Start des Fachs.',
    seminars: [
      ['Grundlagen', 'Der erste Eindruck', 'Was andere in den ersten Sekunden über dich denken.', 'text', 'Frag zwei Menschen ehrlich, wie du auf Fremde wirkst, und schreibe die Antworten auf.'],
      ['Grundlagen', 'Körpersprache', 'Haltung, Blick und Hände.', 'check', 'Achte einen Tag lang bewusst auf deine Haltung. Hake ab, wenn du es getan hast.'],
      ['Grundlagen', 'Die Basis-Garderobe', 'Zehn Teile, die immer funktionieren.', 'text', 'Mach eine Liste: Was hast du schon, was fehlt dir noch?'],
    ],
  },
];

const POSTS = [
  {
    slug: 'disziplin-ist-eine-entscheidung',
    title: 'Disziplin ist eine Entscheidung, keine Eigenschaft',
    excerpt: 'Niemand wird diszipliniert geboren. Disziplin entsteht aus kleinen Entscheidungen, die du jeden Tag wieder triffst.',
    body: 'Viele Männer warten darauf, dass sie sich diszipliniert fühlen. Das Gefühl kommt aber selten zuerst. Es kommt nach der Handlung.\n\nFang kleiner an, als dein Ego möchte. Zehn Minuten am Tag, die du wirklich durchziehst, sind mehr wert als zwei Stunden, die du nach drei Tagen aufgibst.\n\nSchreib dir heute eine einzige Sache auf, die du morgen früh als Erstes erledigst. Nicht mehr. Und dann mach sie.',
  },
  {
    slug: 'klarheit-vor-tempo',
    title: 'Klarheit vor Tempo',
    excerpt: 'Wer schnell in die falsche Richtung läuft, kommt nur schneller falsch an. Warum der erste Schritt immer eine ehrliche Bestandsaufnahme ist.',
    body: 'Bevor du etwas veränderst, musst du wissen, wo du stehst. Das klingt banal, aber die meisten überspringen genau diesen Schritt.\n\nNimm dir 15 Minuten und beantworte vier Fragen schriftlich: Wie geht es meinem Körper? Wie steht es um mein Geld? Wie sind meine Beziehungen? Was beschäftigt meinen Kopf am meisten?\n\nKein Schönreden, kein Drama. Nur der Ist-Zustand. Von dort aus wird jeder Schritt messbar.',
  },
];

function seed(db) {
  const count = db.get('SELECT COUNT(*) AS n FROM subjects').n;
  if (count > 0) return false;
  db.tx(() => {
    SUBJECTS.forEach((s, i) => {
      const res = db.run(
        `INSERT INTO subjects (slug, title, tagline, description, level_title, status, sort, teacher_name, teacher_bio)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.slug, s.title, s.tagline, s.description, s.level_title, s.status, i, s.teacher_name, s.teacher_bio,
      );
      s.seminars.forEach(([block, title, summary, taskType, prompt], j) => {
        db.run(
          `INSERT INTO seminars (subject_id, position, block_title, title, summary, task_type, task_prompt, published)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          res.lastInsertRowid, j + 1, block, title, summary, taskType, prompt,
        );
      });
    });
    for (const post of POSTS) {
      db.run('INSERT INTO posts (slug, title, excerpt, body, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        post.slug, post.title, post.excerpt, post.body, nowIso(), nowIso());
    }
  });
  return true;
}

module.exports = { seed, SUBJECTS };
