const { Document, Packer, Paragraph, TextRun, Header, Footer, AlignmentType, PageNumber, HeadingLevel } = require('docx');
const fs = require('fs');
const path = require('path');

// Ensure directory exists
const docsDir = path.join(__dirname, 'public', 'docs');
if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
}

// ============================================
// 1. AFBOUWVOORWAARDEN 2025
// ============================================
const afbouwDoc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 20 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal",
        run: { size: 32, bold: true, color: "000000", font: "Arial" },
        paragraph: { spacing: { before: 240, after: 120 }, alignment: AlignmentType.CENTER } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, color: "000000", font: "Arial" },
        paragraph: { spacing: { before: 200, after: 100 } } },
    ]
  },
  sections: [{
    properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Afbouwvoorwaarden 2025", size: 18, italics: true })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Pagina ", size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) },
    children: [
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Afbouwvoorwaarden 2025")] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: "Algemene leveringsvoorwaarden voor de Stukadoors- en Afbouwbranche", italics: true })] }),
      
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 1: Toepasselijkheid")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("1.1. Het afbouwbedrijf dat deze voorwaarden gebruikt wordt aangeduid als opdrachtnemer. De wederpartij wordt aangeduid als opdrachtgever.")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("1.2. Deze voorwaarden zijn van toepassing op alle aanbiedingen die een afbouwbedrijf doet, op alle overeenkomsten die hij sluit en op alle overeenkomsten die hieruit voortvloeien.")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("1.3. Bij strijdigheid tussen een bepaling uit de gesloten overeenkomst en deze voorwaarden, gaat de bepaling uit de overeenkomst voor.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 2: Aanbiedingen")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("2.1. Alle aanbiedingen van opdrachtnemer zijn vrijblijvend en herroepelijk.")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("2.2. De prijzen zijn in euro's, exclusief BTW en andere heffingen.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 3: Geheimhouding")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("3.1. Alle verstrekte informatie is vertrouwelijk en mag alleen voor de uitvoering van de overeenkomst worden gebruikt.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 4: Levertijd")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("4.1. Alle levertijden zijn indicatief. Bij overschrijding dient opdrachtgever opdrachtnemer in gebreke te stellen.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 5: Uitvoering werk")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("5.1. Opdrachtgever zorgt ervoor dat opdrachtnemer zijn werkzaamheden veilig en ongestoord kan verrichten.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 6: Oplevering")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("6.1. Het werk wordt als opgeleverd beschouwd wanneer opdrachtgever het werk heeft goedgekeurd of in gebruik heeft genomen.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 7: Aansprakelijkheid")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("7.1. Aansprakelijkheid is beperkt tot het bedrag dat onder de verzekering wordt uitbetaald, of maximaal 15% van de opdrachtsom.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 8: Garantie")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("8.1. Opdrachtnemer staat voor een periode van zes maanden na oplevering in voor de goede uitvoering.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 9: Betaling")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("9.1. Betaling binnen 30 dagen na factuurdatum.")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("9.2. Bij te late betaling is 12% rente per jaar verschuldigd.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 10: Toepasselijk recht")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("10.1. Nederlands recht is van toepassing. Bevoegde rechter is in de vestigingsplaats van opdrachtnemer.")] }),

      new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: "Deze Afbouwvoorwaarden 2025 zijn aangepast voor de stukadoors- en afbouwbranche.", italics: true, size: 18 })] }),
    ]
  }]
});

// ============================================
// 2. MODELOVEREENKOMST AANNEMER (90523.64772.1.0)
// ============================================
const aannemerDoc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 20 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", run: { size: 28, bold: true }, paragraph: { spacing: { after: 120 }, alignment: AlignmentType.CENTER } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", run: { size: 22, bold: true }, paragraph: { spacing: { before: 160, after: 80 } } },
    ]
  },
  sections: [{
    properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Nr. 90523.64772.1.0", size: 18, italics: true })] })] }) },
    children: [
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("AANNEMINGSOVEREENKOMST")] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Onderaannemer voert werk op locatie uit", italics: true })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Stukadoors- en Afbouwbranche", bold: true })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: "VERSIE AANNEMER", bold: true })] }),

      new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: "Belastingdienst kenmerknummer: 90523.64772.1.0", bold: true })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Ondergetekenden")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("__________ (bedrijfsnaam aannemer), gevestigd te __________, KvK: __________, vertegenwoordigd door __________,")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: "verder te noemen \"Aannemer\";", bold: true })] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("en")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("de heer/mevrouw __________, handelend onder de naam __________, gevestigd te __________, BTW: __________, KvK: __________,")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: "hierna te noemen \"Onderaannemer\";", bold: true })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 1: Het werk")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("1.1. Aannemer draagt aan Onderaannemer op om het volgende werk uit te voeren:")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("Omschrijving: __________")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("Locatie: __________")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("Benaming: __________")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 2: Prijs")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("2.1. Aanneemsom: € __________ exclusief BTW")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("OF: Uurtarief € __________ / Tarief per m² € __________")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 3: Betaling")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("3.1. Betaling binnen _____ dagen na goedkeuring factuur.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 4: Zelfstandigheid (GEMARKEERD - DBA)")] }),
      new Paragraph({ spacing: { after: 100 }, shading: { fill: "FFFF00" }, children: [new TextRun({ text: "4.1. Onderaannemer richt in onafhankelijkheid zijn werk in en bepaalt zelf de wijze van uitvoering.", bold: true })] }),
      new Paragraph({ spacing: { after: 100 }, shading: { fill: "FFFF00" }, children: [new TextRun({ text: "4.2. Aannemer geeft geen aanwijzingen over HOE het werk wordt uitgevoerd.", bold: true })] }),
      new Paragraph({ spacing: { after: 100 }, shading: { fill: "FFFF00" }, children: [new TextRun({ text: "4.3. Onderaannemer is volledig vrij in het aannemen van opdrachten van derden.", bold: true })] }),
      new Paragraph({ spacing: { after: 100 }, shading: { fill: "FFFF00" }, children: [new TextRun({ text: "4.4. Onderaannemer gebruikt eigen gereedschap en vervoermiddelen.", bold: true })] }),
      new Paragraph({ spacing: { after: 200 }, shading: { fill: "FFFF00" }, children: [new TextRun({ text: "4.5. Onderaannemer draagt zelf verantwoordelijkheid voor verzekeringen, pensioen en arbeidsongeschiktheid.", bold: true })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 5: Verwijzing beoordeling")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: "5.1. Deze overeenkomst is gelijkluidend aan de door de Belastingdienst op 12 juli 2023 onder nummer 90523.64772.1.0 beoordeelde overeenkomst.", bold: true })] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("5.2. De gemarkeerde bepalingen zijn ongewijzigd overgenomen.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Ondertekening")] }),
      new Paragraph({ spacing: { before: 200 }, children: [new TextRun("Aldus in tweevoud opgemaakt te __________ op __________")] }),
      new Paragraph({ spacing: { before: 200 }, children: [new TextRun("Namens Aannemer:\t\t\t\tOnderaannemer:")] }),
      new Paragraph({ spacing: { before: 100 }, children: [new TextRun("Handtekening: ________________\t\tHandtekening: ________________")] }),
      new Paragraph({ spacing: { before: 60 }, children: [new TextRun("Naam: ________________________\t\tNaam: ________________________")] }),
    ]
  }]
});

// ============================================
// 3. MODELOVEREENKOMST ONDERAANNEMER (90523.64772.2.0)
// ============================================
const onderaannemerDoc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 20 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", run: { size: 28, bold: true }, paragraph: { spacing: { after: 120 }, alignment: AlignmentType.CENTER } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", run: { size: 22, bold: true }, paragraph: { spacing: { before: 160, after: 80 } } },
    ]
  },
  sections: [{
    properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Nr. 90523.64772.2.0", size: 18, italics: true })] })] }) },
    children: [
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("AANNEMINGSOVEREENKOMST")] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Onderaannemer voert werk op locatie uit", italics: true })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Stukadoors- en Afbouwbranche", bold: true })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: "VERSIE ONDERAANNEMER / ZZP'ER", bold: true })] }),

      new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: "Belastingdienst kenmerknummer: 90523.64772.2.0", bold: true })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Ondergetekenden")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("__________ (bedrijfsnaam aannemer), gevestigd te __________, KvK: __________,")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: "verder te noemen \"Aannemer\";", bold: true })] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("en")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("de heer/mevrouw __________, handelend onder de naam __________, gevestigd te __________, BTW: __________, KvK: __________,")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: "hierna te noemen \"Onderaannemer\";", bold: true })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 1: Het werk")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("Omschrijving: __________")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("Locatie: __________")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 2: Prijs")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("Aanneemsom/Uurtarief/Per m²: € __________")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 3: Zelfstandigheid (GEMARKEERD - DBA)")] }),
      new Paragraph({ spacing: { after: 100 }, shading: { fill: "FFFF00" }, children: [new TextRun({ text: "3.1. Onderaannemer bepaalt zelf HOE het werk wordt uitgevoerd.", bold: true })] }),
      new Paragraph({ spacing: { after: 100 }, shading: { fill: "FFFF00" }, children: [new TextRun({ text: "3.2. Onderaannemer is vrij om opdrachten van derden aan te nemen.", bold: true })] }),
      new Paragraph({ spacing: { after: 100 }, shading: { fill: "FFFF00" }, children: [new TextRun({ text: "3.3. Onderaannemer gebruikt eigen gereedschap en vervoer.", bold: true })] }),
      new Paragraph({ spacing: { after: 200 }, shading: { fill: "FFFF00" }, children: [new TextRun({ text: "3.4. Onderaannemer zorgt zelf voor verzekeringen en pensioen.", bold: true })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Artikel 4: Verwijzing beoordeling")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: "Deze overeenkomst is gelijkluidend aan de door de Belastingdienst op 12 juli 2023 onder nummer 90523.64772.2.0 beoordeelde overeenkomst.", bold: true })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Checklist voor ZZP'er")] }),
      new Paragraph({ spacing: { after: 60 }, children: [new TextRun("☐ Ingeschreven bij KvK")] }),
      new Paragraph({ spacing: { after: 60 }, children: [new TextRun("☐ BTW-nummer aanwezig")] }),
      new Paragraph({ spacing: { after: 60 }, children: [new TextRun("☐ Aansprakelijkheidsverzekering")] }),
      new Paragraph({ spacing: { after: 60 }, children: [new TextRun("☐ Eigen gereedschap")] }),
      new Paragraph({ spacing: { after: 60 }, children: [new TextRun("☐ Eigen vervoer")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("☐ Vrij om andere opdrachten aan te nemen")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Ondertekening")] }),
      new Paragraph({ spacing: { before: 200 }, children: [new TextRun("Aldus in tweevoud opgemaakt te __________ op __________")] }),
      new Paragraph({ spacing: { before: 200 }, children: [new TextRun("Aannemer:\t\t\t\t\tOnderaannemer:")] }),
      new Paragraph({ spacing: { before: 100 }, children: [new TextRun("Handtekening: ________________\t\tHandtekening: ________________")] }),
    ]
  }]
});

// Generate all documents
async function generateDocs() {
  try {
    // Afbouwvoorwaarden
    const buffer1 = await Packer.toBuffer(afbouwDoc);
    fs.writeFileSync(path.join(docsDir, 'Afbouwvoorwaarden_2025.docx'), buffer1);
    console.log('✅ Afbouwvoorwaarden_2025.docx');

    // Aannemer versie
    const buffer2 = await Packer.toBuffer(aannemerDoc);
    fs.writeFileSync(path.join(docsDir, 'Modelovereenkomst_90523.64772.1.0_Aannemer.docx'), buffer2);
    console.log('✅ Modelovereenkomst_90523.64772.1.0_Aannemer.docx');

    // Onderaannemer versie
    const buffer3 = await Packer.toBuffer(onderaannemerDoc);
    fs.writeFileSync(path.join(docsDir, 'Modelovereenkomst_90523.64772.2.0_Onderaannemer.docx'), buffer3);
    console.log('✅ Modelovereenkomst_90523.64772.2.0_Onderaannemer.docx');

    console.log('\n📁 Alle documenten aangemaakt in:', docsDir);
  } catch (error) {
    console.error('❌ Fout:', error.message);
  }
}

generateDocs();
