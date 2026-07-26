/**
 * German language pack.
 */

export const STOPWORDS: readonly string[] = [
  // Artikel / Pronomen / Determinative
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem', 'einen', 'eines',
  'dieser', 'diese', 'dieses', 'jener', 'jene', 'jenes',
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'mein', 'dein', 'sein', 'ihr', 'unser', 'euer',
  // Konjunktionen / Präpositionen
  'und', 'oder', 'aber', 'denn', 'sondern', 'als', 'wie', 'dass', 'weil', 'wenn', 'ob',
  'in', 'im', 'am', 'an', 'auf', 'aus', 'bei', 'mit', 'nach', 'von', 'zu', 'zur', 'zum',
  'durch', 'für', 'gegen', 'ohne', 'um', 'über', 'unter', 'vor', 'hinter', 'neben', 'zwischen',
  // Adverbien / Satzanfänge
  'sehr', 'gut', 'schlecht', 'besser', 'mehr', 'weniger', 'viel', 'viele', 'wenig', 'ganz',
  'jetzt', 'dann', 'danach', 'davor', 'nachher', 'vorher', 'zuerst', 'zuletzt', 'endlich',
  'schon', 'noch', 'immer', 'nie', 'oft', 'manchmal', 'vielleicht', 'fast', 'bereits',
  'alle', 'alles', 'jeder', 'jede', 'jedes', 'andere', 'anderen', 'anderer', 'gleiche', 'selbe',
  'hier', 'da', 'dort', 'wo', 'wann', 'warum', 'weshalb', 'wieso', 'woher', 'wohin',
  'also', 'jedoch', 'allerdings', 'trotzdem', 'dennoch', 'übrigens', 'außerdem', 'zudem',
  'ja', 'nein', 'ok', 'danke', 'hallo', 'bitte',
  'perfekt', 'genau', 'richtig', 'korrekt', 'falsch', 'wahr',
  'ausgezeichnet', 'toll', 'super', 'interessant', 'bemerkenswert',
  // häufige Verben
  'ist', 'sind', 'war', 'waren', 'sein', 'gewesen', 'wird', 'werden', 'wurde', 'würde',
  'hat', 'haben', 'hatte', 'hatten', 'gehabt',
  'macht', 'machen', 'gemacht', 'tut', 'tun', 'getan',
  'kann', 'können', 'könnte', 'könnten', 'muss', 'müssen', 'müsste', 'soll', 'sollen', 'sollte',
  'will', 'wollen', 'wollte', 'möchte', 'möchten',
  'sieht', 'sehen', 'gesehen', 'schaut', 'schauen',
  'versucht', 'versuchen', 'versuchte', 'verwendet', 'verwenden', 'benutzt', 'benutzen',
  'beginnt', 'beginnen', 'begonnen', 'startet', 'starten', 'fertig', 'beendet',
  'prüft', 'prüfen', 'überprüft', 'überprüfen', 'kontrolliert',
  'braucht', 'brauchen', 'benötigt', 'nötig', 'notwendig',
  'scheint', 'scheinen', 'funktioniert', 'funktionieren', 'geht', 'gehen', 'gibt', 'geben',
  // Zahlen / Sonstiges
  'eins', 'zwei', 'drei', 'erste', 'erster', 'zweite', 'zweiter', 'dritte', 'dritter', 'letzte', 'letzter',
  'nummer', 'teil', 'teile', 'art', 'weise', 'sache', 'sachen', 'ding', 'dinge',
  'etwas', 'nichts', 'jemand', 'niemand', 'man',
  'beispiel', 'beispiele', 'fall', 'fälle', 'typ', 'typen',
  'vs', 'etc', 'bzw', 'usw', 'ca', 'ggf',
];

export const COMMON_WORDS: readonly string[] = [
  'zeit', 'zeiten', 'tag', 'tage', 'woche', 'wochen', 'monat', 'monate', 'jahr', 'jahre',
  'heute', 'morgen', 'gestern', 'vormittag', 'nachmittag', 'abend', 'nacht', 'stunde', 'minute',
  'person', 'personen', 'mann', 'frau', 'leute', 'menschen', 'benutzer', 'kunde', 'kunden',
  'welt', 'leben', 'hand', 'hände', 'auge', 'augen', 'kopf', 'gesicht',
  'ort', 'orte', 'platz', 'stelle', 'stellen', 'haus', 'seite', 'ende', 'anfang',
  'punkt', 'punkte', 'linie', 'linien', 'bereich', 'bereiche', 'ebene', 'ebenen',
  'problem', 'probleme', 'frage', 'fragen', 'grund', 'gründe', 'ursache', 'ursachen',
  'antwort', 'antworten', 'idee', 'ideen',
  'name', 'namen', 'wort', 'worte', 'wörter', 'text', 'texte', 'dokument', 'dokumente',
  'datum', 'daten', 'information', 'informationen', 'wert', 'werte', 'ergebnis', 'ergebnisse',
  'zustand', 'zustände', 'situation', 'situationen', 'form', 'formen',
  'schritt', 'schritte', 'phase', 'phasen', 'prozess', 'prozesse', 'verfahren',
  'system', 'systeme', 'modell', 'modelle', 'modus', 'version', 'versionen',
  'arbeit', 'arbeiten', 'aufgabe', 'aufgaben', 'projekt', 'projekte', 'tätigkeit',
  'änderung', 'änderungen', 'modifikation', 'modifikationen',
  'fehler', 'warnung', 'warnungen', 'meldung', 'meldungen', 'nachricht', 'nachrichten',
  'liste', 'listen', 'element', 'elemente', 'eintrag', 'einträge',
  'option', 'optionen', 'einstellung', 'einstellungen', 'konfiguration',
  'test', 'tests', 'prüfung', 'prüfungen', 'kontrolle', 'kontrollen',
  'code', 'codes', 'quelle', 'quellen', 'inhalt', 'inhalte', 'kontext', 'kontexte',
  'speicher', 'suche', 'suchen', 'anfrage', 'anfragen', 'abfrage', 'abfragen',
  'tatsache', 'verlauf', 'sinn', 'rest', 'oben', 'unten', 'drinnen', 'draußen',
  'links', 'rechts', 'mitte', 'hälfte', 'ganz', 'ganze', 'total', 'voll', 'leer',
  'offen', 'geschlossen', 'öffentlich', 'privat', 'lokal', 'entfernt',
  'standard', 'aktuell', 'aktuelle', 'vorherig', 'vorherige', 'nächst', 'nächste', 'kürzlich',
  'folgend', 'folgende', 'folgenden', 'oben', 'unten',
];
