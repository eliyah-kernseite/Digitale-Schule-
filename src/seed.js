'use strict';

const { nowIso } = require('./db');

// Startinhalte. Alles hier ist Entwurf und kann im Adminbereich angepasst werden.

const SUBJECTS = [
  {
    slug: 'persoenlichkeit',
    title: 'Persönlichkeitsentwicklung',
    tagline: 'Klarheit, Selbstbild und innere Stärke.',
    description: 'Nach den Lehren von Napoleon Hill, Bob Proctor und Vadim Zeland, Schritt für Schritt umgesetzt. Du arbeitest an dem, was dich wirklich steuert: deinen Gedanken, deinem Selbstbild und deinen täglichen Entscheidungen.',
    level_title: 'Grundstufe „Fundament“',
    status: 'live',
    teacher_name: '[Name des Lehrers]',
    teacher_bio: 'Kurzer Werdegang in zwei, drei Sätzen: wer er ist, was ihn qualifiziert und warum er unterrichtet. Dieser Text folgt, sobald das Lehrerprofil steht.',
    seminars: [
      ['Klarheit', 'Der Ausgangspunkt', 'Wo stehst du wirklich? Ohne Schönreden, ohne Drama.', 'text', 'Beschreibe in drei bis fünf Sätzen ehrlich, wo du heute stehst: Körper, Geld, Beziehungen, Kopf.'],
      ['Klarheit', 'Der brennende Wunsch', 'Ein Ziel, das dich zieht, statt eines, das du schieben musst.', 'text', 'Schreibe dein Ziel für die nächsten zwölf Monate auf. Konkret, mit Datum und dem Grund, warum es dir wichtig ist.'],
      ['Klarheit', 'Glaube und Autosuggestion', 'Wie wiederholte Sätze deine Haltung prägen.', 'check', 'Formuliere einen Satz zu deinem Ziel und lies ihn sieben Tage lang morgens und abends laut. Hake ab, wenn du begonnen hast.'],
      ['Paradigmen', 'Was dich wirklich steuert', 'Gewohnheiten im Denken erkennen, die du nie bewusst gewählt hast.', 'text', 'Schreibe drei Überzeugungen auf, die dich heute bremsen.'],
      ['Paradigmen', 'Das Selbstbild', 'Du handelst so, wie du dich selbst siehst.', 'text', 'Beschreibe den Mann, der du in einem Jahr sein willst: Wie startet er seinen Tag? Wie spricht er? Was lässt er weg?'],
      ['Paradigmen', 'Das Gesetz der Schwingung', 'Eine Lehre über Stimmung und Wirkung, als Methode für den Alltag.', 'text', 'Beobachte drei Tage lang, in welcher Stimmung du wichtige Entscheidungen triffst. Notiere, was dir auffällt.'],
      ['Gleiten', 'Wichtigkeit reduzieren', 'Warum zu viel Druck dich blockiert.', 'text', 'Nenne eine Sache, die du gerade zu wichtig nimmst, und einen Schritt, mit dem du sie entspannter angehst.'],
      ['Gleiten', 'Pendel erkennen', 'Welche Gruppen und Debatten deine Energie binden.', 'text', 'Schreibe zwei „Pendel“ auf, die dich Zeit und Kraft kosten, und wie du dich davon löst.'],
      ['Gleiten', 'Spiegel der Welt', 'Was du ausstrahlst, kommt als Erfahrung zurück. Als Denkmodell.', 'check', 'Lebe einen Tag bewusst so, als wärst du schon der Mann aus Seminar 5. Hake ab, wenn du es getan hast.'],
      ['Umsetzung', 'Die tägliche Routine', 'Kleine Handlungen, jeden Tag, ohne Ausnahme.', 'text', 'Lege deine Morgenroutine fest: höchstens fünf Punkte, höchstens 30 Minuten. Starte ab morgen den Streak im Zeugnis.'],
      ['Umsetzung', 'Die Mastermind', 'Warum du Menschen brauchst, die dich fordern.', 'text', 'Nenne zwei Menschen, mit denen du regelmäßig über deine Ziele sprechen willst, und poste dein Wochenziel in der Community.'],
      ['Umsetzung', 'Die Abschlussprüfung', 'Rückblick, Bilanz und dein nächster Schritt.', 'text', 'Vergleiche dich mit Seminar 1: Was hat sich verändert? Was ist dein nächstes Ziel?'],
    ],
  },
  {
    slug: 'geld-verdienen',
    title: 'Selbstständig Geld verdienen',
    tagline: 'Lerne, dir etwas Eigenes aufzubauen.',
    description: 'Mit echten Grundlagen statt leerer Versprechen: Angebot finden, erste Kunden gewinnen, sauber kalkulieren. Kein Einkommensversprechen, sondern Handwerk.',
    level_title: 'Grundstufe „Eigenes“',
    status: 'soon',
    teacher_name: '[Lehrer folgt]',
    teacher_bio: 'Das Lehrerprofil folgt zum Start des Fachs.',
    seminars: [
      ['Grundlagen', 'Was du wirklich kannst', 'Deine Fähigkeiten als Ausgangspunkt.', 'text', 'Liste zehn Dinge, bei denen andere dich um Rat fragen.'],
      ['Grundlagen', 'Ein Angebot, das Sinn ergibt', 'Vom Können zum Angebot.', 'text', 'Formuliere dein erstes Angebot in einem Satz.'],
      ['Grundlagen', 'Rechnen statt hoffen', 'Preise, Kosten, Zeit.', 'text', 'Rechne aus, was eine Stunde deiner Arbeit kosten muss.'],
    ],
  },
  {
    slug: 'fitness',
    title: 'Körperliche Fitness',
    tagline: 'Kraft, Ausdauer und Disziplin.',
    description: 'Mit einem klaren Plan, der in deinen Alltag passt. Kein Hochglanz, sondern Training, das du auch in stressigen Wochen durchziehst.',
    level_title: 'Grundstufe „Belastbar“',
    status: 'soon',
    teacher_name: '[Lehrer folgt]',
    teacher_bio: 'Das Lehrerprofil folgt zum Start des Fachs.',
    seminars: [
      ['Grundlagen', 'Dein Startpunkt', 'Ehrlicher Test von Kraft und Ausdauer.', 'text', 'Notiere deine Werte aus dem Starttest.'],
      ['Grundlagen', 'Der Plan, der hält', 'Drei Einheiten pro Woche, die in dein Leben passen.', 'check', 'Trage deine drei Trainingstermine in den Kalender ein.'],
      ['Grundlagen', 'Essen ohne Dogma', 'Grundlagen, die du sofort umsetzen kannst.', 'text', 'Schreibe auf, was du diese Woche an deiner Ernährung änderst.'],
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
