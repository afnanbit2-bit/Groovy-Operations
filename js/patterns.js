/* Groovy Operations — patterns.js
   Plain global JS (NO modules). Loaded via <script src> AFTER marketing.js
   and BEFORE the bootstrap module. Shares the one global lexical scope with
   the other /js/*.js files (window-bridged Firebase globals db/doc/getDocs/
   runTransaction/writeBatch/…, plus session/showToast/logActivity/gvSkeleton
   from js/shared.js and js/auth.js).

   PATTERN HUB — see PATTERN_HUB_PLAN.md for the whole design.

   M0 (this file, initial): the ARTICLE REGISTRY — the TAC list living in the
   app. Three brands, 31 categories, 522 article codes seeded from Ammar's
   "TAC List Complete.docx" (verified against Shopify on 16 Sept 2026). From
   here the app MINTS new codes per category and is the source of truth; the
   .docx becomes an export (M1). No pattern (block) concept yet — that is M2.

   Load-bearing choices (each one is also asserted in tests/patterns.test.js):

   - The article's doc id IS its code. Uniqueness is the document, not a
     query, and a mint is a runTransaction that reads the article first and
     refuses if it exists — the creator_handles lock shape from Marketing.
   - Minting is NEXT-AFTER-HIGHEST per category (tac_categories/{prefix}
     .nextNumber). TAC's numbering holes (GH036, GS016–GS022) are human
     errors, not reservations (Afnan, Q19) — so the counter never fills one
     on its own (a gap is a sign of a mis-type, and landing a new article on
     it would hide that), but an admin may TYPE an explicit unused code to
     fill one deliberately. Either way the transaction refuses an existing
     code, and nextNumber only ever moves forward.
   - A co-ord category (form 'NNN-TB') mints a PAIR — GCO009-T and GCO009-B
     — from one number, in one transaction.
   - needsPattern lives on the CATEGORY and is inherited by each article at
     seed/mint time, overridable per article. Caps (GHW) are false: in the
     registry, coded, no pattern (Afnan, D9).
   - loadPatternsData() CANNOT reject (allSettled) — renderPage dispatches it
     with no .catch. A FAILED read and an EMPTY registry render DIFFERENT
     screens (_ptnLoadFailed): the empty one offers the seed, the failed one
     names the collection and says to republish firestore.rules. That is the
     Store "0 movements" lesson.
   - Audience is by USERNAME (afnan, ammar, mustafa), not role — Arfat holds
     the manager role and gets nothing, matching every Sept 2026 grant.
     js/shared.js reaches _canSeePatternHub() by bare name behind a `typeof`
     guard that fails CLOSED. Mirror: firestore.rules isPatternAdmin(). */

// ── Audience (test phase) ─────────────────────────────────────────────────
const _PATTERN_HUB_USERS=['afnan','ammar','mustafa'];
function _canSeePatternHub(){
  return !!(typeof session!=='undefined'&&session&&_PATTERN_HUB_USERS.indexOf(session.u)>-1);
}
// M0: the same three people. Widens to Uzaib (view) at M3 without touching
// the manage gate, which is why the two are separate functions from day one.
function _canManagePatterns(){ return _canSeePatternHub(); }

// ── Registry shape — brands and categories, exactly as the TAC List ───────
const _TAC_BRANDS={groovy:'GROOVY',cultured:'Cultured Legacy',against:'Against All Odds'};
// form: 'NNN' → GB001;  'NNN-TB' → GCO001-T + GCO001-B (a co-ord set is two
// garments that share one number).
const _TAC_CATEGORIES=[
  {prefix:'GB', brand:'groovy',  label:'Blank Tees',              form:'NNN',    needsPattern:true},
  {prefix:'GS', brand:'groovy',  label:'Shirts',                  form:'NNN',    needsPattern:true},
  {prefix:'GP', brand:'groovy',  label:'Graphic / Printed Tees',  form:'NNN',    needsPattern:true},
  {prefix:'GTT',brand:'groovy',  label:'Tank Tops / Sando',       form:'NNN',    needsPattern:true},
  {prefix:'GJ', brand:'groovy',  label:'Jerseys',                 form:'NNN',    needsPattern:true},
  {prefix:'GBT',brand:'groovy',  label:'Baby Tees',               form:'NNN',    needsPattern:true},
  {prefix:'GH', brand:'groovy',  label:'Hoodies',                 form:'NNN',    needsPattern:true},
  {prefix:'GSH',brand:'groovy',  label:'Sweatshirts',             form:'NNN',    needsPattern:true},
  {prefix:'GHZ',brand:'groovy',  label:'Zipper Hoodies',          form:'NNN',    needsPattern:true},
  {prefix:'GO', brand:'groovy',  label:'Jackets & Outerwear',     form:'NNN',    needsPattern:true},
  {prefix:'GD', brand:'groovy',  label:'Denims',                  form:'NNN',    needsPattern:true},
  {prefix:'GC', brand:'groovy',  label:'Cargos',                  form:'NNN',    needsPattern:true},
  {prefix:'GST',brand:'groovy',  label:'Sweatpants & Trousers',   form:'NNN',    needsPattern:true},
  {prefix:'GSO',brand:'groovy',  label:'Shorts',                  form:'NNN',    needsPattern:true},
  {prefix:'GJO',brand:'groovy',  label:'Jorts',                   form:'NNN',    needsPattern:true},
  {prefix:'GCO',brand:'groovy',  label:'Co-Ord Sets (Top/Bottom)',form:'NNN-TB', needsPattern:true},
  {prefix:'GHW',brand:'groovy',  label:'Headwear',                form:'NNN',    needsPattern:false},
  {prefix:'CJ', brand:'cultured',label:'Racer Jerseys',           form:'NNN',    needsPattern:true},
  {prefix:'CB', brand:'cultured',label:'24/7 Blanks',             form:'NNN',    needsPattern:true},
  {prefix:'CP', brand:'cultured',label:'Graphic Tees',            form:'NNN',    needsPattern:true},
  {prefix:'CS', brand:'cultured',label:'Cuban Shirts',            form:'NNN',    needsPattern:true},
  {prefix:'CH', brand:'cultured',label:'Hoodies',                 form:'NNN',    needsPattern:true},
  {prefix:'CD', brand:'cultured',label:'Denim',                   form:'NNN',    needsPattern:true},
  {prefix:'CC', brand:'cultured',label:'Cargo',                   form:'NNN',    needsPattern:true},
  {prefix:'AP', brand:'against', label:'Graphic Tees',            form:'NNN',    needsPattern:true},
  {prefix:'ATT',brand:'against', label:'Tank Tops',               form:'NNN',    needsPattern:true},
  {prefix:'AD', brand:'against', label:'Denim',                   form:'NNN',    needsPattern:true},
  {prefix:'AST',brand:'against', label:'Sweatpants & Trousers',   form:'NNN',    needsPattern:true},
  {prefix:'ASO',brand:'against', label:'Shorts',                  form:'NNN',    needsPattern:true},
  {prefix:'AH', brand:'against', label:'Hoodies',                 form:'NNN',    needsPattern:true},
  {prefix:'AJ', brand:'against', label:'Jerseys',                 form:'NNN',    needsPattern:true}
];

// The TAC List, verbatim — [code, name]. 522 rows, 31 prefixes. Seeded into
// `articles` once by ptnSeedRegistry() (idempotent: only missing codes are
// written). After the seed the app is the registry; edit names in the app,
// not here — this constant only exists to bootstrap an empty Firestore.
const _TAC_ARTICLES=[
  ["GB001", "CORE Tees | ACID Washed Blank"],
  ["GB002", "Fade Washed Blank"],
  ["GB003", "Oil Fade Blank"],
  ["GB004", "CORE Tees | Electric Blue Raglan"],
  ["GB005", "CORE Tees | Black Raglan"],
  ["GB006", "CORE Tees | Mocha Brown Raglan"],
  ["GB007", "CORE Tees | Racing Green Raglan"],
  ["GB008", "CORE Tees | Essential Slate Blue"],
  ["GB009", "CORE Tees | Mocha Brown"],
  ["GB010", "CORE Tees | Stone Grey"],
  ["GB011", "CORE Tees | Maroon"],
  ["GB012", "CORE Tees | Essential White"],
  ["GB013", "CORE Tees | Essential Black"],
  ["GB014", "Deep Blue Washed Blank"],
  ["GB015", "Mocha Brown Washed Blank"],
  ["GB016", "Slate Grey Washed Blank"],
  ["GB017", "Shadow Grey Washed Blank"],
  ["GB018", "Rust Orange Washed Blank"],
  ["GB019", "Emerald Green Washed Blank"],
  ["GB020", "Crimson Washed Blank"],
  ["GB021", "Cream Washed Blank"],
  ["GB022", "ESSENTIAL 2.0 | RUST"],
  ["GB023", "ESSENTIAL 2.0 | SLATE GREY"],
  ["GB024", "ESSENTIAL 2.0 | DEEP BLUE"],
  ["GB025", "ESSENTIAL 2.0 | Faded Olive"],
  ["GB026", "ESSENTIAL 2.0 | WHITE"],
  ["GB027", "ESSENTIAL 2.0 | BLACK"],
  ["GS001", "White Cuban Shirt"],
  ["GS002", "Black Cuban Shirt"],
  ["GS003", "Grey Cuban Shirt"],
  ["GS004", "Geto | Jujutsu Kaisen Cuban Shirt"],
  ["GS005", "Star Denim Shirt"],
  ["GS006", "LA Customs Shirt"],
  ["GS007", "Pit Crew Shirt"],
  ["GS008", "Washed Angels Shirt"],
  ["GS009", "Fearless Box Fit Shirt"],
  ["GS010", "Classic Green Check Shirt"],
  ["GS011", "The Wanted Shirt"],
  ["GS012", "Solar Button Up Shirt"],
  ["GS013", "Deep Candy Button Up Shirt"],
  ["GS014", "Seeking Redemption Shirt"],
  ["GS015", "Boneless Acid Wash"],
  ["GP001", "REBIRTH"],
  ["GP002", "ZORO | One Piece"],
  ["GP003", "ROLLER TEE"],
  ["GP004", "Afterdark Piping Top"],
  ["GP005", "GROOVY Studios"],
  ["GP006", "5 Way Stitch Top"],
  ["GP007", "GRVY FLAMES"],
  ["GP008", "VENOM Jersey"],
  ["GP009", "96 Double Layer Jersey - Mocha"],
  ["GP010", "96 Double Layer Jersey - Electric Blue"],
  ["GP011", "96 Double Layer Jersey - Racing Green"],
  ["GP012", "96 Double Layer Jersey - Frost Blue"],
  ["GP013", "Allover GRVY - Frost Blue"],
  ["GP014", "GRVY Energy Washed"],
  ["GP015", "Metallica"],
  ["GP016", "The Creator Tee"],
  ["GP017", "Jujutsu Kaisen | GOJO"],
  ["GP018", "Superman Full Sleeves Tee"],
  ["GP019", "Young & Turnt Tee"],
  ["GP020", "GRVYBirds | Puff Printed"],
  ["GP021", "MONEY LOVES ENERGY"],
  ["GP022", "Athletic Department Raglan"],
  ["GP023", "IGRIS | Solo Leveling"],
  ["GP024", "GREEN HUMMINGBIRD"],
  ["GP025", "SOLO LEVELING"],
  ["GP026", "Heart Ashtray Tee"],
  ["GP027", "Project Rebirth"],
  ["GP028", "Naruto (Pain)"],
  ["GP029", "DICES GRVY"],
  ["GP030", "Tanjiro Full Sleeves"],
  ["GP031", "BE THE PROBLEM"],
  ["GP032", "Institute Of GRVY Black"],
  ["GP033", "GRVY Shark"],
  ["GP034", "Hunter X Hunter Tee"],
  ["GP035", "The Best Is Yet To Come 2.0"],
  ["GP036", "HARSH & CRUEL #7"],
  ["GP037", "Chainsaw Man | Denji"],
  ["GP038", "GRVY Community"],
  ["GP039", "Alpha Jersey - Mocha Brown"],
  ["GP040", "Institute Of GRVY LB/DB"],
  ["GP041", "Keep That Same Energy"],
  ["GP042", "Thunder Bite Tee | GRVYEffect"],
  ["GP043", "Naruto Uzumaki"],
  ["GP044", "Fate In Motion T-Shirt"],
  ["GP045", "Never Stopping Culture T-Shirt"],
  ["GP046", "Money Over Your Feelings Tee"],
  ["GP047", "Dept. of Visionaries"],
  ["GP048", "Hell Star"],
  ["GP049", "Sanctuary"],
  ["GP050", "Zero To One"],
  ["GP051", "Motorhead"],
  ["GP052", "We Need Art In Our Lives"],
  ["GP053", "The Final Dance"],
  ["GP054", "Never Give Up"],
  ["GP055", "LA Lakers"],
  ["GP056", "Chill Out"],
  ["GP057", "ASAP Rocky"],
  ["GP058", "Burning Butterfly"],
  ["GP059", "Legacy Is The Vision"],
  ["GP060", "Chicago Bulls Black"],
  ["GP061", "Chicago Bulls White"],
  ["GP062", "Dropout T-Shirt"],
  ["GP063", "Death Note"],
  ["GP064", "Demon Slayer Zenitsu"],
  ["GP065", "Initial Assembly"],
  ["GP066", "South Side"],
  ["GP067", "Racer Tee V2"],
  ["GP068", "96 Double Layer Jersey - Black"],
  ["GP069", "Cold Blooded (Green)"],
  ["GP070", "Cold Blooded (Black)"],
  ["GP071", "love hurts // cursed Tee"],
  ["GP072", "SMOKING ANGEL T-SHIRT"],
  ["GP073", "CYBER ASCEND T-SHIRT"],
  ["GP074", "SERENITY T-SHIRT"],
  ["GP075", "THANX 4 NOTHING"],
  ["GP076", "UNSHAKEN | Double Layer Jersey"],
  ["GP077", "SAKUNA | Jujutsu Kaisen"],
  ["GP078", "BLEACH | T-Shirt"],
  ["GP079", "TIGER FURY | Exclusive"],
  ["GP080", "BERSERK | Washed T-Shirt"],
  ["GP081", "Crossed Script | Fade Washed"],
  ["GP082", "Metro Boomin | Washed T-Shirt"],
  ["GP083", "Time Heals | Oil Fade Washed"],
  ["GP084", "YUTORI | exclusive"],
  ["GP085", "Ice Cold Behaviour"],
  ["GP086", "AKIRA T-SHIRT"],
  ["GP087", "COLD JERSEY"],
  ["GP088", "TYLER THE CREATOR | RUST"],
  ["GP089", "WALLS | Attack On Titan"],
  ["GP090", "EFFORTLESS TEE | BLACK"],
  ["GP091", "EFFORTLESS TEE | MUTED OLIVE"],
  ["GP092", "EFFORTLESS TEE | DEEP BLUE"],
  ["GP093", "EFFORTLESS TEE | SLATE GREY"],
  ["GP094", "EFFORTLESS TEE | RUST"],
  ["GP095", "EFFORTLESS TEE | MOCHA BROWN"],
  ["GP096", "EFFORTLESS TEE | FROST BLUE"],
  ["GP097", "EFFORTLESS TEE | RACING GREEN"],
  ["GP098", "RAW CITY POLO"],
  ["GP099", "CRASHED OUT TEE"],
  ["GP100", "WEST COAST CHOPPERS"],
  ["GP101", "SCORE POLO | DEEP BLUE"],
  ["GP102", "HIDDEN LEGACY | DEEP BLUE"],
  ["GP103", "BROWN TIGER T-SHIRT"],
  ["GTT001", "Legacy Club Sando"],
  ["GTT002", "Thunder Bite Sando | GRVYEffect"],
  ["GTT003", "WORLDWIDE Mint Green Sando"],
  ["GTT004", "Young & Turnt Sando"],
  ["GTT005", "BREAK FREE | Sando"],
  ["GTT006", "GLORY | Sando"],
  ["GTT007", "Berserk | Sando"],
  ["GTT008", "GRVY Athletics"],
  ["GTT009", "Black Clover | Sando"],
  ["GTT010", "Baki Hanma | Sando"],
  ["GTT011", "HEAVENLY | Sando"],
  ["GJ001", "Chrome Hearts Full Sleeves Jersey"],
  ["GJ002", "TIMELESS Basketball Jersey"],
  ["GJ003", "Allstars Basketball Jersey"],
  ["GJ004", "Outlaw Mesh Jersey"],
  ["GJ005", "Oreo Dunk Basketball Jersey"],
  ["GJ006", "88 Athletics Basketball Jersey"],
  ["GJ007", "The 69' Baller Jersey"],
  ["GJ008", "#25 Basketball Jersey"],
  ["GJ009", "Star Basketball Jersey"],
  ["GJ010", "Aim Jersey"],
  ["GJ011", "Frequency Jersey"],
  ["GBT001", "Basic Babytee - Black"],
  ["GBT002", "Basic Babytee - Electric Blue"],
  ["GBT003", "Basic Babytee - Mocha Brown"],
  ["GBT004", "Basic Babytee - Green"],
  ["GBT005", "Process Babytee"],
  ["GBT006", "Cherry Babytee"],
  ["GBT007", "Broken Souls Babytee"],
  ["GBT008", "Anime Girl Babytee"],
  ["GBT009", "LA Babytee"],
  ["GBT010", "Pulp Fiction Top"],
  ["GBT011", "GRVY Flowers Babytee"],
  ["GBT012", "Me & Bae Babytee"],
  ["GBT013", "Ditch Toxic People"],
  ["GBT014", "Main Character Babytee"],
  ["GBT015", "Top Tier Yapper Babytee"],
  ["GBT016", "Cosmic Cowgirl"],
  ["GBT017", "Y2K Star Babytee"],
  ["GBT018", "Batwoman Babytee"],
  ["GBT019", "GROOVY Girl | Babytee"],
  ["GH001", "Black Hoodie"],
  ["GH002", "Navy Blue hoodie"],
  ["GH003", "Hunter Green Hoodie"],
  ["GH004", "Light Grey Hoodie"],
  ["GH005", "Dark Grey Hoodie"],
  ["GH006", "Mocha Brown Hoodie"],
  ["GH007", "Cream Hoodie"],
  ["GH008", "Light Blue Hoodie"],
  ["GH009", "Camel Brown"],
  ["GH010", "Teal Blue"],
  ["GH011", "Dark Green"],
  ["GH012", "School Ruins Creativity"],
  ["GH013", "Blade Hoodie Foam"],
  ["GH014", "Dropout - Class of 25 Edition"],
  ["GH015", "White Beard - One Piece"],
  ["GH016", "Naruto Pain (Hoodie)"],
  ["GH017", "Never Stopping Culture"],
  ["GH018", "Hunter X Hunter Hoodie"],
  ["GH019", "Straw Hat Club"],
  ["GH020", "Eden Made"],
  ["GH021", "Sanctuary Hoodie"],
  ["GH022", "Make Your Own Luck"],
  ["GH023", "I Hate Maths"],
  ["GH024", "All Hustle No Luck"],
  ["GH025", "Chicago Black"],
  ["GH026", "(Washed) Black Hoodie"],
  ["GH027", "Pastel Pink Hoodie"],
  ["GH028", "Electric Blue Hoodie"],
  ["GH029", "The Initial Hoodie"],
  ["GH030", "The Combat Washed Hoodie"],
  ["GH031", "Fade Washed Hoodie"],
  ["GH032", "#55 Frost Hoodie"],
  ["GH033", "The Floral Hoodie"],
  ["GH034", "Eden Made 2.0"],
  ["GH035", "Own Lane Own Pace"],
  ["GH037", "5 Way Stitch Hoodie"],
  ["GH038", "Chicago White"],
  ["GH039", "The Cult Classic"],
  ["GH040", "LA Lakers Hoodie"],
  ["GH041", "Charcoal Heather Grey Hoodie"],
  ["GSH001", "Money Over Your Feelings (Sweatshirt)"],
  ["GSH002", "Berserk"],
  ["GSH003", "Hidden In Plain Sight | Black"],
  ["GSH004", "Hidden In Plain Sight | Arctyc White"],
  ["GHZ001", "One Piece Fire Fist Zipper"],
  ["GHZ002", "The Good Attitude Club 2.0"],
  ["GHZ003", "Emerald Green Washed Zipper"],
  ["GHZ004", "Shadow Grey Washed Zipper"],
  ["GHZ005", "Ethereal Blue Washed Zipper"],
  ["GHZ006", "(GOJO) Jujutsu Kaisen Zipper"],
  ["GHZ007", "Flying Predator Zipper Hoodie"],
  ["GHZ008", "Racing Green | Essential Zipper"],
  ["GHZ009", "Plum | Essential Zipper"],
  ["GHZ010", "Maple Brown | Essential Zipper"],
  ["GHZ011", "Granite | Essential Zipper"],
  ["GHZ012", "The Utility Top | Lilac"],
  ["GHZ013", "The Utility Top | Granite Grey"],
  ["GHZ014", "The Utility Top | Arctyc White"],
  ["GHZ015", "The Utility Top | Heather Green"],
  ["GHZ016", "The Heritage Top | Wine Red"],
  ["GHZ017", "The Heritage Top | Black"],
  ["GHZ018", "The Heritage Top | Frost Blue"],
  ["GHZ019", "The Utility Top | Black"],
  ["GHZ020", "Black | Essential Zipper"],
  ["GHZ021", "Dark Heather Grey | Essential Zipper"],
  ["GHZ022", "The Illusion Zipper"],
  ["GO001", "Racer-Jacket"],
  ["GO002", "The Coach Jacket"],
  ["GO003", "The Heritage Jacket"],
  ["GD001", "CORE Denim | Black"],
  ["GD002", "CORE Denim | Stone Grey"],
  ["GD003", "CORE Denim | Washed Black"],
  ["GD004", "CORE Denim | Washed Blue"],
  ["GD005", "Rage Denim"],
  ["GD006", "Carpenter Washed Black Denim"],
  ["GD007", "Star Denim"],
  ["GD008", "Jorts | Hard Washed Grey"],
  ["GD009", "Fade Washed Denim"],
  ["GD010", "Project Rebirth Denim"],
  ["GD011", "Cross Star Denim Blue"],
  ["GD012", "Carpenter Dark Grey Denim"],
  ["GD013", "Carpenter Light Grey Denim"],
  ["GD014", "CORE Denim | Dark Stone"],
  ["GD015", "CORE Denim | White Stone"],
  ["GC001", "Utility V1 | Black Cargos"],
  ["GC002", "Utility V1 | Mocha Brown Cargos"],
  ["GC003", "Utility V1 | Grey Cargos"],
  ["GC004", "Utility V1 | Cream Cargos"],
  ["GC005", "Black VII Cargo"],
  ["GC006", "Slate Grey VII Cargo"],
  ["GC007", "Mint Chalk VII Cargo"],
  ["GC008", "Military Green VII Cargo"],
  ["GC009", "Utility V1 | Mint Green Cargos"],
  ["GC010", "The Tactical Cargo | Camo"],
  ["GC011", "Deep Blue Cargo Trousers"],
  ["GC012", "Olive Green Cargo Trousers"],
  ["GC013", "VII Cargo | Mocha Brown"],
  ["GC014", "VII Cargo | Dark Grey"],
  ["GC015", "Reverse Washed Pants"],
  ["GC016", "Distressed Star Pants"],
  ["GC017", "Shadow Fade Trousers"],
  ["GST001", "Baggy Trousers | Black"],
  ["GST002", "Baggy Trousers | Cream"],
  ["GST003", "Baggy Trousers | Sage Green"],
  ["GST004", "Baggy Trousers | Mocha Brown"],
  ["GST005", "Baggy Trousers | Slate Blue"],
  ["GST006", "Piping Trouser | Black"],
  ["GST007", "Piping Trouser | Cream"],
  ["GST008", "Piping Trouser | Sage Green"],
  ["GST009", "Unity V1 - Slate Blue (winters)"],
  ["GST010", "Unity V1 - Mocha Brown"],
  ["GST011", "Unity V1 - Sandstone (winter)"],
  ["GST012", "Fade Washed Trouser"],
  ["GST013", "STAR Trouser | Black"],
  ["GST014", "Straight Fit Trouser | Slate Blue"],
  ["GST015", "Straight Fit Trouser | Cream"],
  ["GST016", "Slate Grey Essential Trouser (Winter)"],
  ["GST017", "Black Essential Trouser (winter)"],
  ["GST018", "Unity V1 - Slate Blue (Summers)"],
  ["GST019", "Unity V1 - Black (Winter)"],
  ["GST020", "The Heritage Pants | Wine Red"],
  ["GST021", "The Heritage Pants | Frost Blue"],
  ["GST022", "The Utility Sweats | Arctyc White"],
  ["GST023", "The Utility Sweats | Lilac"],
  ["GST024", "The Utility Sweats | Heather Green"],
  ["GST025", "The Utility Sweats | Granite Grey"],
  ["GST026", "Essential Trousers | Chalk"],
  ["GST027", "The Heritage Pants | Black"],
  ["GST028", "Heather Striped Trousers (Winters)"],
  ["GST029", "Navy Blue Trouser"],
  ["GST030", "The Utility Sweats | Black"],
  ["GST031", "Reverse Washed Cargo Pants"],
  ["GST032", "Baggy Trousers | Steel Grey"],
  ["GST033", "SCRIPT SWEATS | DEEP BLUE"],
  ["GST034", "SCRIPT SWEATS | GRAPHITE"],
  ["GST035", "SCRIPT SWEATS | DEEP GREEN"],
  ["GST036", "ON THE GO JOGGERS | PLUM"],
  ["GST037", "ON THE GO JOGGERS | DEEP GREEN"],
  ["GST038", "STRIPER CARGO | DEEP BLUE"],
  ["GST039", "STRIPER CARGO | PLUM"],
  ["GST040", "STRIPER CARGO | WINE RED"],
  ["GST041", "THE HERITAGE PANTS | KHAKI"],
  ["GST042", "THE WAVE PANT | Chocolate Brown"],
  ["GST043", "THE WAVE PANT | STEALTH"],
  ["GST044", "THE WAVE PANT | Heather Grey"],
  ["GST045", "Pintuck Baggy | Heather Grey"],
  ["GST046", "R1 Cargo | Stone Mauve"],
  ["GST047", "R1 Cargo | Military Green"],
  ["GST048", "R1 Cargo | Cool Grey"],
  ["GST049", "Sigilism Trouser | Graphite Grey"],
  ["GST050", "Daily Drift | Cool Grey"],
  ["GST051", "Daily Drift | Cream"],
  ["GST052", "Daily Drift | Black"],
  ["GST053", "SAVAGE Pants | Black"],
  ["GST054", "SAVAGE Pants | Heather"],
  ["GST055", "Daily Drift | Chocolate Brown"],
  ["GST056", "Pintuck Cargo | Military Green"],
  ["GST057", "ON THE GO JOGGERS | ASH GREY"],
  ["GST058", "JETLAG SWEATS | ASH GREY"],
  ["GST059", "JETLAG SWEATS | RED WINE"],
  ["GST060", "Live in Pants | Ash Grey"],
  ["GST061", "Live in Pants | Deep Green"],
  ["GST062", "Live in Pants | Heather Grey"],
  ["GST063", "Live in Pants | Military Green"],
  ["GST064", "Live in Pants | Chocolate Brown"],
  ["GST065", "Live in Pants | Black"],
  ["GST066", "Live in Pants | Red Wine"],
  ["GST067", "Live in Pants | Cool Grey"],
  ["GST068", "Live in Pants | Cream"],
  ["GST069", "Live in Pants | Mocha Brown"],
  ["GST070", "Live in Pants | Deep Blue"],
  ["GST071", "Live in Pants | Plum"],
  ["GST072", "Live in Pants | Graphite Grey"],
  ["GST073", "Live in Pants | Stone Mauve"],
  ["GST074", "The Heritage Pants | Black (Summer)"],
  ["GST075", "The Heritage Pants | Wine Red (Summer)"],
  ["GST076", "Tinted Denim | Baggy Trouser"],
  ["GSO001", "Aim Shorts | Ash Grey"],
  ["GSO002", "Aim Shorts | Deep Green"],
  ["GSO003", "Aim Shorts | Heather Grey"],
  ["GSO004", "Aim Shorts | Military Green"],
  ["GSO005", "Aim Shorts | Chocolate Brown"],
  ["GSO006", "Aim Shorts | Black"],
  ["GSO007", "Aim Shorts | Red Wine"],
  ["GSO008", "Aim Shorts | Cool Grey"],
  ["GSO009", "Aim Shorts | Cream"],
  ["GSO010", "Aim Shorts | Mocha Brown"],
  ["GSO011", "Aim Shorts | Deep Blue"],
  ["GSO012", "Aim Shorts | Plum"],
  ["GSO013", "Aim Shorts | Graphite Grey"],
  ["GSO014", "Aim Shorts | Stone Muave"],
  ["GSO015", "MF Shorts - Arctyc White"],
  ["GSO016", "Racer Shorts"],
  ["GJO001", "Jorts | White Stone"],
  ["GJO002", "Jorts | Dark Stone"],
  ["GHW001", "Classic Snapback Stone"],
  ["GHW002", "Super Suede College Blue"],
  ["GHW003", "Super Suede Deep Green"],
  ["GHW004", "Super Suede Desert Storm"],
  ["GHW005", "Super Suede Mocha Brown"],
  ["GHW006", "Distressed Denim Black"],
  ["GHW007", "THE ARTIST"],
  ["GHW008", "Classic Denim Iced"],
  ["GHW009", "UTOPIA"],
  ["GHW010", "Horizon Stars Mocha"],
  ["GHW011", "SMILEY DAY"],
  ["GHW012", "ZORO Exclusive"],
  ["GHW013", "Death Note Exclusive"],
  ["GHW014", "RIOT Exclusive"],
  ["GCO001-T", "The Utility Set | Lilac | Top"],
  ["GCO002-T", "The Utility Set | Light Grey | Top"],
  ["GCO003-T", "The Utility Set | Heather Grey | Top"],
  ["GCO004-T", "The Utility Set | Heather Green | Top"],
  ["GCO005-T", "The Heritage Set | Wine Red | Top"],
  ["GCO006-T", "The Heritage Set | Black | Top"],
  ["GCO007-T", "The Heritage Set | Slate Blue | Top"],
  ["GCO008-T", "Utility Zip Hoodie | Black | Top"],
  ["GCO001-B", "The Utility Set | Lilac | Bottom"],
  ["GCO002-B", "The Utility Set | Light Grey | Bottom"],
  ["GCO003-B", "The Utility Set | Heather Grey | Bottom"],
  ["GCO004-B", "The Utility Set | Heather Green | Bottom"],
  ["GCO005-B", "The Heritage Set | Wine Red | Bottom"],
  ["GCO006-B", "The Heritage Set | Black | Bottom"],
  ["GCO007-B", "The Heritage Set | Slate Blue | Bottom"],
  ["GCO008-B", "Utility Zip Hoodie | Black | Bottom"],
  ["CJ001", "Racing Blue Full Sleeves Jersey"],
  ["CJ002", "Racing Green Full Sleeves Jersey"],
  ["CJ003", "Racing Gold Full Sleeves Jersey"],
  ["CB001", "Charcoal Washed Blank"],
  ["CB002", "Ethereal Blue Washed Blank"],
  ["CB003", "Hunter Green Washed Blank"],
  ["CP001", "Champions (94)"],
  ["CP002", "Utopia"],
  ["CP003", "Jujutsu Kaisen (GETO)"],
  ["CP004", "Grow Back"],
  ["CP005", "Travis Scott (Raglan)"],
  ["CP006", "Blurred Acid"],
  ["CP007", "Attack On Titan (LEVI)"],
  ["CP008", "Fear Of God"],
  ["CP009", "Dreaming For Peace"],
  ["CP010", "Kanye West (DONDA)"],
  ["CP011", "Kendrick Lamar DAMN!"],
  ["CP012", "Destiny Club"],
  ["CP013", "Hunter X Hunter"],
  ["CP014", "Berserk"],
  ["CP015", "Wish Is Granted"],
  ["CP016", "Demon Slayer (Zenitsu)"],
  ["CP017", "Dragon Ball Z"],
  ["CP018", "The Weeknd"],
  ["CS001", "Cultured Legacy Posiedon"],
  ["CS002", "Cultured Legacy Made"],
  ["CH001", "CL Racing Hoodie"],
  ["CH002", "Life Is Such A Blessing"],
  ["CH003", "BLOODLINE Hoodie"],
  ["CH004", "Raw Seams Hoodie"],
  ["CH005", "Sorry Honey Hoodie"],
  ["CH006", "Cultured Art Dept."],
  ["CH007", "The Cultured Hoodie"],
  ["CH008", "Cultured URDU Hoodie"],
  ["CH009", "LightGrey Hoodie"],
  ["CH010", "Black Hoodie"],
  ["CH011", "Dark Grey Hoodie"],
  ["CH012", "Cream Hoodie"],
  ["CH013", "Camel Brown Hoodie"],
  ["CH014", "Wine Red Hoodie"],
  ["CH015", "Slate Grey Hoodie"],
  ["CH016", "Plum Plum Hoodie"],
  ["CD001", "12 Pockets Iced Cargo Jeans"],
  ["CD002", "CL Avante Garde Jeans"],
  ["CC001", "Assembly V2 Cargo"],
  ["CC002", "Liberty V1 Washed Cargo"],
  ["CC003", "Utility Black Cargo"],
  ["CC004", "Utility Moss Green Cargo"],
  ["AP001", "Imma Bloodystar"],
  ["AP002", "Fight Club"],
  ["AP003", "Nothing To Do (Raglan)"],
  ["AP004", "Fake News"],
  ["AP005", "Cowboy Bebop"],
  ["AP006", "Billionaire Nerds Club"],
  ["AP007", "In God We Trust"],
  ["AP008", "There's No Planet B"],
  ["AP009", "Berserk"],
  ["AP010", "Lucid Ascension"],
  ["AP011", "Red Fever (SICK)"],
  ["AP012", "Rick & Morty"],
  ["AP013", "Club Hellboys"],
  ["AP014", "God Will Never Fail You"],
  ["AP015", "Jester's Peace"],
  ["AP016", "Dark Uprising"],
  ["AP017", "Jujutsu Kaisen (GETO)"],
  ["AP018", "No Friends In The Industry"],
  ["AP019", "No Luck All God"],
  ["AP020", "Sacred Vision"],
  ["AP021", "No Attachments (White)"],
  ["AP022", "No Attachments (Black)"],
  ["AP023", "Heraldic Lion"],
  ["AP024", "Genesis Full-Sleeves"],
  ["ATT001", "Glock-Proof (Vest)"],
  ["ATT002", "Attack On Titan (Vest)"],
  ["ATT003", "Off Script (Vest)"],
  ["AD001", "Sidewalk Scar Denim"],
  ["AD002", "Drifted Denim"],
  ["AD003", "Grey Matter Jorts"],
  ["AD004", "Cross-Fire Jorts"],
  ["AD005", "Noir-Cross Pants"],
  ["AST001", "Core Black Trousers"],
  ["AST002", "Core Grey Trousers"],
  ["AST003", "Black Straight-Fit Trouser"],
  ["AST004", "Camel Brown Straight-Fit Trouser"],
  ["AST005", "Slate Grey Straight-Fit Trouser"],
  ["AST006", "Dark Grey Straight-Fit Trouser"],
  ["AST007", "Cream Straight-Fit Trouser"],
  ["AST008", "XTRA Rated Pants - Black"],
  ["AST009", "XTRA Rated Pants - Heather Grey"],
  ["AST010", "Core Trousers V2 - Plum"],
  ["AST011", "Core Trousers V2 - Chocolate Brown"],
  ["AST012", "Core Trousers V2 - Deep Green"],
  ["AST013", "Vex Trousers"],
  ["AST014", "Unbound Trousers"],
  ["AST015", "Outlaw Trousers"],
  ["AST016", "North Star Trousers"],
  ["AST017", "Nightfall Trousers"],
  ["ASO001", "Eternal Flame Baggy Shorts - Black"],
  ["ASO002", "Forsaken Baggy Shorts"],
  ["AH001", "Black Hoodie"],
  ["AH002", "Cream Hoodie"],
  ["AH003", "Slate Grey Hoodie"],
  ["AH004", "Dark Grey Hoodie"],
  ["AH005", "Charcoal Ash Hoodie"],
  ["AH006", "Navy Blue Hoodie"],
  ["AH007", "Camel Brown Hoodie"],
  ["AJ001", "Raw Instinct Jersey"],
  ["AJ002", "Presence 96 Jersey"],
  ["AJ003", "All-Star Varsity Jersey"],
  ["AJ004", "Velocity (07) Jersey"],
  ["AJ005", "Apex Predator Jersey"]
];

// ── Code grammar (pure — no DOM, no Firestore) ────────────────────────────
const _PTN_CODE_RE=/^([A-Z]{2,3})(\d{3,})(-[TB])?$/;
function _ptnParseCode(code){
  const m=_PTN_CODE_RE.exec(String(code==null?'':code).trim().toUpperCase());
  return m?{code:m[0],prefix:m[1],num:parseInt(m[2],10),suffix:m[3]||''}:null;
}
function _ptnFormatCode(prefix,num,suffix){ return prefix+String(num).padStart(3,'0')+(suffix||''); }
function _ptnCategory(prefix){ return _TAC_CATEGORIES.find(c=>c.prefix===prefix)||null; }
function _ptnCategoryOfCode(code){ const p=_ptnParseCode(code); return p?_ptnCategory(p.prefix):null; }
// Highest number the seed list carries per prefix — what nextNumber starts
// from, and the floor it can never drop below however the doc is edited.
function _ptnSeedMaxByPrefix(){
  const out={};
  _TAC_ARTICLES.forEach(([c])=>{const p=_ptnParseCode(c);if(p&&(out[p.prefix]||0)<p.num)out[p.prefix]=p.num;});
  return out;
}
// The codes one mint produces for a category from a number.
function _ptnCodesFor(cat,num){
  return cat.form==='NNN-TB'
    ?[_ptnFormatCode(cat.prefix,num,'-T'),_ptnFormatCode(cat.prefix,num,'-B')]
    :[_ptnFormatCode(cat.prefix,num,'')];
}
// logActivity is async in the app but a plain function in the test harness;
// never let a missing promise take an action down.
function _ptnLog(action,detail){try{const p=(typeof logActivity==='function')?logActivity(action,detail):null;if(p&&typeof p.catch==='function')p.catch(()=>{});}catch(e){}}
function _ptnEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

// ── State ─────────────────────────────────────────────────────────────────
let tacCategories=[];      // [{prefix,brand,label,form,needsPattern,nextNumber}]
let tacArticles=[];        // [{code,name,brand,category,needsPattern,patternId,active,source,…}]
let patternsLoaded=false;
let _ptnFailed={};         // collection name → true when its read failed
let _ptnLoadErr=null;      // message when EVERY read failed
let _ptnFilter={brand:'groovy',cat:'all',q:'',needs:'all',showRetired:false};
let _ptnSearchTimer=null;
let _ptnMintOpen=false;
let _ptnEditing=null;      // article code whose row is in edit mode
let _ptnBusy=false;

function _ptnLoadFailed(col){ return !!_ptnFailed[col]; }

// ── Loader — cannot reject ────────────────────────────────────────────────
async function loadPatternsData(){
  _ptnFailed={};_ptnLoadErr=null;
  const [cats,arts]=await Promise.allSettled([
    getDocs(collection(db,'tac_categories')),
    getDocs(collection(db,'articles'))
  ]);
  if(cats.status==='fulfilled'){
    tacCategories=cats.value.docs.map(d=>Object.assign({prefix:d.id},d.data()));
  }else{_ptnFailed.tac_categories=true;console.warn('[patterns] tac_categories load failed',cats.reason);}
  if(arts.status==='fulfilled'){
    tacArticles=arts.value.docs.map(d=>Object.assign({code:d.id},d.data()));
  }else{_ptnFailed.articles=true;console.warn('[patterns] articles load failed',arts.reason);}
  if(_ptnFailed.tac_categories&&_ptnFailed.articles){
    const r=arts.reason||cats.reason;
    _ptnLoadErr=(r&&(r.message||String(r)))||'read failed';
  }
  patternsLoaded=true;
}

// ── Derived views ─────────────────────────────────────────────────────────
function _ptnCategoriesFor(brand){
  // The in-app doc wins over the constant (label/needsPattern may be edited
  // there); the constant fills in for categories that have not been seeded.
  const byPrefix={};
  _TAC_CATEGORIES.forEach(c=>{byPrefix[c.prefix]=Object.assign({},c);});
  tacCategories.forEach(c=>{byPrefix[c.prefix]=Object.assign(byPrefix[c.prefix]||{},c);});
  return Object.values(byPrefix).filter(c=>brand==='all'||c.brand===brand)
    .sort((a,b)=>_TAC_CATEGORIES.findIndex(x=>x.prefix===a.prefix)-_TAC_CATEGORIES.findIndex(x=>x.prefix===b.prefix));
}
function _ptnFiltered(){
  const f=_ptnFilter,q=f.q.trim().toLowerCase();
  return tacArticles.filter(a=>{
    if(f.brand!=='all'&&a.brand!==f.brand)return false;
    if(f.cat!=='all'&&a.category!==f.cat)return false;
    if(f.needs==='yes'&&!a.needsPattern)return false;
    if(f.needs==='no'&&a.needsPattern)return false;
    if(!f.showRetired&&a.active===false)return false;
    if(q&&!(String(a.code).toLowerCase().includes(q)||String(a.name||'').toLowerCase().includes(q)))return false;
    return true;
  }).sort((a,b)=>{
    const pa=_ptnParseCode(a.code),pb=_ptnParseCode(b.code);
    if(pa&&pb&&pa.prefix!==pb.prefix)return _TAC_CATEGORIES.findIndex(x=>x.prefix===pa.prefix)-_TAC_CATEGORIES.findIndex(x=>x.prefix===pb.prefix);
    if(pa&&pb&&pa.num!==pb.num)return pa.num-pb.num;
    return String(a.code).localeCompare(String(b.code));
  });
}
function _ptnMissingSeed(){
  const have=new Set(tacArticles.map(a=>a.code));
  return _TAC_ARTICLES.filter(([c])=>!have.has(c));
}
// Preview of what the next mint in a category would produce.
function _ptnNextCodes(prefix){
  const cat=_ptnCategory(prefix);if(!cat)return[];
  const live=tacCategories.find(c=>c.prefix===prefix);
  const floor=(_ptnSeedMaxByPrefix()[prefix]||0)+1;
  const next=Math.max(floor,(live&&live.nextNumber)||0);
  return _ptnCodesFor(cat,next);
}

// ── Page ──────────────────────────────────────────────────────────────────
function renderPatternHub(){
  if(!_canSeePatternHub())return'<div class="empty">The Pattern Hub is in a test phase — Afnan, Ammar and Mustafa only.</div>';
  return`<div id="pattern-hub-root">${_ptnPageHTML()}</div>`;
}
function _ptnRepaint(){
  const r=document.getElementById('pattern-hub-root');
  if(r)r.innerHTML=_ptnPageHTML();
}
function _ptnPageHTML(){
  const head=`
  <div class="page-head" style="margin-bottom:10px">
    <div><h2 style="margin:0">Pattern Hub</h2><div style="color:var(--muted);font-size:12px;margin-top:2px">Article registry · the TAC list, live in the app · test phase</div></div>
  </div>`;
  if(_ptnLoadErr){
    return head+`<div class="board-load-error" id="ptn-load-error">
      <div style="font-weight:700;font-size:13.5px;margin-bottom:4px">Could not load the registry</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.5">tac_categories, articles: ${_ptnEsc(_ptnLoadErr)}</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:6px">If that says <em>missing or insufficient permissions</em>, the Firestore rules in the Firebase Console are older than this app — republish <code>firestore.rules</code>.</div>
      <button class="btn-sm" style="margin-top:10px" onclick="window.ptnRetryLoad()">Retry</button>
    </div>`;
  }
  const failed=Object.keys(_ptnFailed);
  const warn=failed.length?`<div class="board-load-warn" id="ptn-load-warn" style="margin-bottom:12px">Some of the registry did not load: <b>${_ptnEsc(failed.join(', '))}</b>. What is shown may be incomplete. <button class="btn-sm" onclick="window.ptnRetryLoad()">Retry</button></div>`:'';
  return head+warn+_ptnBrandTabsHTML()+_ptnSeedCardHTML()+_ptnStatsHTML()+_ptnToolbarHTML()+_ptnMintFormHTML()+_ptnTableHTML();
}
function _ptnBrandTabsHTML(){
  const tabs=[['groovy','GROOVY'],['cultured','Cultured Legacy'],['against','Against All Odds'],['all','All brands']];
  return`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${tabs.map(([k,l])=>`<button class="btn-sm${_ptnFilter.brand===k?' active':''}" style="${_ptnFilter.brand===k?'background:var(--dark);color:var(--on-dark);border-color:var(--dark)':''}" onclick="window.ptnSetFilter('brand','${k}')">${l}</button>`).join('')}</div>`;
}
function _ptnSeedCardHTML(){
  if(!_canManagePatterns())return'';
  if(_ptnLoadFailed('articles'))return'';   // cannot know what is missing — never offer a seed on a failed read
  const missing=_ptnMissingSeed();
  if(!missing.length)return'';
  const empty=tacArticles.length===0;
  return`<div class="card" id="ptn-seed-card" style="border-color:var(--accent-warning);margin-bottom:14px">
    <div class="card-title">${empty?'The registry is empty':'The registry is missing articles from the TAC list'}</div>
    <div style="font-size:12.5px;color:var(--muted);line-height:1.5;margin-bottom:10px">
      ${empty?`Seed it from the TAC List — <b>${_TAC_ARTICLES.length}</b> articles across <b>${_TAC_CATEGORIES.length}</b> categories and three brands, exactly as Ammar's document has them today.`
             :`<b>${missing.length}</b> code${missing.length===1?'':'s'} in the TAC List constant ${missing.length===1?'is':'are'} not in the registry yet. Seeding writes only those; nothing already here is touched.`}
    </div>
    <button class="btn-primary" ${_ptnBusy?'disabled':''} onclick="window.ptnSeedRegistry()">${empty?'Seed the registry':'Seed the '+missing.length+' missing'}</button>
  </div>`;
}
function _ptnStatsHTML(){
  const inBrand=tacArticles.filter(a=>(_ptnFilter.brand==='all'||a.brand===_ptnFilter.brand)&&a.active!==false);
  const needs=inBrand.filter(a=>a.needsPattern).length;
  const cats=_ptnCategoriesFor(_ptnFilter.brand).length;
  const tile=(n,l)=>`<div class="card" style="padding:12px 14px;flex:1;min-width:120px"><div style="font-size:22px;font-weight:700">${n}</div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">${l}</div></div>`;
  return`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">${tile(inBrand.length,'Articles')}${tile(needs,'Need a pattern')}${tile(inBrand.length-needs,'No pattern needed')}${tile(cats,'Categories')}</div>`;
}
function _ptnToolbarHTML(){
  const cats=_ptnCategoriesFor(_ptnFilter.brand);
  return`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
    <input type="search" id="ptn-search" placeholder="Search code or name…" value="${_ptnEsc(_ptnFilter.q)}" oninput="window.ptnSearchInput(this.value)" aria-label="Search articles" style="flex:1;min-width:180px;padding:9px 12px;border:1px solid var(--border);border-radius:9px;font-size:13px;font-family:inherit;background:var(--surface-2);color:var(--text)">
    <select onchange="window.ptnSetFilter('cat',this.value)" style="padding:8px 10px;border:1px solid var(--border);border-radius:9px;font-family:inherit;font-size:13px;background:var(--surface-2);color:var(--text)">
      <option value="all"${_ptnFilter.cat==='all'?' selected':''}>All categories</option>
      ${cats.map(c=>`<option value="${c.prefix}"${_ptnFilter.cat===c.prefix?' selected':''}>${c.prefix} · ${_ptnEsc(c.label)}</option>`).join('')}
    </select>
    <select onchange="window.ptnSetFilter('needs',this.value)" style="padding:8px 10px;border:1px solid var(--border);border-radius:9px;font-family:inherit;font-size:13px;background:var(--surface-2);color:var(--text)">
      <option value="all"${_ptnFilter.needs==='all'?' selected':''}>Pattern: any</option>
      <option value="yes"${_ptnFilter.needs==='yes'?' selected':''}>Needs a pattern</option>
      <option value="no"${_ptnFilter.needs==='no'?' selected':''}>No pattern needed</option>
    </select>
    <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px"><input type="checkbox" ${_ptnFilter.showRetired?'checked':''} onchange="window.ptnSetFilter('showRetired',this.checked?'1':'')">Show retired</label>
    ${_canManagePatterns()?`<button class="btn-primary" onclick="window.ptnToggleMint()">${_ptnMintOpen?'Close':'+ Mint a code'}</button>`:''}
  </div>`;
}
function _ptnMintFormHTML(){
  if(!_ptnMintOpen||!_canManagePatterns())return'';
  const cats=_ptnCategoriesFor(_ptnFilter.brand==='all'?'groovy':_ptnFilter.brand);
  const sel=document.getElementById('ptn-mint-cat');
  const cur=(sel&&sel.value)||(cats[0]&&cats[0].prefix)||'GP';
  const cat=_ptnCategory(cur)||cats[0];
  const next=_ptnNextCodes(cat.prefix);
  return`<div class="card" id="ptn-mint-card" style="margin-bottom:14px">
    <div class="card-title">Mint a new article code</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;align-items:end">
      <div class="field"><label>Category</label>
        <select id="ptn-mint-cat" onchange="window.ptnMintCatChanged()">${cats.map(c=>`<option value="${c.prefix}"${c.prefix===cat.prefix?' selected':''}>${c.prefix} · ${_ptnEsc(c.label)}</option>`).join('')}</select></div>
      <div class="field"><label>Article name</label><input id="ptn-mint-name" placeholder="e.g. Live in Pants | Olive" value="${_ptnEsc((document.getElementById('ptn-mint-name')||{}).value||'')}"></div>
      <div class="field"><label>Code <span style="color:var(--muted);font-weight:400">(leave blank for next)</span></label><input id="ptn-mint-code" placeholder="${_ptnEsc(cat.form==='NNN-TB'?_ptnFormatCode(cat.prefix,next.length?_ptnParseCode(next[0]).num:1,''):(next[0]||''))}" value="${_ptnEsc((document.getElementById('ptn-mint-code')||{}).value||'')}"></div>
      <div class="field"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="ptn-mint-needs" ${cat.needsPattern!==false?'checked':''}> Needs a pattern</label></div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px;line-height:1.5">
      Next in <b>${_ptnEsc(cat.prefix)}</b>: <b id="ptn-mint-next">${_ptnEsc(next.join(' + '))}</b>.
      ${cat.form==='NNN-TB'?'A co-ord set mints a Top and a Bottom from one number. ':''}
      Numbering never goes backwards on its own; type a specific unused code only to fill a gap deliberately.
    </div>
    <div style="margin-top:10px;display:flex;gap:8px"><button class="btn-primary" ${_ptnBusy?'disabled':''} onclick="window.ptnMint()">Mint</button><button class="btn-sm" onclick="window.ptnToggleMint()">Cancel</button></div>
  </div>`;
}
function _ptnTableHTML(){
  const rows=_ptnFiltered();
  if(!tacArticles.length&&_ptnLoadFailed('articles'))return`<div class="board-load-error" id="ptn-articles-failed">The <code>articles</code> collection did not load, so nothing can be listed. <button class="btn-sm" onclick="window.ptnRetryLoad()">Retry</button></div>`;
  if(!tacArticles.length)return`<div class="empty" id="ptn-empty">No articles in the registry yet.</div>`;
  if(!rows.length)return`<div class="empty">Nothing matches.</div>`;
  const can=_canManagePatterns();
  return`<div class="card" style="padding:0;overflow:auto"><table class="ptn-table" style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em"><th style="padding:10px 12px">Code</th><th style="padding:10px 12px">Name</th><th style="padding:10px 12px">Category</th><th style="padding:10px 12px">Pattern</th><th style="padding:10px 12px">Status</th>${can?'<th style="padding:10px 12px"></th>':''}</tr></thead>
    <tbody>${rows.map(a=>_ptnEditing===a.code?_ptnEditRowHTML(a):_ptnRowHTML(a,can)).join('')}</tbody></table>
    <div style="padding:8px 12px;font-size:11px;color:var(--muted);border-top:1px solid var(--border)">${rows.length} of ${tacArticles.length} articles</div></div>`;
}
function _ptnRowHTML(a,can){
  const cat=_ptnCategory(a.category);
  const retired=a.active===false;
  return`<tr class="ptn-row" data-code="${_ptnEsc(a.code)}" style="border-top:1px solid var(--border);${retired?'opacity:.55':''}">
    <td style="padding:9px 12px;font-weight:700;white-space:nowrap">${_ptnEsc(a.code)}</td>
    <td style="padding:9px 12px" class="ptn-name">${_ptnEsc(a.name||'')}${a.source==='minted'?' <span class="badge" style="font-size:9.5px">minted</span>':''}</td>
    <td style="padding:9px 12px;color:var(--muted);white-space:nowrap">${_ptnEsc(cat?cat.label:a.category||'')}</td>
    <td style="padding:9px 12px;white-space:nowrap">${a.needsPattern?(a.patternId?'<span class="badge">assigned</span>':'<span style="color:var(--muted)">unassigned</span>'):'<span style="color:var(--muted)">not needed</span>'}</td>
    <td style="padding:9px 12px;white-space:nowrap">${retired?'Retired':'Active'}</td>
    ${can?`<td style="padding:9px 12px;text-align:right"><button class="btn-sm" onclick="window.ptnEditArticle('${_ptnEsc(a.code)}')">Edit</button></td>`:''}
  </tr>`;
}
function _ptnEditRowHTML(a){
  return`<tr class="ptn-row ptn-row-edit" data-code="${_ptnEsc(a.code)}" style="border-top:1px solid var(--border);background:var(--surface-2)">
    <td style="padding:9px 12px;font-weight:700;white-space:nowrap">${_ptnEsc(a.code)}</td>
    <td style="padding:9px 12px" colspan="2"><input id="ptn-edit-name" value="${_ptnEsc(a.name||'')}" style="width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:7px;font-family:inherit;font-size:13px;background:var(--surface);color:var(--text)"></td>
    <td style="padding:9px 12px;white-space:nowrap"><label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" id="ptn-edit-needs" ${a.needsPattern?'checked':''}>Needs a pattern</label></td>
    <td style="padding:9px 12px;white-space:nowrap"><label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" id="ptn-edit-active" ${a.active!==false?'checked':''}>Active</label></td>
    <td style="padding:9px 12px;text-align:right;white-space:nowrap"><button class="btn-primary" ${_ptnBusy?'disabled':''} onclick="window.ptnSaveArticle('${_ptnEsc(a.code)}')">Save</button> <button class="btn-sm" onclick="window.ptnCancelEdit()">Cancel</button></td>
  </tr>`;
}

// ── Handlers ──────────────────────────────────────────────────────────────
window.ptnRetryLoad=function(){
  const m=document.getElementById('main-content');
  if(m)m.innerHTML=gvSkeleton(6);
  loadPatternsData().then(()=>{if(currentPage==='pattern-hub'&&m)m.innerHTML=renderPatternHub();});
};
window.ptnSearchInput=function(v){
  clearTimeout(_ptnSearchTimer);
  _ptnSearchTimer=setTimeout(()=>{
    _ptnFilter.q=String(v||'');_ptnRepaint();
    const i=document.getElementById('ptn-search');
    if(i){i.focus();const n=i.value.length;try{i.setSelectionRange(n,n);}catch(e){}}
  },180);
};
window.ptnSetFilter=function(key,val){
  if(key==='brand'){_ptnFilter.brand=val;_ptnFilter.cat='all';}
  else if(key==='cat')_ptnFilter.cat=val;
  else if(key==='needs')_ptnFilter.needs=val;
  else if(key==='showRetired')_ptnFilter.showRetired=!!val;
  else return;
  _ptnRepaint();
};
window.ptnToggleMint=function(){_ptnMintOpen=!_ptnMintOpen;_ptnRepaint();};
window.ptnMintCatChanged=function(){
  const sel=document.getElementById('ptn-mint-cat');const cat=sel&&_ptnCategory(sel.value);
  const nx=document.getElementById('ptn-mint-next');if(nx&&cat)nx.textContent=_ptnNextCodes(cat.prefix).join(' + ');
  const nd=document.getElementById('ptn-mint-needs');if(nd&&cat)nd.checked=cat.needsPattern!==false;
  const cd=document.getElementById('ptn-mint-code');if(cd&&cat){const n=_ptnNextCodes(cat.prefix);cd.placeholder=cat.form==='NNN-TB'?_ptnFormatCode(cat.prefix,n.length?_ptnParseCode(n[0]).num:1,''):(n[0]||'');}
};
window.ptnEditArticle=function(code){if(!_canManagePatterns())return;_ptnEditing=code;_ptnRepaint();};
window.ptnCancelEdit=function(){_ptnEditing=null;_ptnRepaint();};

// Seed: idempotent. Writes every category doc with merge (label/form/
// needsPattern refreshed, nextNumber never lowered) and ONLY the articles
// that are not there yet. 522 rows → two batches of ≤400.
window.ptnSeedRegistry=async function(){
  if(!_canManagePatterns()||_ptnBusy)return;
  if(_ptnLoadFailed('articles')){showToast('The articles collection did not load — cannot tell what is missing. Retry the load first.',true);return;}
  const missing=_ptnMissingSeed();
  if(!missing.length){showToast('Nothing to seed — the registry already has every TAC code.');return;}
  _ptnBusy=true;_ptnRepaint();
  const now=new Date().toISOString();
  const by=(typeof session!=='undefined'&&session&&session.u)||'';
  const seedMax=_ptnSeedMaxByPrefix();
  const live={};tacCategories.forEach(c=>{live[c.prefix]=c;});
  try{
    let batch=writeBatch(db),n=0,written=0;
    const flush=async()=>{if(n){await batch.commit();batch=writeBatch(db);n=0;}};
    for(const c of _TAC_CATEGORIES){
      const cur=live[c.prefix]||{};
      const nextNumber=Math.max((seedMax[c.prefix]||0)+1,cur.nextNumber||0);
      batch.set(doc(db,'tac_categories',c.prefix),{prefix:c.prefix,brand:c.brand,label:c.label,form:c.form,needsPattern:c.needsPattern,nextNumber,updatedAt:now,updatedBy:by},{merge:true});
      if(++n>=400)await flush();
    }
    for(const [code,name] of missing){
      const cat=_ptnCategoryOfCode(code);
      batch.set(doc(db,'articles',code),{code,name,brand:cat.brand,category:cat.prefix,needsPattern:cat.needsPattern!==false,patternId:null,active:true,source:'tac_seed',createdAt:now,createdBy:by,updatedAt:now,updatedBy:by});
      written++;
      if(++n>=400)await flush();
    }
    await flush();
    showToast('Seeded '+written+' article'+(written===1?'':'s')+' from the TAC list.');
    _ptnLog('Registry Seeded',written+' articles from the TAC list');
  }catch(e){
    console.error('[patterns] seed failed',e);
    showToast('Seed failed: '+(e.message||e),true);
    _ptnBusy=false;_ptnRepaint();return;
  }
  _ptnBusy=false;
  await loadPatternsData();_ptnRepaint();
};

// Mint: one transaction — read the category counter, refuse an existing
// code, write the article(s), move the counter forward. Never backwards.
window.ptnMint=async function(){
  if(!_canManagePatterns()||_ptnBusy)return;
  const prefix=(document.getElementById('ptn-mint-cat')||{}).value||'';
  const name=String((document.getElementById('ptn-mint-name')||{}).value||'').trim();
  const explicit=String((document.getElementById('ptn-mint-code')||{}).value||'').trim().toUpperCase();
  const needs=!!((document.getElementById('ptn-mint-needs')||{}).checked);
  const cat=_ptnCategory(prefix);
  if(!cat){showToast('Pick a category.',true);return;}
  if(!name){showToast('Give the article a name.',true);return;}
  let explicitNum=null;
  if(explicit){
    const p=_ptnParseCode(explicit);
    if(!p||p.prefix!==cat.prefix){showToast('That code does not belong to '+cat.prefix+'. Use the form '+cat.prefix+'### (e.g. '+_ptnFormatCode(cat.prefix,1,'')+').',true);return;}
    if(p.suffix){showToast('For a co-ord set give just the number — the Top and Bottom are minted together.',true);return;}
    explicitNum=p.num;
  }
  _ptnBusy=true;_ptnRepaint();
  const now=new Date().toISOString();
  const by=(typeof session!=='undefined'&&session&&session.u)||'';
  const floor=(_ptnSeedMaxByPrefix()[cat.prefix]||0)+1;
  let minted=[];
  try{
    await runTransaction(db,async tx=>{
      const cref=doc(db,'tac_categories',cat.prefix);
      const cs=await tx.get(cref);
      const cd=(cs&&typeof cs.exists==='function'&&cs.exists())?cs.data():{};
      const counter=Math.max(floor,cd.nextNumber||0);
      const num=explicitNum!=null?explicitNum:counter;
      const codes=_ptnCodesFor(cat,num);
      for(const code of codes){
        const s=await tx.get(doc(db,'articles',code));
        if(s&&typeof s.exists==='function'&&s.exists())throw new Error(code+' already exists');
      }
      codes.forEach(code=>{
        tx.set(doc(db,'articles',code),{code,name,brand:cat.brand,category:cat.prefix,needsPattern:needs,patternId:null,active:true,source:'minted',createdAt:now,createdBy:by,updatedAt:now,updatedBy:by});
      });
      tx.set(cref,{prefix:cat.prefix,brand:cat.brand,label:cd.label||cat.label,form:cat.form,needsPattern:cd.needsPattern!=null?cd.needsPattern:cat.needsPattern,nextNumber:Math.max(counter,num+1),updatedAt:now,updatedBy:by},{merge:true});
      minted=codes;
    });
  }catch(e){
    console.error('[patterns] mint failed',e);
    showToast('Could not mint: '+(e.message||e),true);
    _ptnBusy=false;_ptnRepaint();return;
  }
  minted.forEach(code=>{tacArticles.push({code,name,brand:cat.brand,category:cat.prefix,needsPattern:needs,patternId:null,active:true,source:'minted',createdAt:now,createdBy:by});});
  const lc=tacCategories.find(c=>c.prefix===cat.prefix);
  const newNext=Math.max(floor,(lc&&lc.nextNumber)||0,_ptnParseCode(minted[0]).num+1);
  if(lc)lc.nextNumber=newNext;else tacCategories.push(Object.assign({},cat,{nextNumber:newNext}));
  showToast('Minted '+minted.join(' + ')+' — '+name);
  _ptnLog('Article Code Minted',minted.join(' + ')+' — '+name);
  const ni=document.getElementById('ptn-mint-name');if(ni)ni.value='';
  const ci=document.getElementById('ptn-mint-code');if(ci)ci.value='';
  _ptnBusy=false;_ptnFilter.q='';_ptnRepaint();
};

window.ptnSaveArticle=async function(code){
  if(!_canManagePatterns()||_ptnBusy)return;
  const a=tacArticles.find(x=>x.code===code);if(!a)return;
  const name=String((document.getElementById('ptn-edit-name')||{}).value||'').trim();
  const needs=!!((document.getElementById('ptn-edit-needs')||{}).checked);
  const active=!!((document.getElementById('ptn-edit-active')||{}).checked);
  if(!name){showToast('A name is required.',true);return;}
  _ptnBusy=true;
  const now=new Date().toISOString();
  const by=(typeof session!=='undefined'&&session&&session.u)||'';
  try{
    await updateDoc(doc(db,'articles',code),{name,needsPattern:needs,active,updatedAt:now,updatedBy:by});
    Object.assign(a,{name,needsPattern:needs,active,updatedAt:now,updatedBy:by});
    showToast('Saved '+code+'.');
    _ptnLog('Article Edited',code+' — '+name+(active?'':' (retired)'));
  }catch(e){
    console.error('[patterns] save failed',e);showToast('Save failed: '+(e.message||e),true);
  }
  _ptnBusy=false;_ptnEditing=null;_ptnRepaint();
};
