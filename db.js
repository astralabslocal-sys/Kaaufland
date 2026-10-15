// Datenbank-Zugriff (PostgreSQL) + Schema-Migration + Erstbefüllung.
'use strict';

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const useSSL = /sslmode=require/.test(process.env.DATABASE_URL || '') || process.env.PGSSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

// Rollen, von niedrig nach hoch. "Teamler oder höher" = jede eingeloggte Person.
const ROLES = ['teamler', 'supporter', 'admin', 'owner'];

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  supporter: 'Supporter',
  teamler: 'Teamler',
};

// Die ursprünglichen Original-Texte der Seite. Dienen als Startwert in der DB,
// damit sich optisch nichts ändert, bis jemand über das Admin-Panel etwas bearbeitet.
const DEFAULT_CONTENT = {
  hero_body: `
    <div class="lede">
      <p>Stadttauben gehören längst zu unserem Stadtbild. Doch ihr Leben in unseren Städten ist oft geprägt von Hunger, Krankheiten, ungeeigneten Brutplätzen und Konflikten mit Menschen.</p>
      <p>Gleichzeitig leiden Anwohner unter Verschmutzungen, Lärm und großen Taubenansammlungen.</p>
      <p class="callout">Beides muss kein Widerspruch sein.</p>
      <p>Wir möchten gemeinsam mit Bürgern, Tierschutz, Fachleuten und unserer Stadt ein modernes, tierschutzgerechtes und nachhaltiges Stadttaubenmanagement aufbauen.</p>
    </div>
    <p class="kicker">Unser Ziel</p>
    <ul class="goal-list">
      <li>Betreute Taubenschläge</li>
      <li>Kontrollierter Eiertausch</li>
      <li>Artgerechte Versorgung</li>
      <li>Weniger Tierleid</li>
      <li>Weniger Verschmutzung</li>
      <li>Weniger Konflikte</li>
    </ul>
    <p class="closing">Und langfristig: eine Stadt, in der Mensch und Tier besser miteinander leben können.</p>
  `.trim(),

  sec1_body: `
      <p>Stadttauben sind heute aus vielen Städten nicht mehr wegzudenken. Gleichzeitig führen große Taubenbestände immer wieder zu Konflikten.</p>
      <p>Taubenkot auf Gebäuden, Plätzen und Fahrzeugen, verletzte Tiere, Beschwerden von Anwohnern und ungeeignete Brutplätze sind reale Probleme.</p>
      <p>Doch die bisherigen Reaktionen lösen die Ursache häufig nicht dauerhaft. Tauben zu vertreiben bedeutet nicht, dass sie verschwinden. Sie suchen sich häufig neue Brut- und Aufenthaltsplätze und sind aufgrund ihrer Historie sehr standorttreu.</p>
      <p>Auch Fütterungsverbote oder Vergrämungsmaßnahmen sind keine Lösung, da es aufgrund der fehlenden artgerechten Ernährung zu dem sogenannten Hungerkot kommt, der sich als flüssiger Kot äußert. Gesunder Taubenkot ist fest und lässt sich sehr leicht entfernen.</p>
      <p>Der Deutsche Tierschutzbund empfiehlt deshalb ein <strong>tierschutzgerechtes Gesamtkonzept</strong>, bei dem unter anderem betreute Taubenschläge, kontrollierte Fütterung und der Austausch der Eier gegen Attrappen miteinander verbunden werden.</p>
      <p>Wir wollen die Situation verändern. Denn eine kleinere und gesündere Taubenpopulation kann gleichzeitig bedeuten:</p>
      <div class="stat-row">
        <div>Weniger Tierleid</div>
        <div>Weniger Verschmutzung</div>
        <div>Weniger Konflikte</div>
      </div>
  `.trim(),

  sec2_body: `
      <p>Stadttauben stammen ursprünglich von der Felsentaube ab. Über Jahrtausende wurden Tauben vom Menschen gehalten und gezüchtet – unter anderem als Fleisch-, Zucht- und Brieftauben.</p>
      <p>Viele der heutigen Stadttauben sind Nachkommen entflogener, ausgesetzter oder verwilderter Haustauben. Damit ist ihre Geschichte eng mit uns Menschen verbunden.</p>
      <p>Die Felsentaube brütet ursprünglich in Felsnischen und Höhlen. Unsere Städte bieten Tauben heute etwas Ähnliches: Mauernischen, Dächer, Brücken, Bahnhöfe, Fassaden und andere geschützte Strukturen.</p>
      <p>Als die Haltung von Haustauben in vielen Bereichen zurückging, blieben Tiere zurück, wurden ausgesetzt und passten sich an das Leben in unseren Städten an.</p>
      <p><strong>Deshalb sind Stadttauben auch eine menschliche Verantwortung.</strong> Wir haben sie über Jahrhunderte geprägt. Jetzt sollten wir auch Verantwortung für die Situation übernehmen, die daraus entstanden ist.</p>
  `.trim(),

  sec3_body: `
      <p>Warum sich Stadttauben so stark vermehren: Der sogenannte „Brutzwang" ist ein entscheidender Punkt beim Stadttaubenmanagement. Dieser beschreibt das besondere Fortpflanzungsverhalten der Tiere.</p>
      <p>Stadttauben brüten – im Gegensatz zu vielen wildlebenden Vogelarten – über einen sehr großen Teil des Jahres. Hierbei sprechen wir von bis zu 8-mal im Jahr, wohingegen die Wildtaube bis zu 2-mal im Jahr brütet.</p>
      <p>Der Deutsche Tierschutzbund führt die Fähigkeit zur ganzjährigen Vermehrung auf die jahrhundertelange Zucht durch den Menschen zurück. Dabei geht es nicht darum, dass eine Taube „bewusst möglichst viel brüten möchte". Vielmehr handelt es sich um ein Fortpflanzungsverhalten, das durch die jahrhundertelange Domestikation und Zucht des Menschen beeinflusst wurde.</p>
      <p>Ein vergleichbarer Grundgedanke findet sich auch in der Nutztierzucht: Der Mensch hat bei verschiedenen Tierarten über Generationen bestimmte Eigenschaften gezielt verstärkt – etwa eine besonders hohe Legeleistung bei Hühnern oder eine erhöhte Fortpflanzungsleistung bei anderen Nutztieren. Was ursprünglich natürlichen Grenzen unterlag, wurde durch Zucht verändert und gesteigert.</p>
      <p><strong>Die hohe Fortpflanzungsleistung ist deshalb nicht einfach „Natur", sondern auch ein Ergebnis der langen gemeinsamen Geschichte von Mensch und Taube.</strong></p>
      <div class="equation">
        <div>ausgeprägter Fortpflanzungstrieb</div>
        <div>+ schlechte Lebensbedingungen</div>
        <div>+ fehlende kontrollierte Brutplätze</div>
        <div class="result">= wachsende, häufig belastete Taubenbestände</div>
      </div>
      <p>Viele Tauben brüten an ungeeigneten oder gefährlichen Orten und finden gleichzeitig nicht ausreichend artgerechte Nahrung. So entsteht ein Kreislauf, den wir durch ein professionelles Management durchbrechen möchten.</p>
      <div class="reframe">
        <p class="no">„Wie werden wir die Tauben los?"</p>
        <p class="yes">„Wie können wir die Population tierschutzgerecht kontrollieren und gleichzeitig die Lebensbedingungen der vorhandenen Tiere verbessern?"</p>
      </div>
  `.trim(),

  sec4_body: `
      <p><strong>Das Herzstück unseres Konzepts: der betreute Taubenschlag.</strong> Ein Taubenhaus ist weit mehr als ein Unterschlupf – es ist der Mittelpunkt eines kontrollierten Stadttaubenmanagements.</p>
      <p class="kicker">Die Tauben erhalten dort</p>
      <ul class="feature-list">
        <li>geeignete Nistplätze</li>
        <li>artgerechtes Futter</li>
        <li>frisches Wasser</li>
        <li>wichtige Mineralien</li>
        <li>regelmäßige Gesundheitskontrolle</li>
        <li>kontrollierten Eiertausch</li>
        <li>regelmäßige Reinigung</li>
      </ul>
      <p>Der Taubenschlag wird zu einem Ort, an dem die Tiere sicher leben und brüten können – und gleichzeitig von uns betreut werden.</p>
      <p>Das Land Brandenburg bezeichnet betreute Taubenschläge als Mittelpunkt eines Gesamtkonzeptes. Dazu gehören unter anderem artgerechte Fütterung, Eiertausch, Dokumentation, tierärztliche Versorgung und die fachgerechte Betreuung.</p>
      <p>Und auch die Stadt profitiert: Wenn Tauben ihren bevorzugten Aufenthalts- und Brutplatz im betreuten Schlag finden, kann ein großer Teil des Kots dort gesammelt und regelmäßig entfernt werden. Gleichzeitig können problematische Brutplätze nach fachlicher Prüfung verschlossen und andere Maßnahmen gezielt eingesetzt werden.</p>
      <div class="stat-row">
        <div>Mehr Kontrolle für die Stadt</div>
        <div>Bessere Bedingungen für die Tauben</div>
        <div>Weniger Konflikte für die Menschen</div>
      </div>
  `.trim(),

  sec5_body: `
      <p><strong>Eiertausch statt Nachwuchs ohne Ende</strong> – ein einfacher Gedanke mit großer Wirkung.</p>
      <p>Tauben sollen brüten dürfen. Aber nicht jedes Gelege muss zu neuen Küken führen. Deshalb werden in betreuten Taubenschlägen die gelegten Eier regelmäßig gegen geeignete Ei-Attrappen ausgetauscht.</p>
      <p>Die Taube brütet weiterhin. Sie kann ihr natürliches Brutverhalten ausleben. <strong>Aber es schlüpfen keine Küken.</strong> So kann die Population langfristig und tierschutzgerecht reduziert werden.</p>
      <p>Das Land Brandenburg empfiehlt beim Gelegetausch, die Eier regelmäßig und spätestens bis zum siebten Tag gegen Ei-Attrappen auszutauschen.</p>
      <p class="kicker">Warum nicht einfach die Eier entfernen?</p>
      <p>Weil eine ersatzlose Entfernung zu erneuter Eiablage führen kann. Beim Eiertausch bleibt dagegen eine Attrappe im Nest. Brüten bleibt möglich – Nachwuchs wird verhindert.</p>
      <p>Der Deutsche Tierschutzbund beschreibt den Eiaustausch als Bestandteil eines tierschutzgerechten Taubenmanagements und verbindet ihn ausdrücklich mit betreuten Taubenschlägen.</p>
      <p class="pullquote">Unser Ziel: eine kleinere, gesündere und kontrollierte Stadttaubenpopulation.</p>
  `.trim(),

  sec6_body: `
      <p>Ein Taubenhaus allein reicht nicht. Deshalb denken wir Stadttaubenmanagement ganzheitlich.</p>
      <div class="num-grid">
        <div class="num-card"><span class="n">01</span><h3>Betreute Taubenschläge</h3><p>Geeignete, zentral gelegene und fachgerecht betreute Standorte schaffen.</p></div>
        <div class="num-card"><span class="n">02</span><h3>Kontrollierter Eiertausch</h3><p>Die Fortpflanzung wird tierschutzgerecht kontrolliert.</p></div>
        <div class="num-card"><span class="n">03</span><h3>Artgerechte Fütterung</h3><p>Geeignetes Futter an definierten Standorten statt Abfälle und ungeeignete Lebensmittel.</p></div>
        <div class="num-card"><span class="n">04</span><h3>Wasser &amp; Mineralversorgung</h3><p>Frisches Wasser und geeignete Mineralien gehören zur Grundversorgung.</p></div>
        <div class="num-card"><span class="n">05</span><h3>Gesundheit &amp; Tierwohl</h3><p>Verletzte und kranke Tiere sollen erkannt und tierärztlich versorgt werden.</p></div>
        <div class="num-card"><span class="n">06</span><h3>Hygiene &amp; Reinigung</h3><p>Taubenschläge werden regelmäßig gereinigt, Kot fachgerecht entfernt.</p></div>
        <div class="num-card"><span class="n">07</span><h3>Brutplätze reduzieren</h3><p>Nach Umsiedlung können bisher genutzte Brutplätze fachgerecht verschlossen werden.</p></div>
        <div class="num-card"><span class="n">08</span><h3>Zählen statt schätzen</h3><p>Bestände, Brutplätze und Entwicklungen werden dokumentiert.</p></div>
        <div class="num-card"><span class="n">09</span><h3>Aufklärung</h3><p>Vorurteile abbauen und gleichzeitig die Sorgen der Bevölkerung ernst nehmen.</p></div>
        <div class="num-card"><span class="n">10</span><h3>Zusammenarbeit</h3><p>Tierschutz, Bürger, Tierärzte, Hausverwaltungen, Stadtreinigung und Verwaltung im Gespräch.</p></div>
      </div>
      <p class="pullquote">Denn Stadttaubenmanagement funktioniert nicht allein. Es funktioniert gemeinsam.</p>
  `.trim(),

  sec7_body: `
      <p>Wir wollen nicht gegen unsere Stadt arbeiten. <strong>Wir wollen sie als Partner gewinnen.</strong></p>
      <p>Unser langfristiges Ziel ist ein offizielles, dauerhaft finanziertes und fachlich begleitetes Stadttaubenmanagement in unserer Stadt. Dafür möchten wir mit den zuständigen Stellen ins Gespräch kommen:</p>
      <div class="chip-row">
        <span class="chip">Stadtverwaltung</span><span class="chip">Veterinäramt</span><span class="chip">Ordnungsamt</span>
        <span class="chip">Stadtreinigung</span><span class="chip">Politik</span><span class="chip">Grundstückseigentümer</span>
        <span class="chip">Tierschutzorganisationen</span><span class="chip">Tierärzte</span><span class="chip">Bürger</span>
      </div>
      <p>Das Land Brandenburg empfiehlt ausdrücklich, dass die Kommune eine zentrale Rolle beim Aufbau eines tragfähigen Stadttaubenmanagements übernimmt und die verschiedenen beteiligten Akteure zusammenführt.</p>
      <p>Wir wollen der Stadt keinen Vorwurf machen. Wir wollen einen Vorschlag machen. <strong>Einen konkreten Plan.</strong></p>
      <p class="kicker">Wir möchten gemeinsam mit der Stadt</p>
      <ol class="step-list">
        <li>Tauben-Hotspots erfassen</li>
        <li>Bestände und Brutplätze dokumentieren</li>
        <li>geeignete Standorte für Taubenschläge prüfen</li>
        <li>ein Pilotprojekt aufbauen</li>
        <li>den Eiertausch professionell organisieren</li>
        <li>die Entwicklung der Population dokumentieren</li>
        <li>die Verschmutzung und Beschwerden erfassen</li>
        <li>Erfolge regelmäßig überprüfen</li>
        <li>das Konzept bei Erfolg ausweiten</li>
      </ol>
      <p class="pullquote">Tierschutz und eine saubere Stadt müssen keine Gegensätze sein.</p>
      <p>Dafür brauchen wir zunächst eines: Menschen, die hinter dieser Idee stehen.</p>
  `.trim(),

  sec8_body: `
      <p><strong>Gemeinsam können wir etwas bewegen.</strong> Eine Stadt verändert sich nicht durch einen einzelnen Menschen. Aber viele Menschen können eine Stadt zum Handeln bewegen.</p>
      <p>Damit unsere Idee gehört wird, brauchen wir Menschen aus der Stadt, die sagen: <strong>Ja, ich unterstütze ein tierschutzgerechtes Stadttaubenmanagement.</strong></p>
      <p>Dabei geht es zunächst nicht darum, alles perfekt zu machen. Es geht darum, zu zeigen: Wir sind viele. Wir meinen es ernst. Wir wollen eine Lösung. <strong>Deine Stimme zählt.</strong></p>
      <p>Wir möchten Unterstützer gewinnen und gemeinsam mit ihnen eine Petition bzw. Unterschriftenaktion starten.</p>
      <p class="pullquote">Die Stadt soll sich mit einem tierschutzgerechten Stadttaubenmanagement auseinandersetzen und die Voraussetzungen für ein betreutes Taubenhaus prüfen.</p>
      <p>Je mehr Menschen unsere Forderung unterstützen, desto deutlicher wird: Das Thema betrifft unsere Stadt – und die Bürgerinnen und Bürger wünschen sich eine nachhaltige Lösung.</p>
      <div class="cta-row">
        <button type="button" class="btn btn-primary open-petition">Jetzt unterschreiben</button>
        <a class="btn btn-ghost" href="#kontakt">Kontaktiere uns</a>
      </div>
  `.trim(),

  sec9_body: `
      <p>Wir möchten gemeinsam mit der Stadt einen neuen Weg einschlagen. Deshalb setzen wir uns ein für:</p>
      <div class="demand">
        <h3>Ein offizielles Stadttaubenmanagement</h3>
        <p>Nicht einzelne, voneinander unabhängige Maßnahmen, sondern ein abgestimmtes Gesamtkonzept.</p>
      </div>
      <div class="demand">
        <h3>Mindestens einen betreuten Taubenschlag als Pilotprojekt</h3>
        <p>An einem fachlich geeigneten Standort in der Nähe eines Tauben-Hotspots.</p>
      </div>
      <div class="demand">
        <h3>Kontrollierten Eiertausch</h3>
        <p>Als tierschutzgerechte Methode zur langfristigen Bestandskontrolle.</p>
      </div>
      <div class="demand">
        <h3>Kontrollierte und artgerechte Versorgung</h3>
        <p>Mit geeignetem Futter, Wasser und Mineralien.</p>
      </div>
      <div class="demand">
        <h3>Fachliche Betreuung</h3>
        <p>Einschließlich eines Konzepts für verletzte und kranke Tiere.</p>
      </div>
      <div class="demand">
        <h3>Transparente Erfolgskontrolle</h3>
        <p>Bestandsentwicklung, Eiertausch, Beschwerden und Verschmutzung sollen dokumentiert werden.</p>
      </div>
      <div class="demand">
        <h3>Einen festen Ansprechpartner</h3>
        <p>Eine zuständige Stelle bzw. eine Taubenbeauftragte oder einen Taubenbeauftragten, der die Beteiligten koordiniert.</p>
      </div>
      <div class="demand">
        <h3>Aufklärung der Bevölkerung</h3>
        <p>Die Bürgerinnen und Bürger müssen verstehen, warum kontrollierte Fütterung, Taubenschläge und Eiertausch zusammengehören.</p>
      </div>
      <p class="pullquote">Wir fordern eine Chance, zu beweisen, dass eine andere Lösung funktionieren kann.</p>
  `.trim(),

  sec10_body: `
      <p>Du möchtest helfen? Du kannst sofort etwas bewirken.</p>
      <div class="action-grid">
        <div class="action-card">
          <h3>Unterschreibe unsere Petition</h3>
          <p>Unterstütze unsere Forderung nach einem tierschutzgerechten Stadttaubenmanagement.</p>
          <button type="button" class="btn btn-ghost open-petition">Jetzt unterschreiben</button>
        </div>
        <div class="action-card">
          <h3>Werde Mitglied</h3>
          <p>Je größer unsere Gemeinschaft wird, desto stärker wird unsere Stimme.</p>
          <a class="btn btn-ghost" href="#kontakt">Mitglied werden</a>
        </div>
        <div class="action-card">
          <h3>Teile unsere Initiative</h3>
          <p>Erzähle Freunden, Nachbarn und Kollegen davon.</p>
          <a class="btn btn-ghost" href="#kontakt">Teilen</a>
        </div>
        <div class="action-card">
          <h3>Werde ehrenamtlich aktiv</h3>
          <p>Wir brauchen Menschen für:</p>
          <div class="chip-row">
            <span class="chip">Taubenschlagbetreuung</span><span class="chip">Reinigung</span>
            <span class="chip">Versorgung</span><span class="chip">Dokumentation</span>
            <span class="chip">Öffentlichkeitsarbeit</span><span class="chip">Social Media</span>
            <span class="chip">Infostände</span><span class="chip">Veranstaltungen</span>
            <span class="chip">Politik &amp; Verwaltung</span><span class="chip">Vereinsarbeit</span>
          </div>
          <a class="btn btn-ghost" href="#kontakt">Ich möchte helfen</a>
        </div>
        <div class="action-card">
          <h3>Unterstütze den Aufbau</h3>
          <p>Ein Taubenschlag, Futter, medizinische Versorgung und Ausstattung kosten Geld.</p>
          <a class="btn btn-ghost" href="#kontakt">Aufbau unterstützen</a>
        </div>
      </div>
      <p class="pullquote">Du musst kein Taubenexperte sein. Du musst sie auch nicht besonders lieben. Es reicht, wenn du findest: So wie es heute läuft, kann es nicht bleiben – und bereit bist, dabei zu helfen, eine bessere Lösung aufzubauen.</p>
  `.trim(),

  sec12_body: `
      <details class="faq-item">
        <summary>Sind Stadttauben Wildtiere?<span class="plus">+</span></summary>
        <p class="faq-a">Nein. Die heutigen Stadttauben sind überwiegend Nachkommen domestizierter Haustauben und stammen ursprünglich von der Felsentaube ab.</p>
      </details>
      <details class="faq-item">
        <summary>Warum gibt es so viele Tauben?<span class="plus">+</span></summary>
        <p class="faq-a">Ihre Anpassung an den städtischen Lebensraum, zahlreiche künstliche Brutplätze und ihre ausgeprägte Fortpflanzungsfähigkeit spielen zusammen. Der Deutsche Tierschutzbund beschreibt insbesondere die ganzjährige Vermehrungsfähigkeit als Folge der Zucht.</p>
      </details>
      <details class="faq-item">
        <summary>Was bedeutet „Brutzwang"?<span class="plus">+</span></summary>
        <p class="faq-a">Damit wird das besonders ausgeprägte und weitgehend ganzjährige Fortpflanzungsverhalten von Stadttauben bezeichnet. Es handelt sich nicht um einen bewussten Zwang, sondern um ein durch Domestikation und Zucht beeinflusstes Verhalten.</p>
      </details>
      <details class="faq-item">
        <summary>Warum brauchen wir Taubenschläge?<span class="plus">+</span></summary>
        <p class="faq-a">Taubenschläge schaffen kontrollierte Brut- und Aufenthaltsplätze. Dort können die Tiere artgerecht versorgt, gesundheitlich kontrolliert und ihre Eier gegen Attrappen ausgetauscht werden.</p>
      </details>
      <details class="faq-item">
        <summary>Werden die Tauben im Taubenhaus eingesperrt?<span class="plus">+</span></summary>
        <p class="faq-a">Nein. Das Konzept sieht vor, den Tieren einen attraktiven, betreuten Aufenthalts- und Brutplatz anzubieten. Tauben sind standorttreu und können an geeigneten Schlägen gebunden werden.</p>
      </details>
      <details class="faq-item">
        <summary>Warum werden die Eier ausgetauscht?<span class="plus">+</span></summary>
        <p class="faq-a">Damit die erwachsenen Tauben weiterhin brüten können, ohne dass aus jedem Gelege Nachwuchs entsteht. Der Eiertausch ist eine zentrale Maßnahme der tierschutzgerechten Bestandskontrolle.</p>
      </details>
      <details class="faq-item">
        <summary>Warum werden die Eier nicht einfach entfernt?<span class="plus">+</span></summary>
        <p class="faq-a">Weil eine ersatzlose Entfernung eine erneute Eiablage begünstigen kann. Deshalb werden die Eier gegen geeignete Attrappen ausgetauscht.</p>
      </details>
      <details class="faq-item">
        <summary>Werden Tauben durch unser Konzept weniger?<span class="plus">+</span></summary>
        <p class="faq-a">Das Ziel ist eine langfristige Reduktion bzw. Stabilisierung der Population. Wie schnell dies gelingt, hängt unter anderem von der Ausgangspopulation, den Standorten, der konsequenten Umsetzung und weiteren Faktoren ab. Deshalb müssen Maßnahmen dokumentiert und regelmäßig ausgewertet werden.</p>
      </details>
      <details class="faq-item">
        <summary>Warum muss die Stadt mitmachen?<span class="plus">+</span></summary>
        <p class="faq-a">Ein nachhaltiges Stadttaubenmanagement benötigt geeignete Standorte, langfristige Finanzierung, Koordination und die Zusammenarbeit verschiedener Stellen.</p>
      </details>
      <details class="faq-item">
        <summary>Was wollen wir von der Stadt?<span class="plus">+</span></summary>
        <p class="faq-a">Wir wollen gemeinsam eine Lösung entwickeln und zunächst beispielsweise ein Pilotprojekt mit einem betreuten Taubenschlag prüfen.</p>
      </details>
      <details class="faq-item">
        <summary>Was kann ich als Bürger tun?<span class="plus">+</span></summary>
        <p class="faq-a">Unterschreiben, Mitglied werden, die Initiative teilen, ehrenamtlich helfen, Kontakte herstellen oder unsere Arbeit finanziell unterstützen. Jede Unterstützung bringt uns einen Schritt näher an eine Lösung.</p>
      </details>
  `.trim(),

  sec13_body: `
      <p>Unsere Arbeit orientiert sich an bestehenden fachlichen Empfehlungen und Erfahrungen aus dem Stadttaubenmanagement. Wir möchten nicht das Rad neu erfinden, sondern auf bereits vorhandenen Erfahrungen aufbauen und diese auf die Situation unserer Stadt übertragen.</p>
      <div class="source-card">
        <h3>Deutscher Tierschutzbund</h3>
        <p>Informiert ausführlich über Stadttauben, ihre Herkunft, ihre Lebensbedingungen und Möglichkeiten eines tierschutzgerechten Stadttaubenmanagements. Besonders relevant: der „Taubenschutz-Leitfaden für Gemeinden" sowie die Broschüre „Stadttaube und Mensch".</p>
      </div>
      <div class="source-card">
        <h3>Land Brandenburg – Landestierschutzbeauftragte</h3>
        <p>Beschreibt das Stadttaubenmanagement als Gesamtkonzept mit betreuten Taubenschlägen, kontrollierter Fütterung, Eiertausch, Dokumentation und Zusammenarbeit mit Kommunen als wichtige Bestandteile.</p>
      </div>
      <div class="source-card">
        <h3>Weitere Fachstellen</h3>
        <p>Bei der Entwicklung unseres Konzepts berücksichtigen wir außerdem Empfehlungen von Tierschutzorganisationen, Kommunen, Veterinärbehörden und weiteren fachlich relevanten Stellen.</p>
      </div>
      <p><strong>Unser Anspruch:</strong> Wir wollen tierschutzgerecht, sachlich und transparent arbeiten. Deshalb überprüfen wir unsere Maßnahmen regelmäßig und möchten die Entwicklung unseres Projekts nachvollziehbar dokumentieren.</p>
  `.trim(),

  kontakt_body: `Egal ob Unterschrift, Mitgliedschaft oder Mithilfe vor Ort – wir freuen uns, von dir zu hören.`,
};

const CONTENT_LABELS = {
  hero_body: 'Startseite – Einleitung',
  sec1_body: '01 – Warum braucht es uns?',
  sec2_body: '02 – Woher kommen Stadttauben?',
  sec3_body: '03 – Der „Brutzwang"',
  sec4_body: '04 – Das Taubenhaus',
  sec5_body: '05 – Der Eiertausch',
  sec6_body: '06 – Unser Gesamtkonzept',
  sec7_body: '07 – Die Stadt gewinnen',
  sec8_body: '08 – Die Bürgerinitiative',
  sec9_body: '09 – Forderungen an die Stadt',
  sec10_body: '10 – Was kann ich tun?',
  sec12_body: '12 – FAQ',
  sec13_body: '13 – Unsere Quellen',
  kontakt_body: 'Kontakt – Einleitungstext',
};

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner','admin','supporter','teamler')),
      active BOOLEAN NOT NULL DEFAULT true,
      must_change_password BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS content_blocks (
      key TEXT PRIMARY KEY,
      html TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      name TEXT,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      edited_at TIMESTAMPTZ,
      edited_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS petition_signatures (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      plz TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Content-Defaults nur einfügen, wenn der Key noch nicht existiert.
  for (const [key, html] of Object.entries(DEFAULT_CONTENT)) {
    await pool.query(
      `INSERT INTO content_blocks (key, html) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, html]
    );
  }

  // Ersten Owner + Admin anlegen, falls noch keine Nutzer existieren.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const ownerEmail = process.env.OWNER_EMAIL;
    const ownerPassword = process.env.OWNER_PASSWORD;
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (ownerEmail && ownerPassword) {
      const hash = await bcrypt.hash(ownerPassword, 12);
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, 'owner', true)`,
        [process.env.OWNER_NAME || 'Owner', ownerEmail.toLowerCase(), hash]
      );
      console.log(`[seed] Owner-Konto angelegt: ${ownerEmail}`);
    } else {
      console.warn('[seed] Kein OWNER_EMAIL/OWNER_PASSWORD gesetzt – kein Owner-Konto angelegt.');
    }

    if (adminEmail && adminPassword) {
      const hash = await bcrypt.hash(adminPassword, 12);
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, 'admin', true)`,
        [process.env.ADMIN_NAME || 'Admin', adminEmail.toLowerCase(), hash]
      );
      console.log(`[seed] Admin-Konto angelegt: ${adminEmail}`);
    } else {
      console.warn('[seed] Kein ADMIN_EMAIL/ADMIN_PASSWORD gesetzt – kein Admin-Konto angelegt.');
    }
  }
}

module.exports = {
  pool,
  ROLES,
  ROLE_LABELS,
  CONTENT_LABELS,
  DEFAULT_CONTENT,
  initSchema,
};
