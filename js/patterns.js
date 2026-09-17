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

   M1: SHOPIFY LIVENESS + RECONCILE + EXPORT. shopify-catalog-sync.js now
   writes shopify_articles/{CODE} (one small doc per article code, daily 9am
   PKT) and lists products it could not key on shopify_sync_meta/
   articles_rollup. The reconcile page (`pattern-reconcile`) puts the registry
   and that rollup side by side in buckets — unknown codes, name mismatches,
   products with no usable SKU (title-matched to a candidate), codes not on
   Shopify, two codes on one product — and the only writes it makes are to
   `articles`. NOTHING here writes to Shopify; the "Fix in Shopify" list
   tells a human what to type there. The TAC list exports to Excel and PDF
   so Ammar keeps a document — as an OUTPUT of the registry, never an input.
   Every pattern-* page routes through ptnRenderPage(), so js/shared.js
   never needs another line for this module (the mkt-* rule).

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

// ── Audience ──────────────────────────────────────────────────────────────
// THREE lists, because three different powers. Admins build the registry,
// the blocks and the measurements. Cutting (Uzaib) reads everything and
// acknowledges a revision notice — nothing else. Arfat holds the manager
// role and is in none of them, like every Sept 2026 grant.
//   _PATTERN_ADMIN_USERS  ⇄ firestore.rules isPatternAdmin()  (+ the
//                            PATTERN_ADMIN_EMAILS in the sync function)
//   _PATTERN_CUTTING_USERS ⇄ firestore.rules isCutting()
// tests/patterns.test.js asserts each pair names the same people.
const _PATTERN_ADMIN_USERS=['afnan','ammar','mustafa'];
const _PATTERN_CUTTING_USERS=['uzaib'];
const _PATTERN_HUB_USERS=_PATTERN_ADMIN_USERS.concat(_PATTERN_CUTTING_USERS);
function _ptnIs(list){ return !!(typeof session!=='undefined'&&session&&list.indexOf(session.u)>-1); }
function _canSeePatternHub(){ return _ptnIs(_PATTERN_HUB_USERS); }
function _canManagePatterns(){ return _ptnIs(_PATTERN_ADMIN_USERS); }
function _isPatternCutting(){ return _ptnIs(_PATTERN_CUTTING_USERS); }
function _canAckPatternNotice(){ return _canManagePatterns()||_isPatternCutting(); }

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
  if(!_canSeePatternHub())return'<div class="empty">The Pattern Hub is in a test phase — Afnan, Ammar, Mustafa and Uzaib.</div>';
  // Cutting does not manage the registry; the hub for them IS the updates
  // list. One redirect rather than a second, emptier version of this page.
  if(!_canManagePatterns())return renderPatternNotices();
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
  const sync=_ptnSyncLineHTML();
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
  return head+warn+sync+_ptnBrandTabsHTML()+_ptnSeedCardHTML()+_ptnStatsHTML()+_ptnToolbarHTML()+_ptnMintFormHTML()+_ptnTableHTML();
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
    <button class="btn-sm" onclick="window.showPage('pattern-blocks')">Patterns${typeof _ptnQueueBadge==='function'?_ptnQueueBadge():''}</button>
    <button class="btn-sm" onclick="window.showPage('pattern-notices')">Pattern updates${typeof _ptnNoticeBadge==='function'?_ptnNoticeBadge():''}</button>
    <button class="btn-sm" onclick="window.showPage('pattern-reconcile')">Reconcile with Shopify${_ptnRecBadge()}</button>
    <button class="btn-sm" onclick="window.ptnExportTac('xlsx')" title="The TAC list as a spreadsheet">Export Excel</button>
    <button class="btn-sm" onclick="window.ptnExportTac('pdf')" title="The TAC list as a PDF">Export PDF</button>
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
    <thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em"><th style="padding:10px 12px">Code</th><th style="padding:10px 12px">Name</th><th style="padding:10px 12px">Category</th><th style="padding:10px 12px">Pattern</th><th style="padding:10px 12px">Status</th><th style="padding:10px 12px">Shopify</th>${can?'<th style="padding:10px 12px"></th>':''}</tr></thead>
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
    <td style="padding:9px 12px;white-space:nowrap">${_ptnPatternCellHTML(a)}</td>
    <td style="padding:9px 12px;white-space:nowrap">${retired?'Retired':'Active'}</td>
    <td style="padding:9px 12px;white-space:nowrap" class="ptn-shop">${_ptnShopifyCellHTML(a)}</td>
    ${can?`<td style="padding:9px 12px;text-align:right"><button class="btn-sm" onclick="window.ptnEditArticle('${_ptnEsc(a.code)}')">Edit</button></td>`:''}
  </tr>`;
}
function _ptnPatternCellHTML(a){
  if(!a.needsPattern)return'<span style="color:var(--muted)">not needed</span>';
  const p=a.patternId&&typeof _ptnLiveBlock==='function'?_ptnLiveBlock(a.patternId):null;
  if(p)return`<button class="btn-sm ptn-pat-link" onclick="window.ptnOpenBlock('${_ptnEsc(p.id)}')">${_ptnEsc(p.code)}</button>`;
  if(a.patternId)return'<span style="color:var(--muted)" title="Points at a block that is retired or not loaded">unassigned</span>';
  return'<span style="color:var(--muted)">unassigned</span>';
}
function _ptnEditRowHTML(a){
  return`<tr class="ptn-row ptn-row-edit" data-code="${_ptnEsc(a.code)}" style="border-top:1px solid var(--border);background:var(--surface-2)">
    <td style="padding:9px 12px;font-weight:700;white-space:nowrap">${_ptnEsc(a.code)}</td>
    <td style="padding:9px 12px" colspan="2"><input id="ptn-edit-name" value="${_ptnEsc(a.name||'')}" style="width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:7px;font-family:inherit;font-size:13px;background:var(--surface);color:var(--text)"></td>
    <td style="padding:9px 12px;white-space:nowrap"><label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" id="ptn-edit-needs" ${a.needsPattern?'checked':''}>Needs a pattern</label></td>
    <td style="padding:9px 12px;white-space:nowrap"><label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" id="ptn-edit-active" ${a.active!==false?'checked':''}>Active</label></td>
    <td style="padding:9px 12px;white-space:nowrap" class="ptn-shop">${_ptnShopifyCellHTML(a)}</td>
    <td style="padding:9px 12px;text-align:right;white-space:nowrap"><button class="btn-primary" ${_ptnBusy?'disabled':''} onclick="window.ptnSaveArticle('${_ptnEsc(a.code)}')">Save</button> <button class="btn-sm" onclick="window.ptnCancelEdit()">Cancel</button></td>
  </tr>`;
}

// ── Handlers ──────────────────────────────────────────────────────────────
window.ptnRetryLoad=function(){
  const m=document.getElementById('main-content');
  if(m)m.innerHTML=gvSkeleton(6);
  patternsLoaded=false;_ptnShopifyLoaded=false;_ptnBlocksLoaded=false;if(typeof _ptnPomsLoaded!=='undefined')_ptnPomsLoaded=false;
  if(typeof _ptnNoticesLoaded!=='undefined'){_ptnNoticesLoaded=false;patternRevisions={};}
  ptnRenderPage(currentPage&&String(currentPage).startsWith('pattern-')?currentPage:'pattern-hub');
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
  const link=_ptnPendingLink;
  const fields={source:'minted'};
  if(link)fields.shopifyLink=_ptnLinkFields(link);
  let minted=[];
  try{
    minted=await _ptnCreateArticlesTx(cat,{name,explicitNum,needs,fields});
  }catch(e){
    console.error('[patterns] mint failed',e);
    showToast('Could not mint: '+(e.message||e),true);
    _ptnBusy=false;_ptnRepaint();return;
  }
  _ptnPendingLink=null;
  showToast('Minted '+minted.join(' + ')+' — '+name+(link?' · now set the SKU on Shopify to '+minted[0]+'-<size>':''));
  _ptnLog('Article Code Minted',minted.join(' + ')+' — '+name);
  const ni=document.getElementById('ptn-mint-name');if(ni)ni.value='';
  const ci=document.getElementById('ptn-mint-code');if(ci)ci.value='';
  _ptnBusy=false;_ptnFilter.q='';_ptnRepaint();
};

// The ONE place an article is created. Reads the category counter, refuses
// any code that already exists, writes the article(s), moves the counter
// forward — never backwards, never below the seed's maximum. Used by the
// mint form (codes from the counter or an explicit number) and by the
// reconcile page (an exact code Shopify already uses). Returns the codes.
async function _ptnCreateArticlesTx(cat,o){
  const now=new Date().toISOString();
  const by=(typeof session!=='undefined'&&session&&session.u)||'';
  const floor=(_ptnSeedMaxByPrefix()[cat.prefix]||0)+1;
  const needs=o.needs!=null?!!o.needs:cat.needsPattern!==false;
  let out=[];
  await runTransaction(db,async tx=>{
    const cref=doc(db,'tac_categories',cat.prefix);
    const cs=await tx.get(cref);
    const cd=(cs&&typeof cs.exists==='function'&&cs.exists())?cs.data():{};
    const counter=Math.max(floor,cd.nextNumber||0);
    const num=o.explicitNum!=null?o.explicitNum:counter;
    const codes=o.codes||_ptnCodesFor(cat,num);
    for(const code of codes){
      const s=await tx.get(doc(db,'articles',code));
      if(s&&typeof s.exists==='function'&&s.exists())throw new Error(code+' already exists');
    }
    codes.forEach(code=>{
      tx.set(doc(db,'articles',code),Object.assign({code,name:o.name,brand:cat.brand,category:cat.prefix,needsPattern:needs,patternId:null,active:true,source:'minted',createdAt:now,createdBy:by,updatedAt:now,updatedBy:by},o.fields||{}));
    });
    tx.set(cref,{prefix:cat.prefix,brand:cat.brand,label:cd.label||cat.label,form:cat.form,needsPattern:cd.needsPattern!=null?cd.needsPattern:cat.needsPattern,nextNumber:Math.max(counter,num+1),updatedAt:now,updatedBy:by},{merge:true});
    out=codes;
  });
  out.forEach(code=>{tacArticles.push(Object.assign({code,name:o.name,brand:cat.brand,category:cat.prefix,needsPattern:needs,patternId:null,active:true,source:'minted',createdAt:now,createdBy:by},o.fields||{}));});
  const lc=tacCategories.find(c=>c.prefix===cat.prefix);
  const newNext=Math.max(floor,(lc&&lc.nextNumber)||0,_ptnParseCode(out[0]).num+1);
  if(lc)lc.nextNumber=newNext;else tacCategories.push(Object.assign({},cat,{nextNumber:newNext}));
  return out;
}

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


// ═══════════════════════════════════════════════════════════════════════════
// M1 — Shopify liveness · reconcile · TAC export · router
// ═══════════════════════════════════════════════════════════════════════════

let shopifyArticles=null;      // code → shopify_articles doc; null until loaded
let _ptnRollupMeta=null;       // shopify_sync_meta/articles_rollup
let _ptnShopifyLoaded=false,_ptnShopifyFailed=null;
let _ptnPendingLink=null;      // a Shopify product carried into the next mint
let _ptnRecTab='unknown';

// Cannot reject. ~336 small docs + one meta doc, once per session.
async function loadPatternsShopify(){
  _ptnShopifyFailed=null;
  const [arts,meta]=await Promise.allSettled([
    getDocs(collection(db,'shopify_articles')),
    getDoc(doc(db,'shopify_sync_meta','articles_rollup'))
  ]);
  if(arts.status==='fulfilled'){
    shopifyArticles={};
    arts.value.docs.forEach(d=>{shopifyArticles[d.id]=Object.assign({code:d.id},d.data());});
  }else{_ptnShopifyFailed=(arts.reason&&(arts.reason.message||String(arts.reason)))||'read failed';console.warn('[patterns] shopify_articles load failed',arts.reason);}
  if(meta.status==='fulfilled'){
    const s=meta.value;const ex=s&&typeof s.exists==='function'?s.exists():false;
    _ptnRollupMeta=ex?s.data():null;
  }else{console.warn('[patterns] articles_rollup load failed',meta.reason);}
  _ptnShopifyLoaded=true;
}

// ── Title matching — ONE normaliser for the seed, the reconcile page and
//    the future auto-link, so the three can never disagree ───────────────
function _ptnNorm(s){
  return String(s==null?'':s).toLowerCase().replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,' ').replace(/\bt shirt\b|\btshirt\b/g,'tee')
    .trim().replace(/\s+/g,' ');
}
function _ptnBigrams(s){const o=new Set();for(let i=0;i<s.length-1;i++)o.add(s.slice(i,i+2));return o;}
// Dice coefficient on character bigrams of the normalised names: 1 = same,
// 0 = nothing in common. Small, explainable, no library.
function _ptnSim(a,b){
  a=_ptnNorm(a);b=_ptnNorm(b);
  if(!a||!b)return 0;if(a===b)return 1;
  const A=_ptnBigrams(a),B=_ptnBigrams(b);let inter=0;A.forEach(x=>{if(B.has(x))inter++;});
  return (A.size+B.size)?(2*inter)/(A.size+B.size):0;
}
const _PTN_SIM_SAME=0.72;     // below this a code's two names are "substantially different"
const _PTN_SIM_LIKELY=0.6;    // a title-only candidate needs at least this
function _ptnTitleMatch(title){
  const n=_ptnNorm(title);if(!n)return null;
  const exact=tacArticles.find(a=>a.active!==false&&_ptnNorm(a.name)===n);
  if(exact)return{code:exact.code,name:exact.name,kind:'exact',sim:1};
  let best=null;
  tacArticles.forEach(a=>{
    if(a.active===false)return;
    const s=_ptnSim(a.name,title);
    if(s>=_PTN_SIM_LIKELY&&(!best||s>best.sim))best={code:a.code,name:a.name,kind:'likely',sim:s};
  });
  return best;
}
function _ptnLinkFields(l){
  const now=new Date().toISOString();
  const by=(typeof session!=='undefined'&&session&&session.u)||'';
  return{productId:String(l.productId||''),title:String(l.title||''),sku:String(l.sku||''),reason:String(l.reason||''),linkedBy:by,linkedAt:now};
}

// ── The buckets ───────────────────────────────────────────────────────────
function _ptnReconcile(){
  const out={unknownCodes:[],nameMismatch:[],notOnShopify:[],unkeyed:[],multiCode:[],fixShopify:[],ok:0,ready:!!shopifyArticles};
  if(!shopifyArticles)return out;
  const reg={};tacArticles.forEach(a=>{reg[a.code]=a;});
  Object.values(shopifyArticles).forEach(sa=>{
    const a=reg[sa.code];
    const title=(sa.product_titles||[])[0]||'';
    if(!a){out.unknownCodes.push({code:sa.code,title,status:sa.status||'',cat:_ptnCategoryOfCode(sa.code),imageUrl:sa.image_url||''});return;}
    if(a.active!==false&&!a.nameReviewedAt&&title&&_ptnNorm(title)!==_ptnNorm(a.name)){
      out.nameMismatch.push({code:a.code,tac:a.name||'',shopify:title,sim:_ptnSim(a.name,title),status:sa.status||''});
    }else out.ok++;
  });
  tacArticles.forEach(a=>{
    if(a.active===false||a.brand!=='groovy')return;   // only GROOVY is on this store
    if(!shopifyArticles[a.code])out.notOnShopify.push({code:a.code,name:a.name||'',linked:a.shopifyLink||null});
  });
  const linked={};tacArticles.forEach(a=>{if(a.shopifyLink&&a.shopifyLink.productId)linked[String(a.shopifyLink.productId)]=a;});
  ((_ptnRollupMeta&&_ptnRollupMeta.unkeyed_products)||[]).forEach(pd=>{
    const pid=String(pd.product_id||'');
    const la=linked[pid]||null;
    out.unkeyed.push({productId:pid,title:pd.title||'',status:pd.status||'',reason:pd.reason||'no_sku',sku:pd.sku_sample||'',imageUrl:pd.image_url||'',linked:la?la.code:null,match:la?null:_ptnTitleMatch(pd.title)});
    if(la)out.fixShopify.push({productId:pid,title:pd.title||'',code:la.code,reason:pd.reason||'no_sku'});
  });
  out.multiCode=((_ptnRollupMeta&&_ptnRollupMeta.multi_code_products)||[]).map(pd=>({productId:String(pd.product_id||''),title:pd.title||'',codes:pd.codes||[]}));
  out.nameMismatch.sort((x,y)=>x.sim-y.sim);
  return out;
}
function _ptnRecBadge(){
  if(!shopifyArticles)return'';
  const r=_ptnReconcile();
  const n=r.unknownCodes.length+r.nameMismatch.length+r.unkeyed.filter(u=>!u.linked).length;
  return n?` <span class="badge" style="font-size:10px">${n}</span>`:'';
}

// ── Hub: the sync line and the Shopify column ─────────────────────────────
function _ptnSyncDate(){
  const v=_ptnRollupMeta&&_ptnRollupMeta.last_success_at;
  if(!v)return null;
  try{return typeof v.toDate==='function'?v.toDate():new Date(v);}catch(e){return null;}
}
function _ptnSyncLineHTML(){
  if(!_ptnShopifyLoaded)return'';
  if(_ptnShopifyFailed)return`<div class="board-load-warn" id="ptn-shop-warn" style="margin-bottom:12px">The Shopify rollup (<code>shopify_articles</code>) did not load: ${_ptnEsc(_ptnShopifyFailed)}. Liveness is unknown; the registry still works. <button class="btn-sm" onclick="window.ptnRetryLoad()">Retry</button></div>`;
  const n=shopifyArticles?Object.keys(shopifyArticles).length:0;
  if(!n)return`<div style="font-size:12px;color:var(--muted);margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap" id="ptn-shop-none"><span>No Shopify rollup yet — the catalog sync writes it daily at 9am PKT.</span>${_ptnSyncNowBtnHTML()}</div>`;
  const d=_ptnSyncDate();
  const ageH=d?Math.round((Date.now()-d.getTime())/36e5):null;
  const stale=ageH!=null&&ageH>30;
  return`<div style="font-size:12px;color:var(--muted);margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap" id="ptn-shop-line"><span>Shopify copy: <b>${n}</b> article codes${d?` · synced ${_ptnEsc(d.toLocaleString('en-GB'))}`:''}${ageH!=null?` (${ageH}h ago${stale?' — <b style="color:var(--accent-warning)">older than a day</b>':''})`:''} · read-only.</span>${_ptnSyncNowBtnHTML()}</div>`;
}
function _ptnShopifyCellHTML(a){
  if(!_ptnShopifyLoaded)return'';
  if(_ptnShopifyFailed)return'<span style="color:var(--muted)">?</span>';
  const sa=shopifyArticles&&shopifyArticles[a.code];
  if(sa){
    const c={active:'var(--green)',draft:'var(--amber)',archived:'var(--muted)'}[sa.status]||'var(--muted)';
    return`<span style="color:${c};font-weight:600">${_ptnEsc(sa.status||'?')}</span>${sa.size_axis&&sa.size_axis!=='none'?` <span style="color:var(--muted);font-size:11px">${_ptnEsc(sa.size_axis)}</span>`:''}`;
  }
  if(a.shopifyLink&&a.shopifyLink.productId)return'<span style="color:var(--accent-warning);font-weight:600" title="Linked to a product whose SKU is not set">linked · fix SKU</span>';
  return a.brand==='groovy'?'<span style="color:var(--muted)">—</span>':'';
}

// ── Reconcile page ────────────────────────────────────────────────────────
function renderPatternReconcile(){
  if(!_canSeePatternHub())return'<div class="empty">The Pattern Hub is in a test phase — Afnan, Ammar, Mustafa and Uzaib.</div>';
  return`<div id="pattern-rec-root">${_ptnReconcileHTML()}</div>`;
}
function _ptnRecRepaint(){const r=document.getElementById('pattern-rec-root');if(r)r.innerHTML=_ptnReconcileHTML();}
function _ptnReconcileHTML(){
  const head=`<button class="back-btn" onclick="window.showPage('pattern-hub')">← Pattern Hub</button>
  <div class="page-head" style="margin-bottom:10px"><div><h2 style="margin:0">Reconcile with Shopify</h2><div style="color:var(--muted);font-size:12px;margin-top:2px">The registry beside the store's SKUs. Fixes here write to the registry only — Shopify is never written from this app.</div></div></div>`;
  if(_ptnLoadErr)return head+`<div class="board-load-error">The registry did not load: ${_ptnEsc(_ptnLoadErr)} <button class="btn-sm" onclick="window.ptnRetryLoad()">Retry</button></div>`;
  if(_ptnShopifyFailed)return head+`<div class="board-load-error" id="ptn-rec-failed"><div style="font-weight:700;margin-bottom:4px">The Shopify rollup did not load</div><div style="font-size:12px;color:var(--muted)">shopify_articles: ${_ptnEsc(_ptnShopifyFailed)}. If that says <em>missing or insufficient permissions</em>, republish <code>firestore.rules</code>.</div><button class="btn-sm" style="margin-top:10px" onclick="window.ptnRetryLoad()">Retry</button></div>`;
  if(!shopifyArticles||!Object.keys(shopifyArticles).length)return head+`<div class="empty" id="ptn-rec-none">No Shopify rollup yet. The catalog sync writes <code>shopify_articles</code> daily at 9am PKT — or run it now. ${_ptnSyncNowBtnHTML()} <button class="btn-sm" onclick="window.ptnRetryLoad()">Retry</button></div>`;
  const r=_ptnReconcile();
  const open=r.unkeyed.filter(u=>!u.linked);
  const tabs=[
    ['unknown','Codes not in registry',r.unknownCodes.length],
    ['names','Name mismatches',r.nameMismatch.length],
    ['unkeyed','No usable SKU',open.length],
    ['absent','Not on Shopify',r.notOnShopify.length],
    ['multi','Two codes, one product',r.multiCode.length],
    ['fix','Fix in Shopify',r.fixShopify.length]
  ];
  if(!tabs.some(t=>t[0]===_ptnRecTab))_ptnRecTab='unknown';
  const tabHTML=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${tabs.map(([k,l,n])=>`<button class="btn-sm" style="${_ptnRecTab===k?'background:var(--dark);color:var(--on-dark);border-color:var(--dark)':''}" onclick="window.ptnRecTab('${k}')">${l} <b>${n}</b></button>`).join('')}</div>`;
  const summary=`<div style="font-size:12px;color:var(--muted);margin-bottom:12px">${r.ok} code${r.ok===1?'':'s'} agree on both sides · ${_ptnSyncLineHTML().replace(/<div[^>]*>|<\/div>/g,'')}</div>`;
  const can=_canManagePatterns();
  let body='';
  if(_ptnRecTab==='unknown'){
    body=r.unknownCodes.length?`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase"><th style="padding:10px 12px">Code</th><th style="padding:10px 12px">Shopify title</th><th style="padding:10px 12px">Status</th><th style="padding:10px 12px">Category</th><th></th></tr></thead><tbody>${r.unknownCodes.map(u=>`<tr class="ptn-rec-unknown" data-code="${_ptnEsc(u.code)}" style="border-top:1px solid var(--border)"><td style="padding:9px 12px;font-weight:700">${_ptnEsc(u.code)}</td><td style="padding:9px 12px">${_ptnEsc(u.title)}</td><td style="padding:9px 12px">${_ptnEsc(u.status)}</td><td style="padding:9px 12px;color:var(--muted)">${u.cat?_ptnEsc(u.cat.label):'<span style="color:var(--accent-urgent)">unknown prefix</span>'}</td><td style="padding:9px 12px;text-align:right">${can&&u.cat?`<button class="btn-sm" ${_ptnBusy?'disabled':''} onclick="window.ptnAddFromShopify('${_ptnEsc(u.code)}')">Add to registry</button>`:''}</td></tr>`).join('')}</tbody></table></div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">A code Shopify uses that the TAC list never recorded. Adding it takes the code exactly as Shopify has it, the product title as the name, and moves that category's counter past it.</div>`
    :'<div class="empty">Every code on Shopify is in the registry.</div>';
  }else if(_ptnRecTab==='names'){
    body=r.nameMismatch.length?`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase"><th style="padding:10px 12px">Code</th><th style="padding:10px 12px">TAC name</th><th style="padding:10px 12px">Shopify title</th><th style="padding:10px 12px">Match</th><th></th></tr></thead><tbody>${r.nameMismatch.map(u=>`<tr class="ptn-rec-name" data-code="${_ptnEsc(u.code)}" style="border-top:1px solid var(--border)"><td style="padding:9px 12px;font-weight:700">${_ptnEsc(u.code)}</td><td style="padding:9px 12px">${_ptnEsc(u.tac)}</td><td style="padding:9px 12px">${_ptnEsc(u.shopify)}</td><td style="padding:9px 12px;white-space:nowrap;color:${u.sim<_PTN_SIM_SAME?'var(--accent-urgent)':'var(--muted)'}">${Math.round(u.sim*100)}%${u.sim<_PTN_SIM_SAME?' · check':''}</td><td style="padding:9px 12px;text-align:right;white-space:nowrap">${can?`<button class="btn-sm" ${_ptnBusy?'disabled':''} onclick="window.ptnUseShopifyName('${_ptnEsc(u.code)}')">Use Shopify name</button> <button class="btn-sm" ${_ptnBusy?'disabled':''} onclick="window.ptnKeepName('${_ptnEsc(u.code)}')">Keep TAC name</button>`:''}</td></tr>`).join('')}</tbody></table></div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">Same code, different name. A low match usually means a renamed colourway (Heather Grey → Arctyc White) or two codes typed the wrong way round (the Jorts). "Keep" records that you looked.</div>`
    :'<div class="empty">Every shared code has the same name on both sides.</div>';
  }else if(_ptnRecTab==='unkeyed'){
    body=open.length?`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase"><th style="padding:10px 12px">Shopify product</th><th style="padding:10px 12px">Why</th><th style="padding:10px 12px">Candidate in registry</th><th></th></tr></thead><tbody>${open.map(u=>`<tr class="ptn-rec-unkeyed" data-pid="${_ptnEsc(u.productId)}" style="border-top:1px solid var(--border)"><td style="padding:9px 12px"><b>${_ptnEsc(u.title)}</b><div style="font-size:11px;color:var(--muted)">${_ptnEsc(u.status)}</div></td><td style="padding:9px 12px;white-space:nowrap">${u.reason==='foreign_sku'?'SKU <code>'+_ptnEsc(u.sku)+'</code> is not a code':'no SKU'}</td><td style="padding:9px 12px">${u.match?`<b>${_ptnEsc(u.match.code)}</b> ${_ptnEsc(u.match.name)} <span style="color:var(--muted);font-size:11px">${u.match.kind==='exact'?'exact title match':Math.round(u.match.sim*100)+'% similar'}</span>`:'<span style="color:var(--muted)">none — needs a new code</span>'}</td><td style="padding:9px 12px;text-align:right;white-space:nowrap">${can?(u.match?`<button class="btn-sm" ${_ptnBusy?'disabled':''} onclick="window.ptnLinkProduct('${_ptnEsc(u.productId)}','${_ptnEsc(u.match.code)}')">Link to ${_ptnEsc(u.match.code)}</button> `:'')+`<button class="btn-sm" onclick="window.ptnMintForProduct('${_ptnEsc(u.productId)}')">Mint a code</button>`:''}</td></tr>`).join('')}</tbody></table></div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">Products the store cannot key to an article. Linking records which code the product IS; the SKU itself has to be typed into Shopify by hand — see "Fix in Shopify" once linked.</div>`
    :'<div class="empty">Every Shopify product carries a usable SKU.</div>';
  }else if(_ptnRecTab==='absent'){
    body=r.notOnShopify.length?`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase"><th style="padding:10px 12px">Code</th><th style="padding:10px 12px">TAC name</th><th style="padding:10px 12px"></th><th></th></tr></thead><tbody>${r.notOnShopify.map(u=>`<tr class="ptn-rec-absent" data-code="${_ptnEsc(u.code)}" style="border-top:1px solid var(--border)"><td style="padding:9px 12px;font-weight:700">${_ptnEsc(u.code)}</td><td style="padding:9px 12px">${_ptnEsc(u.name)}</td><td style="padding:9px 12px;color:var(--muted);font-size:12px">${u.linked?'linked to a product with no SKU':''}</td><td style="padding:9px 12px;text-align:right">${can&&!u.linked?`<button class="btn-sm" ${_ptnBusy?'disabled':''} onclick="window.ptnRetireQuick('${_ptnEsc(u.code)}')">Retire</button>`:''}</td></tr>`).join('')}</tbody></table></div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">GROOVY codes with no Shopify product at any status (active, draft or archived). Usually discontinued before the store existed, or a product whose SKU is empty — check "No usable SKU" first. Retiring hides a code; it never deletes one.</div>`
    :'<div class="empty">Every GROOVY code in the registry is on Shopify.</div>';
  }else if(_ptnRecTab==='multi'){
    body=r.multiCode.length?`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase"><th style="padding:10px 12px">Shopify product</th><th style="padding:10px 12px">Codes</th></tr></thead><tbody>${r.multiCode.map(u=>`<tr style="border-top:1px solid var(--border)"><td style="padding:9px 12px">${_ptnEsc(u.title)}</td><td style="padding:9px 12px;font-weight:700">${u.codes.map(_ptnEsc).join(' · ')}</td></tr>`).join('')}</tbody></table></div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">Two colourways merged into one Shopify product (Chicago Bulls: GP060 black, GP061 white). Legitimate — recorded so nobody assumes one product is one article.</div>`
    :'<div class="empty">No product carries more than one code.</div>';
  }else if(_ptnRecTab==='fix'){
    body=r.fixShopify.length?`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase"><th style="padding:10px 12px">Shopify product</th><th style="padding:10px 12px">Set each variant's SKU to</th></tr></thead><tbody>${r.fixShopify.map(u=>`<tr class="ptn-rec-fix" style="border-top:1px solid var(--border)"><td style="padding:9px 12px">${_ptnEsc(u.title)}</td><td style="padding:9px 12px;font-weight:700"><code>${_ptnEsc(u.code)}-&lt;size&gt;</code> <span style="color:var(--muted);font-weight:400;font-size:12px">(e.g. ${_ptnEsc(u.code)}-M or ${_ptnEsc(u.code)}-30)</span></td></tr>`).join('')}</tbody></table></div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">Linked here, still wrong on Shopify. Once the SKU is typed in there, the next catalog sync keys the product and this row disappears on its own.</div>`
    :'<div class="empty">Nothing waiting on a Shopify edit.</div>';
  }
  return head+summary+tabHTML+body;
}

// ── Reconcile actions — every one writes to `articles`, none to Shopify ──
window.ptnRecTab=function(k){_ptnRecTab=k;_ptnRecRepaint();};
window.ptnAddFromShopify=async function(code){
  if(!_canManagePatterns()||_ptnBusy)return;
  const sa=shopifyArticles&&shopifyArticles[code];if(!sa){showToast('Not in the Shopify rollup.',true);return;}
  const p=_ptnParseCode(code);const cat=p&&_ptnCategory(p.prefix);
  if(!cat){showToast('No TAC category for prefix '+(p?p.prefix:code)+' — add the category first.',true);return;}
  const name=(sa.product_titles||[])[0]||code;
  _ptnBusy=true;_ptnRecRepaint();
  try{
    await _ptnCreateArticlesTx(cat,{name,explicitNum:p.num,codes:[code],fields:{source:'assigned_from_reconcile',shopifyLink:_ptnLinkFields({productId:(sa.product_ids||[])[0]||'',title:name,sku:code,reason:'code_on_shopify'})}});
    showToast('Added '+code+' — '+name);
    _ptnLog('Article Added From Shopify',code+' — '+name);
  }catch(e){console.error('[patterns] add-from-shopify failed',e);showToast('Could not add: '+(e.message||e),true);}
  _ptnBusy=false;_ptnRecRepaint();
};
async function _ptnUpdateArticle(code,patch,toastMsg,logAction,logDetail){
  if(!_canManagePatterns()||_ptnBusy)return false;
  const a=tacArticles.find(x=>x.code===code);if(!a){showToast(code+' is not in the registry.',true);return false;}
  const now=new Date().toISOString();
  const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBusy=true;
  try{
    const data=Object.assign({},patch,{updatedAt:now,updatedBy:by});
    await updateDoc(doc(db,'articles',code),data);
    Object.assign(a,data);
    if(toastMsg)showToast(toastMsg);
    if(logAction)_ptnLog(logAction,logDetail||code);
    _ptnBusy=false;return true;
  }catch(e){console.error('[patterns] update failed',e);showToast('Save failed: '+(e.message||e),true);_ptnBusy=false;return false;}
}
window.ptnUseShopifyName=async function(code){
  const sa=shopifyArticles&&shopifyArticles[code];const title=sa&&(sa.product_titles||[])[0];
  if(!title){showToast('No Shopify title for '+code,true);return;}
  const a=tacArticles.find(x=>x.code===code);
  await _ptnUpdateArticle(code,{name:title,nameReviewedAt:new Date().toISOString()},'Renamed '+code+' to the Shopify title.','Article Renamed',code+': "'+((a&&a.name)||'')+'" → "'+title+'"');
  _ptnRecRepaint();
};
window.ptnKeepName=async function(code){
  await _ptnUpdateArticle(code,{nameReviewedAt:new Date().toISOString()},'Kept the TAC name for '+code+'.');
  _ptnRecRepaint();
};
window.ptnRetireQuick=async function(code){
  if(typeof confirm==='function'&&!confirm('Retire '+code+'? It stays in the registry, hidden by default. Nothing is deleted.'))return;
  await _ptnUpdateArticle(code,{active:false},'Retired '+code+'.','Article Retired',code);
  _ptnRecRepaint();
};
window.ptnLinkProduct=async function(productId,code){
  const meta=(_ptnRollupMeta&&_ptnRollupMeta.unkeyed_products)||[];
  const pd=meta.find(x=>String(x.product_id)===String(productId));
  if(!pd){showToast('That product is no longer in the rollup.',true);return;}
  const ok=await _ptnUpdateArticle(code,{shopifyLink:_ptnLinkFields({productId,title:pd.title||'',sku:pd.sku_sample||'',reason:pd.reason||'no_sku'})},
    'Linked "'+(pd.title||'')+'" to '+code+'. Now set its SKUs on Shopify to '+code+'-<size>.','Article Linked To Shopify Product',code+' ← '+(pd.title||productId));
  if(ok)_ptnRecTab='fix';
  _ptnRecRepaint();
};
window.ptnMintForProduct=function(productId){
  const meta=(_ptnRollupMeta&&_ptnRollupMeta.unkeyed_products)||[];
  const pd=meta.find(x=>String(x.product_id)===String(productId));
  if(!pd){showToast('That product is no longer in the rollup.',true);return;}
  _ptnPendingLink={productId:String(productId),title:pd.title||'',sku:pd.sku_sample||'',reason:pd.reason||'no_sku'};
  _ptnMintOpen=true;_ptnFilter.brand='groovy';
  window.showPage('pattern-hub');
  const ni=document.getElementById('ptn-mint-name');if(ni)ni.value=pd.title||'';
  showToast('Pick the category, then Mint — the new code will be linked to "'+(pd.title||'')+'".');
};

// ── TAC export — the document is an OUTPUT of the registry now ────────────
function _ptnExportRows(){
  const order=c=>{const p=_ptnParseCode(c);return[p?_TAC_CATEGORIES.findIndex(x=>x.prefix===p.prefix):999,p?p.num:0,c];};
  const rows=tacArticles.slice().sort((a,b)=>{const x=order(a.code),y=order(b.code);return x[0]-y[0]||x[1]-y[1]||(x[2]<y[2]?-1:x[2]>y[2]?1:0);});
  return rows.map(a=>{
    const cat=_ptnCategory(a.category);
    const sa=shopifyArticles&&shopifyArticles[a.code];
    return[_TAC_BRANDS[a.brand]||a.brand||'',cat?cat.prefix+' · '+cat.label:(a.category||''),a.code,a.name||'',a.needsPattern?'Yes':'No',a.active===false?'Retired':'Active',shopifyArticles?(sa?(sa.status||''):'—'):''];
  });
}
const _PTN_EXPORT_HEADER=['Brand','Category','Article Code','Article Name','Needs pattern','Status','Shopify'];
window.ptnExportTac=function(kind){
  if(!tacArticles.length){showToast('Nothing to export — the registry is empty.',true);return;}
  const date=new Date().toISOString().slice(0,10);
  const rows=_ptnExportRows();
  if(kind==='xlsx'){
    if(typeof XLSX==='undefined'){showToast('The spreadsheet library did not load — refresh and try again.',true);return;}
    const ws=XLSX.utils.aoa_to_sheet([_PTN_EXPORT_HEADER].concat(rows));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'TAC List');
    XLSX.writeFile(wb,'TAC-List-'+date+'.xlsx');
  }else{
    if(typeof window.printDocument!=='function'){showToast('The print engine did not load — refresh and try again.',true);return;}
    let body='',lastCat='';
    rows.forEach(r=>{if(r[1]!==lastCat){body+=(body?'\n':'')+r[0]+' — '+r[1]+'\n';lastCat=r[1];}body+=r[2]+'   '+r[3]+(r[4]==='No'?'   (no pattern)':'')+(r[5]==='Retired'?'   [retired]':'')+'\n';});
    window.printDocument({type:'generic',filename:'TAC-List-'+date+'.pdf',data:{documentNumber:'TAC-'+date,title:'TAC List / Article Code Document',subtitle:'Exported from Groovy Operations · '+date+' · '+rows.length+' articles',bodyHtml:body,urduLevel:'none'}});
  }
  showToast('Exported the TAC list ('+rows.length+' articles) as '+(kind==='xlsx'?'Excel':'PDF')+'.');
  _ptnLog('TAC List Exported',kind+' · '+rows.length+' articles');
};

// ── Run the catalog sync now ──────────────────────────────────────────────
// The scheduled function refuses direct HTTP (Netlify answers 403 — seen
// from Afnan's browser), so a separate BACKGROUND function runs the same
// handler behind a verified ID token. It answers 202 at once and says
// nothing else, so the outcome is read by polling the sync's own meta
// document until last_run_at moves past the moment we clicked.
const _PTN_SYNC_ENDPOINT='/.netlify/functions/pattern-sync-now-background';
let _ptnSyncRun=null;   // {startedAt, status:'starting'|'running'|'done'|'failed'|'timeout', msg}
function _ptnSyncNowBtnHTML(){
  if(!_canManagePatterns())return'';
  const r=_ptnSyncRun;
  if(r&&(r.status==='starting'||r.status==='running'))return`<span id="ptn-sync-status" style="font-size:12px">Sync running… ${_ptnEsc(r.msg||'')}</span>`;
  return`<button class="btn-sm" id="ptn-sync-now" onclick="window.ptnRunSyncNow()">Run sync now</button>${r&&r.msg?`<span id="ptn-sync-status" style="font-size:12px;color:${r.status==='done'?'var(--green)':'var(--accent-urgent)'}">${_ptnEsc(r.msg)}</span>`:''}`;
}
function _ptnRepaintCurrent(){
  if(currentPage==='pattern-reconcile')_ptnRecRepaint();else if(currentPage==='pattern-hub')_ptnRepaint();
}
async function _ptnReadSyncMeta(){
  try{const s=await getDoc(doc(db,'shopify_sync_meta','catalog_sync'));const ex=s&&typeof s.exists==='function'?s.exists():false;return ex?s.data():null;}catch(e){return null;}
}
function _ptnMetaMs(v){try{if(!v)return 0;if(typeof v.toDate==='function')return v.toDate().getTime();const d=new Date(v);return isNaN(d)?0:d.getTime();}catch(e){return 0;}}
let _ptnSyncPollMs=5000;   // a test shortens it
window.ptnRunSyncNow=async function(){
  if(!_canManagePatterns())return;
  if(_ptnSyncRun&&(_ptnSyncRun.status==='starting'||_ptnSyncRun.status==='running'))return;
  if(typeof auth==='undefined'||!auth||!auth.currentUser){showToast('You are signed out — sign in again.',true);return;}
  const startedAt=Date.now();
  _ptnSyncRun={startedAt,status:'starting',msg:'asking Netlify…'};_ptnRepaintCurrent();
  // What the sync's record said BEFORE we asked, so a stale success can
  // never be mistaken for this run.
  const before=await _ptnReadSyncMeta();
  const seenAt=(before?_ptnMetaMs(before.last_run_at):0);
  let idToken;
  try{idToken=await auth.currentUser.getIdToken();}catch(e){_ptnSyncRun={status:'failed',msg:'Could not get your sign-in token.'};_ptnRepaintCurrent();return;}
  try{
    const res=await fetch(_PTN_SYNC_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken})});
    if(!(res.status===202||res.ok)){const d=await res.json().catch(()=>({}));throw new Error(d.error||('Netlify answered '+res.status));}
  }catch(e){_ptnSyncRun={status:'failed',msg:'Could not start the sync: '+(e.message||e)};_ptnRepaintCurrent();showToast(_ptnSyncRun.msg,true);return;}
  _ptnSyncRun={startedAt,status:'running',msg:'started — usually 10–60 s'};_ptnRepaintCurrent();
  _ptnLog('Catalog Sync Run',_ptnFmtNow());
  // Poll the sync's own record until last_run_at moves past what we saw.
  // A run that never lands in 4 minutes is reported, never left spinning.
  const deadline=startedAt+240000;
  const tick=async()=>{
    const meta=await _ptnReadSyncMeta();
    const ranAt=meta?_ptnMetaMs(meta.last_run_at):0;
    const landed=meta&&ranAt>seenAt&&(meta.last_status==='success'||meta.last_status==='error');
    if(landed){
      if(meta.last_status==='success'){
        _ptnSyncRun={status:'done',msg:'Done — '+(meta.articles_written!=null?meta.articles_written+' article codes, '+(meta.unkeyed_products||0)+' without a usable SKU, '+(meta.multi_code_products||0)+' with two codes':'synced')};
        _ptnShopifyLoaded=false;await loadPatternsShopify();
      }else _ptnSyncRun={status:'failed',msg:'The sync failed: '+(meta.last_error||'see the Netlify function log')};
      _ptnRepaintCurrent();return;
    }
    if(Date.now()>deadline){_ptnSyncRun={status:'timeout',msg:'No result after 4 minutes — check the Netlify function log, then Retry.'};_ptnRepaintCurrent();return;}
    setTimeout(tick,_ptnSyncPollMs);
  };
  setTimeout(tick,_ptnSyncPollMs);
};
function _ptnFmtNow(){try{return new Date().toLocaleString('en-GB');}catch(e){return '';}}

// ── Router — every pattern-* page comes through here ──────────────────────
function ptnRenderPage(id){
  const m=document.getElementById('main-content');if(!m)return;
  if(!_canSeePatternHub()){m.innerHTML='<div class="empty">The Pattern Hub is in a test phase — Afnan, Ammar, Mustafa and Uzaib.</div>';return;}
  const paint=()=>{
    if(currentPage!==id)return;
    if(id==='pattern-hub')m.innerHTML=renderPatternHub();
    else if(id==='pattern-reconcile')m.innerHTML=renderPatternReconcile();
    else if(id==='pattern-blocks')m.innerHTML=renderPatternBlocks();
    else if(id==='pattern-block')m.innerHTML=renderPatternBlock();
    else if(id==='pattern-unassigned')m.innerHTML=renderPatternUnassigned();
    else if(id==='pattern-poms')m.innerHTML=renderPatternPoms();
    else if(id==='pattern-notices')m.innerHTML=renderPatternNotices();
    else m.innerHTML='<div class="empty">Unknown Pattern Hub page.</div>';
  };
  const need=[];
  if(!patternsLoaded)need.push(loadPatternsData());
  if(!_ptnShopifyLoaded)need.push(loadPatternsShopify());
  if(typeof loadPatternsBlocks==='function'&&!_ptnBlocksLoaded)need.push(loadPatternsBlocks());
  if(typeof loadPatternsPoms==='function'&&!_ptnPomsLoaded)need.push(loadPatternsPoms());
  if(typeof loadPatternNotices==='function'&&!_ptnNoticesLoaded)need.push(loadPatternNotices());
  // A block's revisions are per block, so they load when one is opened.
  if(id==='pattern-block'&&_ptnBlockId&&typeof loadPatternRevisions==='function'&&!patternRevisions[_ptnBlockId])need.push(loadPatternRevisions(_ptnBlockId));
  if(need.length){m.innerHTML=gvSkeleton(6);Promise.all(need).then(paint);}else paint();
}

// ═══════════════════════════════════════════════════════════════════════════
// M2 — Blocks (patterns) · PTN-#### · the 10×5 hook map · assignment ·
//      the unassigned queue with a clustering SUGGESTION
// ═══════════════════════════════════════════════════════════════════════════
//
// A pattern is a BLOCK: one physical bundle of craft paper holding every
// size of one garment shape, hung in one slot of a 10-hook × 5-slot rack.
// Many article codes point at one block, and the link lives on the ARTICLE
// (articles/{code}.patternId) — never as an array on the block — so
// assigning writes one document and two people assigning different
// articles to the same block never collide (the columnId lesson). A slot
// is enforced by a lock document pattern_slots/{H-S} written in the same
// transaction as the pattern's hook/slot (the creator_handles lock), so
// two blocks cannot take one slot. "Not on a hook" is a normal state — the
// rack is 50 slots and the estimate is 60–130 blocks — and the map shows
// it rather than hiding it.

const _PTN_HOOKS=10,_PTN_SLOTS=5;
const _PTN_SIZES={alpha:['XXXS','XXS','XS','S','M','L','XL','2XL','3XL'],waist:['26','28','30','32','34','36','38','40']};
const _PTN_TRACERS=['Hassan','Alam'];

let patterns=[];               // [{id,code,name,category,fit,sizeAxis,sizes,sampleSize,hook,slot,tracedBy,status,…}]
let _ptnSlots={};              // 'H-S' → {patternId}
let _ptnBlocksLoaded=false,_ptnBlocksFailed={},_ptnBlocksErr=null;
let _ptnBlockId=null;          // the open block
let _ptnBlockQ='';             // article search on the block page
let _ptnQueueTab='groups';     // 'groups' | 'all'

function _ptnSlotKey(h,s){return h+'-'+s;}
function _ptnPad4(n){return 'PTN-'+String(n).padStart(4,'0');}
function _ptnBlock(id){return patterns.find(p=>p.id===id)||null;}
// A RETIRED block is "no block" for every article pointing at it — the
// link stays on the article (inert, no write) but the article is back in
// the queue and shows unassigned, exactly as the retire confirm promises.
function _ptnLiveBlock(id){const p=_ptnBlock(id);return p&&p.status!=='retired'?p:null;}
function _ptnBlockByCode(code){return patterns.find(p=>p.code===code)||null;}
function _ptnArticlesOf(patternId){return tacArticles.filter(a=>a.patternId===patternId);}
function _ptnLiveBlocks(){return patterns.filter(p=>p.status!=='retired');}
function _ptnUnplaced(){return _ptnLiveBlocks().filter(p=>!(p.hook&&p.slot));}
// Articles that need a pattern and have none — the queue.
function _ptnUnassigned(){return tacArticles.filter(a=>a.active!==false&&a.needsPattern&&!(a.patternId&&_ptnLiveBlock(a.patternId)));}

// ── Loader — cannot reject ────────────────────────────────────────────────
async function loadPatternsBlocks(){
  _ptnBlocksFailed={};_ptnBlocksErr=null;
  const [ps,sl]=await Promise.allSettled([
    getDocs(collection(db,'patterns')),
    getDocs(collection(db,'pattern_slots'))
  ]);
  if(ps.status==='fulfilled'){patterns=ps.value.docs.map(d=>Object.assign({id:d.id},d.data()));}
  else{_ptnBlocksFailed.patterns=true;console.warn('[patterns] patterns load failed',ps.reason);}
  if(sl.status==='fulfilled'){_ptnSlots={};sl.value.docs.forEach(d=>{_ptnSlots[d.id]=Object.assign({key:d.id},d.data());});}
  else{_ptnBlocksFailed.pattern_slots=true;console.warn('[patterns] pattern_slots load failed',sl.reason);}
  if(_ptnBlocksFailed.patterns){const r=ps.reason;_ptnBlocksErr=(r&&(r.message||String(r)))||'read failed';}
  _ptnBlocksLoaded=true;
}

// ── Clustering SUGGESTION — derived, never stored, never applied ──────────
// Same idea as the planning analysis: category + the style words of the
// name with colourways and noise stripped. It over-counts on purpose
// (every graphic tee names its ARTWORK, not its shape) — it is offered on
// the queue as "these look like one block", and a person decides.
const _PTN_COLOUR_WORDS=new Set(('black white cream grey gray green blue brown red plum olive mauve muave rust sage slate charcoal camel teal navy maroon crimson emerald mocha stone ash graphite granite lilac frost heather sandstone khaki chalk wine pastel mint military arctyc cool hunter racing electric steel deep dark light iced ice silver gold tan beige purple pink yellow orange sand moss coral').split(' '));
const _PTN_NOISE_WORDS=new Set(('the a of and v1 v2 vi vii 2 0 20 summer summers winter winters edition exclusive top bottom').split(' '));
function _ptnClusterKey(a){
  const name=String(a.name||'');
  const parts=name.split('|');
  let base=parts[0];
  if(parts.length>1){
    const tail=parts.slice(1).join(' ').toLowerCase().replace(/[^a-z ]/g,' ').split(/\s+/).filter(Boolean);
    if(!tail.some(w=>_PTN_COLOUR_WORDS.has(w)))base=name;   // the tail is not a colourway — keep it
  }
  base=base.replace(/\(.*?\)/g,'');
  const words=base.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w&&!_PTN_COLOUR_WORDS.has(w)&&!_PTN_NOISE_WORDS.has(w));
  return (a.category||'')+'::'+(words.join(' ')||'(colour only)');
}
function _ptnClusterLabel(key){const i=key.indexOf('::');const style=key.slice(i+2);const cat=_ptnCategory(key.slice(0,i));return{cat,style};}
function _ptnClusters(list){
  const by={};
  list.forEach(a=>{const k=_ptnClusterKey(a);(by[k]=by[k]||[]).push(a);});
  return Object.keys(by).map(k=>({key:k,articles:by[k].slice().sort((x,y)=>String(x.code).localeCompare(String(y.code)))}))
    .sort((x,y)=>y.articles.length-x.articles.length||x.key.localeCompare(y.key));
}
// A sensible default block name for a cluster: "Live In Pants block".
function _ptnSuggestName(key){
  const {style}=_ptnClusterLabel(key);
  const s=style==='(colour only)'?'':style.replace(/\b\w/g,c=>c.toUpperCase());
  return s?s+' block':'';
}

// ── Pages ─────────────────────────────────────────────────────────────────
function renderPatternBlocks(){
  if(!_canSeePatternHub())return'<div class="empty">The Pattern Hub is in a test phase — Afnan, Ammar, Mustafa and Uzaib.</div>';
  return`<div id="pattern-blocks-root">${_ptnBlocksHTML()}</div>`;
}
function _ptnBlocksRepaint(){const r=document.getElementById('pattern-blocks-root');if(r)r.innerHTML=_ptnBlocksHTML();}
function _ptnBlocksErrHTML(){
  if(_ptnBlocksErr)return`<div class="board-load-error" id="ptn-blocks-error"><div style="font-weight:700;margin-bottom:4px">Could not load the patterns</div><div style="font-size:12px;color:var(--muted)">patterns: ${_ptnEsc(_ptnBlocksErr)}. If that says <em>missing or insufficient permissions</em>, republish <code>firestore.rules</code>.</div><button class="btn-sm" style="margin-top:10px" onclick="window.ptnRetryLoad()">Retry</button></div>`;
  if(_ptnBlocksFailed.pattern_slots)return`<div class="board-load-warn" id="ptn-slots-warn" style="margin-bottom:12px">The slot locks (<code>pattern_slots</code>) did not load — the hook map may be incomplete and placing is disabled until it loads. <button class="btn-sm" onclick="window.ptnRetryLoad()">Retry</button></div>`;
  return'';
}
function _ptnBlocksHTML(){
  const head=`<button class="back-btn" onclick="window.showPage('pattern-hub')">← Pattern Hub</button>
  <div class="page-head" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap">
    <div><h2 style="margin:0">Patterns</h2><div style="color:var(--muted);font-size:12px;margin-top:2px">One block = one bundle of craft paper, all sizes, one slot. Many articles point at one block.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${_canManagePatterns()?`<button class="btn-primary" onclick="window.ptnNewBlock()">+ New block</button>`:''}<button class="btn-sm" onclick="window.showPage('pattern-unassigned')">Unassigned queue${_ptnQueueBadge()}</button><button class="btn-sm" onclick="window.showPage('pattern-poms')">Points of measure</button><button class="btn-sm" onclick="window.showPage('pattern-notices')">Pattern updates${typeof _ptnNoticeBadge==='function'?_ptnNoticeBadge():''}</button></div>
  </div>`;
  const err=_ptnBlocksErrHTML();
  if(_ptnBlocksErr)return head+err;
  const live=_ptnLiveBlocks(),un=_ptnUnplaced();
  const tile=(n,l)=>`<div class="card" style="padding:12px 14px;flex:1;min-width:120px"><div style="font-size:22px;font-weight:700">${n}</div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">${l}</div></div>`;
  const placed=live.length-un.length;
  const stats=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">${tile(live.length,'Blocks')}${tile(placed+' / '+(_PTN_HOOKS*_PTN_SLOTS),'Slots used')}${tile(un.length,'Not on a hook')}${tile(_ptnUnassigned().length,'Articles unassigned')}</div>`;
  return head+err+stats+_ptnHookMapHTML()+_ptnUnplacedHTML()+_ptnBlockListHTML();
}
function _ptnHookMapHTML(){
  let rows='';
  for(let h=1;h<=_PTN_HOOKS;h++){
    let cells='';
    for(let s=1;s<=_PTN_SLOTS;s++){
      const k=_ptnSlotKey(h,s);const lock=_ptnSlots[k];const p=lock&&_ptnBlock(lock.patternId);
      cells+=p?`<button class="ptn-slot ptn-slot-full" data-slot="${k}" title="${_ptnEsc(p.name||'')}" onclick="window.ptnOpenBlock('${_ptnEsc(p.id)}')" style="text-align:left;border:1px solid var(--border);background:var(--surface-2);border-radius:8px;padding:6px 8px;min-height:48px;font-family:inherit;cursor:pointer;color:var(--text)"><div style="font-weight:700;font-size:12px">${_ptnEsc(p.code)}</div><div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_ptnEsc(p.name||'')}</div></button>`
        :(lock?`<div class="ptn-slot ptn-slot-stale" data-slot="${k}" title="A lock with no live block — retired or deleted" style="border:1px dashed var(--accent-warning);border-radius:8px;padding:6px 8px;min-height:48px;font-size:11px;color:var(--muted)">stale lock${_canManagePatterns()?` <button class="btn-sm" onclick="window.ptnClearSlot('${k}')">clear</button>`:''}</div>`
        :`<div class="ptn-slot ptn-slot-empty" data-slot="${k}" style="border:1px dashed var(--border);border-radius:8px;padding:6px 8px;min-height:48px;font-size:11px;color:var(--muted)">empty</div>`);
    }
    rows+=`<div style="display:grid;grid-template-columns:44px repeat(${_PTN_SLOTS},minmax(0,1fr));gap:6px;align-items:stretch"><div style="font-size:11px;font-weight:700;color:var(--muted);align-self:center">Hook ${h}</div>${cells}</div>`;
  }
  return`<div class="card" id="ptn-hook-map" style="margin-bottom:14px"><div class="card-title">Hook map <span style="font-weight:400;color:var(--muted);font-size:11px">10 hooks × 5 slots · click a block to open it</span></div><div style="display:flex;flex-direction:column;gap:6px;overflow:auto">${rows}</div></div>`;
}
function _ptnUnplacedHTML(){
  const un=_ptnUnplaced();
  if(!un.length)return'';
  return`<div class="card" id="ptn-unplaced" style="border-color:var(--accent-warning);margin-bottom:14px"><div class="card-title">Not on a hook <span style="font-weight:400;color:var(--muted);font-size:11px">${un.length} block${un.length===1?'':'s'} — normal while the rack fills; the rack has ${_PTN_HOOKS*_PTN_SLOTS} slots</span></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${un.map(p=>`<button class="btn-sm" onclick="window.ptnOpenBlock('${_ptnEsc(p.id)}')">${_ptnEsc(p.code)} · ${_ptnEsc(p.name||'')}</button>`).join('')}</div></div>`;
}
function _ptnBlockListHTML(){
  const live=_ptnLiveBlocks().slice().sort((a,b)=>String(a.code).localeCompare(String(b.code)));
  const retired=patterns.filter(p=>p.status==='retired');
  if(!patterns.length)return`<div class="empty" id="ptn-blocks-empty">No blocks yet. Create one, or start from the <a href="#" onclick="window.showPage('pattern-unassigned');return false">unassigned queue</a> — it groups articles that look like one block.</div>`;
  const can=_canManagePatterns();
  const row=p=>{const n=_ptnArticlesOf(p.id).length;return`<tr class="ptn-block-row" data-id="${_ptnEsc(p.id)}" style="border-top:1px solid var(--border);cursor:pointer" onclick="window.ptnOpenBlock('${_ptnEsc(p.id)}')">${can?`<td style="padding:9px 6px 9px 12px" onclick="event.stopPropagation()"><input type="checkbox" class="ptn-label-pick" ${_ptnLabelSel.has(p.id)?'checked':''} onchange="window.ptnLabelToggle('${_ptnEsc(p.id)}',this.checked)"></td>`:''}<td style="padding:9px 12px;font-weight:700;white-space:nowrap">${_ptnEsc(p.code)}</td><td style="padding:9px 12px">${_ptnEsc(p.name||'')}</td><td style="padding:9px 12px;color:var(--muted);white-space:nowrap">${_ptnEsc((_ptnCategory(p.category)||{}).label||p.category||'')}</td><td style="padding:9px 12px;white-space:nowrap">${_ptnEsc((p.sizes||[]).join(' '))}</td><td style="padding:9px 12px;white-space:nowrap">${p.hook&&p.slot?'H'+p.hook+' / S'+p.slot:'<span style="color:var(--accent-warning)">not placed</span>'}</td><td style="padding:9px 12px;text-align:right">${n}</td></tr>`;};
  return`<div class="card" style="padding:0;overflow:auto">${can?`<div id="ptn-label-bar" style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap">${_ptnLabelBarInner()}</div>`:''}<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase">${can?'<th style="padding:10px 6px 10px 12px"></th>':''}<th style="padding:10px 12px">Code</th><th style="padding:10px 12px">Block</th><th style="padding:10px 12px">Category</th><th style="padding:10px 12px">Sizes</th><th style="padding:10px 12px">Home</th><th style="padding:10px 12px;text-align:right">Articles</th></tr></thead><tbody>${live.map(row).join('')}</tbody></table>
  ${retired.length?`<div style="padding:8px 12px;font-size:11px;color:var(--muted);border-top:1px solid var(--border)">${retired.length} retired block${retired.length===1?'':'s'} hidden.</div>`:''}</div>`;
}

// ── One block ─────────────────────────────────────────────────────────────
function renderPatternBlock(){
  if(!_canSeePatternHub())return'<div class="empty">The Pattern Hub is in a test phase — Afnan, Ammar, Mustafa and Uzaib.</div>';
  return`<div id="pattern-block-root">${_ptnBlockHTML()}</div>`;
}
function _ptnBlockRepaint(){const r=document.getElementById('pattern-block-root');if(r)r.innerHTML=_ptnBlockHTML();}
function _ptnBlockHTML(){
  const p=_ptnBlock(_ptnBlockId);
  const back=`<button class="back-btn" onclick="window.showPage('pattern-blocks')">← Patterns</button>`;
  if(!p)return back+`<div class="empty" id="ptn-block-missing">That block is not loaded${_ptnBlocksErr?' — '+_ptnEsc(_ptnBlocksErr):''}. <button class="btn-sm" onclick="window.ptnRetryLoad()">Retry</button></div>`;
  const can=_canManagePatterns();
  const cat=_ptnCategory(p.category);
  const arts=_ptnArticlesOf(p.id).sort((a,b)=>String(a.code).localeCompare(String(b.code)));
  const q=_ptnBlockQ.trim().toLowerCase();
  const candidates=q?tacArticles.filter(a=>a.active!==false&&a.needsPattern&&a.patternId!==p.id&&(String(a.code).toLowerCase().includes(q)||String(a.name||'').toLowerCase().includes(q))).slice(0,25):[];
  const info=(l,v)=>`<div class="info-row"><span class="info-label">${l}</span><span>${v}</span></div>`;
  const home=p.hook&&p.slot?`Hook ${p.hook} · Slot ${p.slot}`:'<span style="color:var(--accent-warning)">Not on a hook</span>';
  const slotOpts=()=>{let o='<option value="">— not on a hook —</option>';for(let h=1;h<=_PTN_HOOKS;h++)for(let s=1;s<=_PTN_SLOTS;s++){const k=_ptnSlotKey(h,s);const lock=_ptnSlots[k];const mine=lock&&lock.patternId===p.id;const taken=lock&&!mine;o+=`<option value="${k}"${mine?' selected':''}${taken?' disabled':''}>Hook ${h} · Slot ${s}${taken?' — '+_ptnEsc((_ptnBlock(lock.patternId)||{}).code||'taken'):''}</option>`;}return o;};
  return back+`
  <div class="page-head" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
    <div><h2 style="margin:0">${_ptnEsc(p.code)} <span style="font-weight:400">· ${_ptnEsc(p.name||'')}</span>${p.status==='retired'?' <span class="badge">retired</span>':''}</h2><div style="color:var(--muted);font-size:12px;margin-top:2px">${_ptnEsc(cat?cat.label:p.category||'')}${p.fit?' · '+_ptnEsc(p.fit):''} · ${_ptnEsc((p.sizes||[]).join(' '))}${p.sampleSize?' · sample '+_ptnEsc(p.sampleSize):''}${p.tracedBy?' · traced by '+_ptnEsc(p.tracedBy):''}</div></div>
    ${can?`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-sm" onclick="window.ptnEditBlock()">Edit</button>${p.status==='retired'?`<button class="btn-sm" onclick="window.ptnRestoreBlock('${_ptnEsc(p.id)}')">Restore</button>`:`<button class="btn-sm" onclick="window.ptnRetireBlock('${_ptnEsc(p.id)}')">Retire</button>`}</div>`:''}
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;align-items:start">
    <div class="card"><div class="card-title">Home</div>
      ${info('Where it hangs',home)}
      ${can&&!_ptnBlocksFailed.pattern_slots?`<div class="field" style="margin-top:8px"><label>Move to</label><select id="ptn-slot-pick">${slotOpts()}</select></div><button class="btn-primary" ${_ptnBusy?'disabled':''} onclick="window.ptnPlaceBlock('${_ptnEsc(p.id)}')">Save home</button>`:''}
      <div style="font-size:11px;color:var(--muted);margin-top:8px">A taken slot is greyed out. Two blocks can never share one — the lock is written with the move.</div>
    </div>
  </div>
  <div style="margin-top:14px">${typeof _ptnGridCardHTML==='function'?_ptnGridCardHTML(p):''}</div>
  ${typeof _ptnLabelCardHTML==='function'?_ptnLabelCardHTML(p):''}
  ${typeof _ptnRevisionsCardHTML==='function'?_ptnRevisionsCardHTML(p):''}
  <div class="card" style="margin-top:14px" id="ptn-block-articles"><div class="card-title">Articles using this block <span style="font-weight:400;color:var(--muted);font-size:11px">${arts.length}</span></div>
    ${arts.length?`<table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>${arts.map(a=>`<tr class="ptn-block-art" data-code="${_ptnEsc(a.code)}" style="border-top:1px solid var(--border)"><td style="padding:7px 4px;font-weight:700;white-space:nowrap">${_ptnEsc(a.code)}</td><td style="padding:7px 4px">${_ptnEsc(a.name||'')}</td><td style="padding:7px 4px;white-space:nowrap">${_ptnShopifyCellHTML(a)}</td><td style="padding:7px 4px;text-align:right">${can?`<button class="btn-sm" onclick="window.ptnUnassign('${_ptnEsc(a.code)}')">Remove</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">No articles yet.</div>'}
    ${can?`<div style="margin-top:12px"><input type="search" id="ptn-block-q" placeholder="Add an article — search code or name…" value="${_ptnEsc(_ptnBlockQ)}" oninput="window.ptnBlockSearch(this.value)" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:9px;font-size:13px;font-family:inherit;background:var(--surface-2);color:var(--text)">
      ${q?(candidates.length?`<div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">${candidates.map(a=>{const other=a.patternId&&_ptnLiveBlock(a.patternId);return`<button class="btn-sm ptn-cand" data-code="${_ptnEsc(a.code)}" style="text-align:left" onclick="window.ptnAssign('${_ptnEsc(p.id)}',['${_ptnEsc(a.code)}'])"><b>${_ptnEsc(a.code)}</b> ${_ptnEsc(a.name||'')}${other?` <span style="color:var(--accent-warning)">· now on ${_ptnEsc(other.code)} — will move</span>`:''}</button>`;}).join('')}</div>`:'<div style="font-size:12px;color:var(--muted);margin-top:6px">No article matches (caps and retired articles are never offered).</div>'):''}</div>`:''}
  </div>`;
}

// ── The unassigned queue ──────────────────────────────────────────────────
function _ptnQueueBadge(){const n=_ptnUnassigned().length;return n?` <span class="badge" style="font-size:10px">${n}</span>`:'';}
function renderPatternUnassigned(){
  if(!_canSeePatternHub())return'<div class="empty">The Pattern Hub is in a test phase — Afnan, Ammar, Mustafa and Uzaib.</div>';
  return`<div id="pattern-queue-root">${_ptnQueueHTML()}</div>`;
}
function _ptnQueueRepaint(){const r=document.getElementById('pattern-queue-root');if(r)r.innerHTML=_ptnQueueHTML();}
function _ptnQueueHTML(){
  const head=`<button class="back-btn" onclick="window.showPage('pattern-blocks')">← Patterns</button>
  <div class="page-head" style="margin-bottom:10px"><div><h2 style="margin:0">Unassigned articles</h2><div style="color:var(--muted);font-size:12px;margin-top:2px">GROOVY articles that need a pattern and have none. Groups are a SUGGESTION from the names — colourways stripped — a graphic tee names its artwork, not its shape, so trust your eyes over the grouping.</div></div></div>`;
  if(_ptnBlocksErr)return head+_ptnBlocksErrHTML();
  const list=_ptnUnassigned().filter(a=>a.brand==='groovy');
  if(!list.length)return head+'<div class="empty" id="ptn-queue-empty">Every GROOVY article that needs a pattern has one.</div>';
  const can=_canManagePatterns();
  const blocks=_ptnLiveBlocks().slice().sort((a,b)=>String(a.code).localeCompare(String(b.code)));
  const blockOpts=`<option value="">— pick a block —</option>${blocks.map(b=>`<option value="${_ptnEsc(b.id)}">${_ptnEsc(b.code)} · ${_ptnEsc(b.name||'')}</option>`).join('')}`;
  const tabs=`<div style="display:flex;gap:6px;margin-bottom:12px"><button class="btn-sm" style="${_ptnQueueTab==='groups'?'background:var(--dark);color:var(--on-dark);border-color:var(--dark)':''}" onclick="window.ptnQueueTab('groups')">Suggested groups</button><button class="btn-sm" style="${_ptnQueueTab==='all'?'background:var(--dark);color:var(--on-dark);border-color:var(--dark)':''}" onclick="window.ptnQueueTab('all')">All ${list.length}</button></div>`;
  let body='';
  if(_ptnQueueTab==='groups'){
    const clusters=_ptnClusters(list);
    body=clusters.map((c,i)=>{const {cat,style}=_ptnClusterLabel(c.key);const n=c.articles.length;
      return`<div class="card ptn-cluster" data-key="${_ptnEsc(c.key)}" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div><div style="font-weight:700">${_ptnEsc(style==='(colour only)'?(cat?cat.label:'')+' — colour-only names':style.replace(/\b\w/g,ch=>ch.toUpperCase()))} <span style="color:var(--muted);font-weight:400;font-size:12px">· ${_ptnEsc(cat?cat.label:'')} · ${n} article${n===1?'':'s'}</span></div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">${c.articles.map(a=>`<span style="display:inline-block;margin:2px 6px 2px 0"><b>${_ptnEsc(a.code)}</b> ${_ptnEsc(a.name||'')}</span>`).join('')}</div></div>
        ${can?`<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><select id="ptn-cl-${i}" style="padding:7px 9px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:12px;background:var(--surface-2);color:var(--text)">${blockOpts}</select><button class="btn-sm" ${_ptnBusy?'disabled':''} onclick="window.ptnAssignCluster(${i})">Assign all ${n}</button><button class="btn-sm" ${_ptnBusy?'disabled':''} onclick="window.ptnNewBlockFor(${i})">New block for these</button></div>`:''}
      </div></div>`;}).join('');
  }else{
    body=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>${list.slice().sort((a,b)=>String(a.code).localeCompare(String(b.code))).map(a=>`<tr style="border-top:1px solid var(--border)"><td style="padding:7px 12px;font-weight:700;white-space:nowrap">${_ptnEsc(a.code)}</td><td style="padding:7px 12px">${_ptnEsc(a.name||'')}</td><td style="padding:7px 12px;color:var(--muted);white-space:nowrap">${_ptnEsc((_ptnCategory(a.category)||{}).label||'')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return head+tabs+body;
}

// ── Block form (create / edit) — a sheet-like card at the top of the list ─
let _ptnBlockForm=null;   // {id|null, prefill:{name,category,codes:[…]}}
function _ptnBlockFormHTML(){
  const f=_ptnBlockForm;if(!f)return'';
  const p=f.id?_ptnBlock(f.id):null;
  const v=k=>_ptnEsc((p&&p[k])||(f.prefill&&f.prefill[k])||'');
  const axis=(p&&p.sizeAxis)||(f.prefill&&f.prefill.sizeAxis)||'alpha';
  const sizes=new Set((p&&p.sizes)||(f.prefill&&f.prefill.sizes)||(axis==='waist'?['26','28','30','32','34']:['XS','S','M','L','XL']));
  const cats=_ptnCategoriesFor('groovy');
  const catSel=(p&&p.category)||(f.prefill&&f.prefill.category)||'';
  return`<div class="card" id="ptn-block-form" style="margin-bottom:14px;border-color:var(--dark)"><div class="card-title">${p?'Edit '+_ptnEsc(p.code):'New block'}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;align-items:end">
      <div class="field"><label>Block name</label><input id="ptn-bf-name" placeholder="e.g. Live In Pants block" value="${v('name')}"></div>
      <div class="field"><label>Category</label><select id="ptn-bf-cat">${cats.filter(c=>c.needsPattern!==false).map(c=>`<option value="${c.prefix}"${c.prefix===catSel?' selected':''}>${c.prefix} · ${_ptnEsc(c.label)}</option>`).join('')}</select></div>
      <div class="field"><label>Fit</label><input id="ptn-bf-fit" placeholder="Relaxed / Baggy / Oversized" value="${v('fit')}"></div>
      <div class="field"><label>Points of measure</label><select id="ptn-bf-tpl">${(typeof _PTN_POM_SEED!=='undefined'?_PTN_POM_SEED:[]).map(t=>`<option value="${t.id}"${t.id===((p&&p.pomTemplate)||(f.prefill&&f.prefill.pomTemplate)||_ptnGuessTemplate(catSel))?' selected':''}>${_ptnEsc(t.label)}</option>`).join('')}</select></div>
      <div class="field"><label>Traced by</label><select id="ptn-bf-traced">${['',..._PTN_TRACERS].map(t=>`<option value="${t}"${t===((p&&p.tracedBy)||'')?' selected':''}>${t||'—'}</option>`).join('')}</select></div>
      <div class="field"><label>Size axis</label><select id="ptn-bf-axis" onchange="window.ptnBlockFormAxis(this.value)"><option value="alpha"${axis==='alpha'?' selected':''}>Letters (XS–XL)</option><option value="waist"${axis==='waist'?' selected':''}>Waist (26–40)</option></select></div>
      <div class="field"><label>Sample size <span style="font-weight:400;color:var(--muted)">(the label leads with it)</span></label><input id="ptn-bf-sample" placeholder="M or 32" value="${v('sampleSize')}"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Sizes in the bundle</label><div id="ptn-bf-sizes" style="display:flex;gap:6px;flex-wrap:wrap">${_PTN_SIZES[axis].map(s=>`<label style="display:flex;align-items:center;gap:4px;font-size:12px;border:1px solid var(--border);border-radius:8px;padding:4px 8px"><input type="checkbox" class="ptn-bf-size" value="${s}" ${sizes.has(s)?'checked':''}>${s}</label>`).join('')}</div></div>
    ${f.prefill&&f.prefill.codes&&f.prefill.codes.length?`<div style="font-size:12px;color:var(--muted);margin-top:8px">On save, <b>${f.prefill.codes.length}</b> article${f.prefill.codes.length===1?'':'s'} will be assigned to it: ${f.prefill.codes.map(_ptnEsc).join(', ')}</div>`:''}
    <div style="margin-top:10px;display:flex;gap:8px"><button class="btn-primary" ${_ptnBusy?'disabled':''} onclick="window.ptnSaveBlock()">${p?'Save':'Create'}</button><button class="btn-sm" onclick="window.ptnCancelBlockForm()">Cancel</button></div>
  </div>`;
}
window.ptnBlockFormAxis=function(axis){
  const host=document.getElementById('ptn-bf-sizes');if(!host||!_PTN_SIZES[axis])return;
  const def=axis==='waist'?['26','28','30','32','34']:['XS','S','M','L','XL'];
  host.innerHTML=_PTN_SIZES[axis].map(s=>`<label style="display:flex;align-items:center;gap:4px;font-size:12px;border:1px solid var(--border);border-radius:8px;padding:4px 8px"><input type="checkbox" class="ptn-bf-size" value="${s}" ${def.indexOf(s)>-1?'checked':''}>${s}</label>`).join('');
};
function _ptnReadBlockForm(){
  const g=id=>String((document.getElementById(id)||{}).value||'').trim();
  const sizes=[];const boxes=(document.querySelectorAll?document.querySelectorAll('.ptn-bf-size'):[])||[];boxes.forEach(el=>{if(el.checked)sizes.push(el.value);});
  return{name:g('ptn-bf-name'),category:g('ptn-bf-cat'),fit:g('ptn-bf-fit'),tracedBy:g('ptn-bf-traced'),sizeAxis:g('ptn-bf-axis')||'alpha',sampleSize:g('ptn-bf-sample').toUpperCase(),sizes,pomTemplate:g('ptn-bf-tpl')||_ptnGuessTemplate(g('ptn-bf-cat'))};
}
function _ptnValidateBlock(d){
  if(!d.name)return'Give the block a name.';
  if(!_ptnCategory(d.category))return'Pick a category.';
  if(!_PTN_SIZES[d.sizeAxis])return'Pick a size axis.';
  if(!d.sizes.length)return'Tick at least one size in the bundle.';
  const bad=d.sizes.filter(s=>_PTN_SIZES[d.sizeAxis].indexOf(s)<0);if(bad.length)return'Sizes '+bad.join(', ')+' are not on the '+d.sizeAxis+' axis.';
  if(d.sampleSize&&d.sizes.indexOf(d.sampleSize)<0)return'The sample size must be one of the sizes in the bundle.';
  if(d.pomTemplate&&!_PTN_POM_SEED.some(t=>t.id===d.pomTemplate)&&!_ptnTemplate(d.pomTemplate))return'Unknown points-of-measure template.';
  return null;
}

// ── Handlers ──────────────────────────────────────────────────────────────
window.ptnOpenBlock=function(id){_ptnBlockId=id;_ptnBlockQ='';if(typeof _ptnGridDraft!=='undefined'){_ptnGridDraft=null;_ptnGridDirty=false;}window.showPage('pattern-block');};
// Saving measurements changes what a revision would say, so the card is
// repainted by the same _ptnBlockRepaint the save already calls.
window.ptnQueueTab=function(t){_ptnQueueTab=t;_ptnQueueRepaint();};
window.ptnBlockSearch=function(v){
  clearTimeout(_ptnSearchTimer);
  _ptnSearchTimer=setTimeout(()=>{_ptnBlockQ=String(v||'');_ptnBlockRepaint();const i=document.getElementById('ptn-block-q');if(i){i.focus();const n=i.value.length;try{i.setSelectionRange(n,n);}catch(e){}}},180);
};
window.ptnNewBlock=function(prefill){if(!_canManagePatterns())return;_ptnBlockForm={id:null,prefill:prefill||{}};_ptnBlocksShowForm();};
window.ptnEditBlock=function(){if(!_canManagePatterns()||!_ptnBlockId)return;_ptnBlockForm={id:_ptnBlockId,prefill:{}};window.showPage('pattern-blocks');_ptnBlocksShowForm();};
window.ptnCancelBlockForm=function(){_ptnBlockForm=null;_ptnBlocksRepaint();};
function _ptnBlocksShowForm(){
  const r=document.getElementById('pattern-blocks-root');
  if(!r){window.showPage('pattern-blocks');return;}
  r.innerHTML=_ptnBlocksHTML();
  const head=r.querySelector&&r.querySelector('.page-head');
  const html=_ptnBlockFormHTML();
  if(head&&head.insertAdjacentHTML)head.insertAdjacentHTML('afterend',html);else r.innerHTML=html+r.innerHTML;
}
// New block for a suggested cluster: prefilled name + category + the codes.
window.ptnNewBlockFor=function(i){
  const clusters=_ptnClusters(_ptnUnassigned().filter(a=>a.brand==='groovy'));const c=clusters[i];if(!c)return;
  const {cat}=_ptnClusterLabel(c.key);
  const axisGuess=(shopifyArticles&&c.articles.map(a=>shopifyArticles[a.code]).find(sa=>sa&&sa.size_axis&&sa.size_axis!=='none')||{}).size_axis||(cat&&['GD','GJO','GC'].indexOf(cat.prefix)>-1?'waist':'alpha');
  window.showPage('pattern-blocks');
  window.ptnNewBlock({name:_ptnSuggestName(c.key),category:cat?cat.prefix:'',codes:c.articles.map(a=>a.code),sizeAxis:axisGuess});
};

// Create: PTN-#### from counters/main (getNextId, js/shared.js), then ONE
// transaction that refuses a taken slot and writes the block + its lock.
// A number spent on a refused transaction is simply skipped — a gap in
// PTN numbering is harmless, a double-booked slot is not.
window.ptnSaveBlock=async function(){
  if(!_canManagePatterns()||_ptnBusy||!_ptnBlockForm)return;
  return _ptnSaveBlockData(_ptnReadBlockForm(),_ptnBlockForm);
};
async function _ptnSaveBlockData(d,f){
  if(!_canManagePatterns()||_ptnBusy||!f)return false;
  const err=_ptnValidateBlock(d);if(err){showToast(err,true);return false;}
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBlockForm=f;
  _ptnBusy=true;
  try{
    if(f.id){
      const p=_ptnBlock(f.id);if(!p)throw new Error('Block not loaded');
      const patch=Object.assign({},d,{updatedAt:now,updatedBy:by});
      await updateDoc(doc(db,'patterns',f.id),patch);
      Object.assign(p,patch);
      showToast('Saved '+p.code+'.');_ptnLog('Pattern Edited',p.code+' — '+p.name);
      _ptnBlockForm=null;_ptnBusy=false;_ptnBlockId=f.id;window.showPage('pattern-block');return true;
    }
    if(typeof getNextId!=='function')throw new Error('Counter helper not loaded — refresh the page');
    const n=await getNextId('patterns');
    const code=_ptnPad4(n);
    const id='ptn_'+String(n).padStart(4,'0');
    const rec=Object.assign({code,hook:null,slot:null,status:'active',grid:{},extraPoms:[],pomTemplate:_ptnGuessTemplate(d.category),createdAt:now,createdBy:by,updatedAt:now,updatedBy:by},d);
    await runTransaction(db,async tx=>{
      const s=await tx.get(doc(db,'patterns',id));
      if(s&&typeof s.exists==='function'&&s.exists())throw new Error(code+' already exists');
      tx.set(doc(db,'patterns',id),rec);
    });
    patterns.push(Object.assign({id},rec));
    showToast('Created '+code+' — '+d.name);_ptnLog('Pattern Created',code+' — '+d.name);
    const codes=(f.prefill&&f.prefill.codes)||[];
    _ptnBlockForm=null;_ptnBusy=false;
    if(codes.length)await window.ptnAssign(id,codes,true);
    _ptnBlockId=id;window.showPage('pattern-block');return true;
  }catch(e){console.error('[patterns] save block failed',e);showToast('Could not save: '+(e.message||e),true);_ptnBusy=false;_ptnBlocksRepaint();return false;}
}

// Place / move: the lock is the truth. One transaction reads the target
// lock, refuses if another block holds it, releases the old one, takes
// the new one, and writes hook/slot on the block.
window.ptnPlaceBlock=async function(id){
  if(!_canManagePatterns()||_ptnBusy)return;
  const p=_ptnBlock(id);if(!p)return;
  const val=String((document.getElementById('ptn-slot-pick')||{}).value||'');
  let hook=null,slot=null;
  if(val){const m=/^(\d+)-(\d+)$/.exec(val);if(!m){showToast('Pick a slot.',true);return;}hook=parseInt(m[1],10);slot=parseInt(m[2],10);
    if(hook<1||hook>_PTN_HOOKS||slot<1||slot>_PTN_SLOTS){showToast('That slot does not exist.',true);return;}}
  await _ptnPlace(p,hook,slot);
  _ptnBlockRepaint();
};
async function _ptnPlace(p,hook,slot){
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  const oldKey=p.hook&&p.slot?_ptnSlotKey(p.hook,p.slot):null;
  const newKey=hook&&slot?_ptnSlotKey(hook,slot):null;
  if(oldKey===newKey){showToast('Already there.');return true;}
  _ptnBusy=true;
  try{
    await runTransaction(db,async tx=>{
      if(newKey){
        const s=await tx.get(doc(db,'pattern_slots',newKey));
        const d=(s&&typeof s.exists==='function'&&s.exists())?s.data():null;
        if(d&&d.patternId&&d.patternId!==p.id){const o=_ptnBlock(d.patternId);throw new Error('Hook '+hook+' / Slot '+slot+' already holds '+((o&&o.code)||d.patternId));}
      }
      if(oldKey)tx.delete(doc(db,'pattern_slots',oldKey));
      if(newKey)tx.set(doc(db,'pattern_slots',newKey),{patternId:p.id,patternCode:p.code,since:now,by});
      tx.update(doc(db,'patterns',p.id),{hook,slot,updatedAt:now,updatedBy:by});
    });
    if(oldKey)delete _ptnSlots[oldKey];
    if(newKey)_ptnSlots[newKey]={key:newKey,patternId:p.id,patternCode:p.code,since:now,by};
    p.hook=hook;p.slot=slot;
    showToast(newKey?p.code+' is now on Hook '+hook+' / Slot '+slot+'.':p.code+' taken off the rack.');
    _ptnLog('Pattern Placed',p.code+' → '+(newKey?'H'+hook+'/S'+slot:'off the rack'));
    _ptnBusy=false;return true;
  }catch(e){console.error('[patterns] place failed',e);showToast('Could not move: '+(e.message||e),true);_ptnBusy=false;return false;}
}
// A lock whose block is gone (retired, deleted by hand) blocks a slot for
// nothing; clearing it is the one write that touches a lock alone.
window.ptnClearSlot=async function(key){
  if(!_canManagePatterns()||_ptnBusy)return;
  const lock=_ptnSlots[key];if(!lock)return;
  const p=_ptnBlock(lock.patternId);
  if(p&&p.status!=='retired'){showToast('That slot is held by '+p.code+' — move the block instead.',true);return;}
  _ptnBusy=true;
  try{await deleteDoc(doc(db,'pattern_slots',key));delete _ptnSlots[key];showToast('Slot cleared.');}
  catch(e){showToast('Could not clear: '+(e.message||e),true);}
  _ptnBusy=false;_ptnBlocksRepaint();
};
window.ptnRetireBlock=async function(id){
  if(!_canManagePatterns()||_ptnBusy)return;
  const p=_ptnBlock(id);if(!p)return;
  const n=_ptnArticlesOf(id).length;
  if(typeof confirm==='function'&&!confirm('Retire '+p.code+'? Its slot is released and its '+n+' article'+(n===1?'':'s')+' go back to the unassigned queue. Nothing is deleted.'))return;
  if(p.hook&&p.slot){const ok=await _ptnPlace(p,null,null);if(!ok)return;}
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBusy=true;
  try{
    await updateDoc(doc(db,'patterns',id),{status:'retired',updatedAt:now,updatedBy:by});
    p.status='retired';
    showToast('Retired '+p.code+'.');_ptnLog('Pattern Retired',p.code);
  }catch(e){showToast('Could not retire: '+(e.message||e),true);}
  _ptnBusy=false;_ptnBlockRepaint();
};
window.ptnRestoreBlock=async function(id){
  if(!_canManagePatterns()||_ptnBusy)return;
  const p=_ptnBlock(id);if(!p)return;
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBusy=true;
  try{await updateDoc(doc(db,'patterns',id),{status:'active',updatedAt:now,updatedBy:by});p.status='active';showToast('Restored '+p.code+'.');}
  catch(e){showToast('Could not restore: '+(e.message||e),true);}
  _ptnBusy=false;_ptnBlockRepaint();
};

// Assign: one batch, one update per ARTICLE — never a write to the block.
// Caps (needsPattern:false) and retired articles are refused; an article
// already on another block is moved, and the toast says so.
window.ptnAssign=async function(patternId,codes,quiet){
  if(!_canManagePatterns()||_ptnBusy)return false;
  const p=_ptnBlock(patternId);if(!p){showToast('That block is not loaded.',true);return false;}
  if(p.status==='retired'){showToast(p.code+' is retired — restore it first.',true);return false;}
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  const todo=[],skipped=[],moved=[];
  (codes||[]).forEach(code=>{
    const a=tacArticles.find(x=>x.code===code);
    if(!a||a.active===false||!a.needsPattern){skipped.push(code);return;}
    if(a.patternId===patternId)return;
    if(a.patternId&&_ptnLiveBlock(a.patternId))moved.push(code);
    todo.push(a);
  });
  if(!todo.length){if(!quiet)showToast(skipped.length?'Nothing assigned — '+skipped.join(', ')+' cannot take a pattern.':'Already on this block.',true);return false;}
  _ptnBusy=true;
  try{
    let batch=writeBatch(db),n=0;
    for(const a of todo){batch.update(doc(db,'articles',a.code),{patternId,updatedAt:now,updatedBy:by});if(++n>=400){await batch.commit();batch=writeBatch(db);n=0;}}
    if(n)await batch.commit();
    todo.forEach(a=>{a.patternId=patternId;a.updatedAt=now;a.updatedBy=by;});
    showToast(todo.length+' article'+(todo.length===1?'':'s')+' assigned to '+p.code+(moved.length?' ('+moved.length+' moved from another block)':'')+(skipped.length?' · skipped '+skipped.join(', '):'')+'.');
    _ptnLog('Articles Assigned To Pattern',p.code+' ← '+todo.map(a=>a.code).join(', '));
    _ptnBusy=false;_ptnBlockQ='';
    if(currentPage==='pattern-block')_ptnBlockRepaint();else if(currentPage==='pattern-unassigned')_ptnQueueRepaint();else _ptnBlocksRepaint();
    return true;
  }catch(e){console.error('[patterns] assign failed',e);showToast('Could not assign: '+(e.message||e),true);_ptnBusy=false;return false;}
};
window.ptnUnassign=async function(code){
  if(!_canManagePatterns()||_ptnBusy)return;
  const a=tacArticles.find(x=>x.code===code);if(!a)return;
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBusy=true;
  try{await updateDoc(doc(db,'articles',code),{patternId:null,updatedAt:now,updatedBy:by});a.patternId=null;showToast(code+' removed from the block.');_ptnLog('Article Unassigned From Pattern',code);}
  catch(e){showToast('Could not remove: '+(e.message||e),true);}
  _ptnBusy=false;_ptnBlockRepaint();
};
window.ptnAssignCluster=async function(i){
  const clusters=_ptnClusters(_ptnUnassigned().filter(a=>a.brand==='groovy'));const c=clusters[i];if(!c)return;
  const sel=document.getElementById('ptn-cl-'+i);const pid=sel&&sel.value;
  if(!pid){showToast('Pick a block first, or make a new one for these.',true);return;}
  await window.ptnAssign(pid,c.articles.map(a=>a.code));
};

// ═══════════════════════════════════════════════════════════════════════════
// M3 — Measurements: editable points of measure with how-to notes, a
//      per-size grid on the block, inches stored, cm viewable, ±0.5 in
// ═══════════════════════════════════════════════════════════════════════════
//
// - POMs live in pom_templates/{id} (top · pant · short · jacket), editable
//   in-app: label, how-to-measure text, optional photo. A block starts from
//   one template (p.pomTemplate) and may add its own points (p.extraPoms).
// - THE GRID IS ON THE BLOCK DOCUMENT (p.grid = {size:{pomKey:inches}}),
//   ~60 numbers, rewritten whole on Save. Inches are the only stored
//   value — a NUMBER, never a string — rounded to quarter inches on save.
//   cm is a per-viewer view (localStorage), converted at render and on
//   input; nothing in cm is ever written.
// - Deleting a POM from a template NEVER deletes recorded data: a grid key
//   that no longer belongs to the template or the block's extras still
//   renders, greyed, until someone clears that row on purpose.
// - Tolerance is one global ±0.5 in (Afnan, Q23). What it is checked
//   AGAINST — a measured sample — is not stored in M3; the grid is the spec.
//   A sample-check that flags out-of-tolerance actuals belongs with
//   revisions (M5). Said on the page so nobody files it as missing.

const _PTN_TOL_IN=0.5;
const _PTN_UNITS_KEY='groovy-ptn-units';
const _PTN_POM_SEED=[
  {id:'top',label:'Tops (tees, shirts, hoodies, sweats)',poms:[
    {key:'chest',label:'Chest',howTo:'Lay flat. Measure straight across 1 inch below the armhole, seam to seam.'},
    {key:'length_hps',label:'Length (HPS)',howTo:'From the high point of the shoulder, beside the neck, straight down to the bottom hem.'},
    {key:'shoulder',label:'Shoulder',howTo:'Across the back, seam to seam, where the sleeves join.'},
    {key:'sleeve_len',label:'Sleeve length',howTo:'From the shoulder seam to the end of the cuff, along the outer edge.'},
    {key:'sleeve_open',label:'Sleeve opening',howTo:'Across the cuff opening, lying flat, edge to edge.'},
    {key:'armhole',label:'Armhole',howTo:'From the shoulder seam straight down to the underarm seam, lying flat.'},
    {key:'neck_width',label:'Neck width',howTo:'Inside edge to inside edge of the neck opening, lying flat.'},
    {key:'neck_drop',label:'Front neck drop',howTo:'From the imaginary line between the high shoulder points down to the front neck seam.'},
    {key:'hem',label:'Bottom hem',howTo:'Across the bottom opening, lying flat, edge to edge.'}
  ]},
  {id:'pant',label:'Pants & trousers',poms:[
    {key:'waist_relaxed',label:'Waist (relaxed)',howTo:'Lay flat. Across the top of the waistband, edge to edge, without stretching.'},
    {key:'waist_stretched',label:'Waist (stretched)',howTo:'Same as relaxed, with the waistband pulled to its full stretch.'},
    {key:'hip',label:'Hip',howTo:'Across the widest point of the seat, lying flat, at the crotch line.'},
    {key:'thigh',label:'Thigh',howTo:'Across one leg, 1 inch below the crotch seam, edge to edge.'},
    {key:'knee',label:'Knee',howTo:'Across one leg at the midpoint of the inseam.'},
    {key:'leg_open',label:'Leg opening',howTo:'Across the bottom of one leg, edge to edge.'},
    {key:'front_rise',label:'Front rise',howTo:'From the crotch seam up to the top of the waistband at the front.'},
    {key:'back_rise',label:'Back rise',howTo:'From the crotch seam up to the top of the waistband at the back.'},
    {key:'inseam',label:'Inseam',howTo:'From the crotch seam down to the bottom of the leg, along the inner seam.'},
    {key:'outseam',label:'Outseam',howTo:'From the top of the waistband down to the bottom of the leg, along the outer seam.'}
  ]},
  {id:'short',label:'Shorts',poms:[
    {key:'waist_relaxed',label:'Waist (relaxed)',howTo:'Lay flat. Across the top of the waistband, edge to edge, without stretching.'},
    {key:'waist_stretched',label:'Waist (stretched)',howTo:'Same as relaxed, with the waistband pulled to its full stretch.'},
    {key:'hip',label:'Hip',howTo:'Across the widest point of the seat, lying flat, at the crotch line.'},
    {key:'thigh',label:'Thigh',howTo:'Across one leg, 1 inch below the crotch seam, edge to edge.'},
    {key:'leg_open',label:'Leg opening',howTo:'Across the bottom of one leg, edge to edge.'},
    {key:'front_rise',label:'Front rise',howTo:'From the crotch seam up to the top of the waistband at the front.'},
    {key:'back_rise',label:'Back rise',howTo:'From the crotch seam up to the top of the waistband at the back.'},
    {key:'inseam',label:'Inseam',howTo:'From the crotch seam down to the bottom of the leg, along the inner seam.'},
    {key:'outseam',label:'Outseam',howTo:'From the top of the waistband down to the bottom of the leg, along the outer seam.'}
  ]},
  {id:'jacket',label:'Jackets & outerwear',poms:[
    {key:'chest',label:'Chest',howTo:'Lay flat, zipped or buttoned. Measure straight across 1 inch below the armhole.'},
    {key:'length_hps',label:'Length (HPS)',howTo:'From the high point of the shoulder straight down to the bottom hem.'},
    {key:'shoulder',label:'Shoulder',howTo:'Across the back, seam to seam, where the sleeves join.'},
    {key:'sleeve_len',label:'Sleeve length',howTo:'From the shoulder seam to the end of the cuff, along the outer edge.'},
    {key:'sleeve_open',label:'Sleeve opening',howTo:'Across the cuff opening, lying flat.'},
    {key:'armhole',label:'Armhole',howTo:'From the shoulder seam straight down to the underarm seam.'},
    {key:'hem',label:'Bottom hem',howTo:'Across the bottom opening, lying flat.'},
    {key:'zip_len',label:'Zip length',howTo:'From the top of the zip tape to the bottom stop.'},
    {key:'placket',label:'Placket width',howTo:'Across the front placket where the zip or buttons sit.'}
  ]}
];

let pomTemplates=[];   // [{id,label,poms:[{key,label,howTo,photoUrl}]}]
let _ptnPomsLoaded=false,_ptnPomsFailed=false,_ptnPomsErr=null;
let _ptnGridDirty=false;     // unsaved grid edits on the open block
let _ptnGridDraft=null;      // {size:{key:'raw input string'}} while editing
let _ptnPomsTplId='top';     // template open on the editor page

// ── Units ─────────────────────────────────────────────────────────────────
function _ptnUnits(){try{const v=localStorage.getItem(_PTN_UNITS_KEY);return v==='cm'?'cm':'in';}catch(e){return'in';}}
function _ptnSetUnits(u){try{localStorage.setItem(_PTN_UNITS_KEY,u==='cm'?'cm':'in');}catch(e){}}
// inches → display string in the current unit
function _ptnFmt(inches,units){
  if(inches==null||inches===''||isNaN(inches))return'';
  units=units||_ptnUnits();
  if(units==='cm')return (Math.round(inches*2.54*10)/10).toString();
  const n=Math.round(inches*4)/4;
  return (n%1===0)?String(n):n.toFixed(2).replace(/0$/,'');
}
// a typed value in the current unit → inches rounded to a quarter, or null
// when it is not a number (flagged by the caller, never thrown)
function _ptnParseIn(raw,units){
  const s=String(raw==null?'':raw).trim().replace(',','.');
  if(!s)return{empty:true};
  const m=/^(\d+(?:\.\d+)?)(?:\s*(?:(\d)\/(\d)))?$/.exec(s);   // 22 · 22.5 · 22 1/2
  let v;
  if(m){v=parseFloat(m[1]);if(m[2]&&m[3]&&Number(m[3]))v+=Number(m[2])/Number(m[3]);}
  else return{bad:true};
  if(!isFinite(v)||v<0)return{bad:true};
  const inches=(units||_ptnUnits())==='cm'?v/2.54:v;
  const q=Math.round(inches*4)/4;
  return{inches:q,rounded:Math.abs(q-inches)>1e-9};
}

// ── Templates ─────────────────────────────────────────────────────────────
async function loadPatternsPoms(){
  _ptnPomsFailed=false;_ptnPomsErr=null;
  try{
    const snap=await getDocs(collection(db,'pom_templates'));
    pomTemplates=snap.docs.map(d=>Object.assign({id:d.id},d.data()));
  }catch(e){_ptnPomsFailed=true;_ptnPomsErr=(e&&(e.message||String(e)))||'read failed';console.warn('[patterns] pom_templates load failed',e);}
  _ptnPomsLoaded=true;
}
function _ptnTemplate(id){return pomTemplates.find(t=>t.id===id)||null;}
// Which template a block should start from, guessed from its category.
function _ptnGuessTemplate(prefix){
  if(['GST','GC','GD','GJO','AST','AD','CC','CD'].indexOf(prefix)>-1)return'pant';
  if(['GSO','ASO'].indexOf(prefix)>-1)return'short';
  if(['GO'].indexOf(prefix)>-1)return'jacket';
  return'top';
}
function _ptnKeyFromLabel(label){return String(label||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40)||'pom';}
// The rows a block's grid shows: template POMs, then the block's own
// extras, then any grid key belonging to neither — orphaned by a template
// edit — kept and marked, never dropped.
function _ptnRowsFor(p){
  const tpl=_ptnTemplate(p.pomTemplate||'')||{poms:[]};
  const rows=[];const seen=new Set();
  (tpl.poms||[]).forEach(m=>{if(m&&m.key&&!seen.has(m.key)){seen.add(m.key);rows.push({key:m.key,label:m.label||m.key,howTo:m.howTo||'',photoUrl:m.photoUrl||'',src:'template'});}});
  (p.extraPoms||[]).forEach(m=>{if(m&&m.key&&!seen.has(m.key)){seen.add(m.key);rows.push({key:m.key,label:m.label||m.key,howTo:m.howTo||'',photoUrl:'',src:'extra'});}});
  const grid=p.grid||{};
  Object.keys(grid).forEach(size=>{Object.keys(grid[size]||{}).forEach(k=>{if(!seen.has(k)){seen.add(k);rows.push({key:k,label:k,howTo:'',photoUrl:'',src:'orphan'});}});});
  return rows;
}
function _ptnGridFilled(p){
  const rows=_ptnRowsFor(p).filter(r=>r.src!=='orphan');const sizes=p.sizes||[];const g=p.grid||{};
  let n=0;rows.forEach(r=>sizes.forEach(s=>{const v=g[s]&&g[s][r.key];if(typeof v==='number')n++;}));
  return{filled:n,total:rows.length*sizes.length};
}

// ── The grid card on the block page ───────────────────────────────────────
function _ptnGridCardHTML(p){
  const can=_canManagePatterns();
  const units=_ptnUnits();
  if(_ptnPomsFailed)return`<div class="card"><div class="card-title">Measurements</div><div class="board-load-error" id="ptn-poms-failed">The points of measure (<code>pom_templates</code>) did not load: ${_ptnEsc(_ptnPomsErr||'')}. If that says <em>missing or insufficient permissions</em>, republish <code>firestore.rules</code>. <button class="btn-sm" onclick="window.ptnRetryLoad()">Retry</button></div></div>`;
  if(!pomTemplates.length)return`<div class="card"><div class="card-title">Measurements</div><div class="empty" id="ptn-poms-none">No points of measure yet. ${can?`<button class="btn-sm" onclick="window.ptnSeedPoms()">Seed the four templates</button> (tops · pants · shorts · jackets — editable afterwards)`:'An admin has to seed the templates first.'}</div></div>`;
  const rows=_ptnRowsFor(p);const sizes=p.sizes||[];
  const tpl=_ptnTemplate(p.pomTemplate||'');
  const draft=_ptnGridDraft;
  const cell=(r,s)=>{
    const stored=p.grid&&p.grid[s]?p.grid[s][r.key]:undefined;
    const raw=draft&&draft[s]&&draft[s][r.key]!==undefined?draft[s][r.key]:_ptnFmt(stored,units);
    const bad=draft&&draft[s]&&draft[s][r.key]!==undefined&&draft[s][r.key]!==''&&_ptnParseIn(draft[s][r.key],units).bad;
    return can?`<td style="padding:3px"><input class="ptn-cell${bad?' ptn-cell-bad':''}" data-size="${_ptnEsc(s)}" data-key="${_ptnEsc(r.key)}" value="${_ptnEsc(raw)}" inputmode="decimal" oninput="window.ptnGridInput(this)" style="width:64px;padding:6px 6px;border:1px solid ${bad?'var(--accent-urgent)':'var(--border)'};border-radius:6px;font-family:inherit;font-size:13px;text-align:right;background:var(--surface-2);color:var(--text)"${bad?' title="Not a number — will be left blank"':''}></td>`
      :`<td style="padding:6px 8px;text-align:right">${_ptnEsc(_ptnFmt(stored,units))||'<span style="color:var(--muted)">—</span>'}</td>`;
  };
  const f=_ptnGridFilled(p);
  return`<div class="card" id="ptn-grid-card">
    <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span>Measurements <span style="font-weight:400;color:var(--muted);font-size:11px">${f.filled} of ${f.total} filled · all points ±${_PTN_TOL_IN} in</span></span>
      <span style="display:flex;gap:6px;align-items:center"><button class="btn-sm" id="ptn-units" onclick="window.ptnToggleUnits()">${units==='cm'?'Showing cm · switch to inches':'Showing inches · switch to cm'}</button></span></div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Template: <b>${_ptnEsc(tpl?tpl.label:(p.pomTemplate||'none'))}</b>${can?` <button class="btn-sm" onclick="window.showPage('pattern-poms')">Edit points of measure</button> <button class="btn-sm" onclick="window.ptnAddExtraPom('${_ptnEsc(p.id)}')">+ Point for this block only</button>`:''}</div>
    ${rows.length&&sizes.length?`<div style="overflow:auto"><table class="ptn-grid" style="border-collapse:collapse;font-size:13px;min-width:100%"><thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase"><th style="padding:6px 8px;position:sticky;left:0;background:var(--surface)">Point of measure</th>${sizes.map(s=>`<th style="padding:6px 8px;text-align:right">${_ptnEsc(s)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r=>`<tr class="ptn-grid-row" data-key="${_ptnEsc(r.key)}" style="border-top:1px solid var(--border);${r.src==='orphan'?'opacity:.6':''}"><td style="padding:6px 8px;position:sticky;left:0;background:var(--surface);white-space:nowrap"><b>${_ptnEsc(r.label)}</b>${r.src==='extra'?' <span class="badge" style="font-size:9.5px">this block</span>':''}${r.src==='orphan'?` <span style="color:var(--accent-warning);font-size:11px">no longer in the template</span>${can?` <button class="btn-sm" onclick="window.ptnClearRow('${_ptnEsc(p.id)}','${_ptnEsc(r.key)}')">clear</button>`:''}`:''}${r.howTo?`<div style="font-size:11px;color:var(--muted);white-space:normal;max-width:260px">${_ptnEsc(r.howTo)}${r.photoUrl?` <a href="${_ptnEsc(r.photoUrl)}" target="_blank" rel="noopener">photo</a>`:''}</div>`:''}${r.src==='extra'&&can?` <button class="btn-sm" onclick="window.ptnRemoveExtraPom('${_ptnEsc(p.id)}','${_ptnEsc(r.key)}')" title="Remove this point from the block (its numbers are kept until cleared)">×</button>`:''}</td>${sizes.map(s=>cell(r,s)).join('')}</tr>`).join('')}</tbody></table></div>`
      :'<div class="empty">No sizes on this block yet — edit the block and tick the sizes in the bundle.</div>'}
    ${can?`<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn-primary" id="ptn-grid-save" ${_ptnBusy||!_ptnGridDirty?'disabled':''} onclick="window.ptnSaveGrid('${_ptnEsc(p.id)}')">Save measurements</button><span id="ptn-grid-status" style="font-size:12px;color:var(--muted)">${_ptnGridDirty?'Unsaved changes':('Values are '+(units==='cm'?'cm (stored as inches)':'inches')+' · quarter-inch steps · type 22.5 or 22 1/2')}</span></div>`:''}
    <div style="font-size:11px;color:var(--muted);margin-top:8px">The grid is the spec. Checking a sewn sample against it (and flagging anything past ±${_PTN_TOL_IN} in) comes with revisions in M5.</div>
  </div>`;
}
window.ptnToggleUnits=function(){_ptnSetUnits(_ptnUnits()==='cm'?'in':'cm');if(_ptnGridDirty){showToast('Save or clear your unsaved measurements before switching units.',true);return;}_ptnBlockRepaint();};
window.ptnGridInput=function(el){
  const s=el.getAttribute('data-size'),k=el.getAttribute('data-key');
  if(!_ptnGridDraft)_ptnGridDraft={};
  (_ptnGridDraft[s]=_ptnGridDraft[s]||{})[k]=String(el.value||'');
  _ptnGridDirty=true;
  const bad=el.value!==''&&_ptnParseIn(el.value).bad;
  el.style.borderColor=bad?'var(--accent-urgent)':'var(--border)';
  if(el.classList){el.classList.toggle('ptn-cell-bad',!!bad);}
  const b=document.getElementById('ptn-grid-save');if(b)b.disabled=false;
  const st=document.getElementById('ptn-grid-status');if(st)st.textContent='Unsaved changes';
};
// Save: every draft cell parsed in the CURRENT unit, stored as inches
// rounded to a quarter; a cell that is not a number is left as it was and
// named in the toast (flagged, never rejected — the M4 cell lesson).
function _ptnMergeGrid(p,draft,units){
  const grid=JSON.parse(JSON.stringify(p.grid||{}));
  const bad=[],rounded=[];let changed=0;
  Object.keys(draft||{}).forEach(s=>{
    Object.keys(draft[s]).forEach(k=>{
      const r=_ptnParseIn(draft[s][k],units);
      if(r.bad){bad.push(s+' '+k);return;}
      grid[s]=grid[s]||{};
      if(r.empty){if(grid[s][k]!==undefined){delete grid[s][k];changed++;}if(!Object.keys(grid[s]).length)delete grid[s];return;}
      if(grid[s][k]!==r.inches){grid[s][k]=r.inches;changed++;}
      if(r.rounded)rounded.push(s+' '+k);
    });
  });
  return{grid,bad,rounded,changed};
}
window.ptnSaveGrid=async function(id){
  if(!_canManagePatterns()||_ptnBusy)return false;
  const p=_ptnBlock(id);if(!p)return false;
  const {grid,bad,rounded,changed}=_ptnMergeGrid(p,_ptnGridDraft||{},_ptnUnits());
  if(!changed&&!bad.length){_ptnGridDirty=false;_ptnGridDraft=null;_ptnBlockRepaint();return true;}
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBusy=true;
  try{
    await updateDoc(doc(db,'patterns',id),{grid,gridUpdatedAt:now,updatedAt:now,updatedBy:by});
    p.grid=grid;p.gridUpdatedAt=now;
    _ptnGridDirty=false;_ptnGridDraft=null;
    showToast('Saved '+changed+' measurement'+(changed===1?'':'s')+(rounded.length?' · '+rounded.length+' rounded to the nearest ¼ in':'')+(bad.length?' · left blank (not a number): '+bad.join(', '):'')+'.',!!bad.length);
    _ptnLog('Measurements Saved',p.code+' — '+changed+' cells');
    _ptnBusy=false;_ptnBlockRepaint();return true;
  }catch(e){console.error('[patterns] grid save failed',e);showToast('Could not save: '+(e.message||e),true);_ptnBusy=false;_ptnBlockRepaint();return false;}
};
window.ptnClearRow=async function(id,key){
  if(!_canManagePatterns()||_ptnBusy)return;
  const p=_ptnBlock(id);if(!p)return;
  if(typeof confirm==='function'&&!confirm('Clear every "'+key+'" value on '+p.code+'? This point is no longer in the template; its numbers go for good.'))return;
  const grid=JSON.parse(JSON.stringify(p.grid||{}));
  Object.keys(grid).forEach(s=>{delete grid[s][key];if(!Object.keys(grid[s]).length)delete grid[s];});
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBusy=true;
  try{await updateDoc(doc(db,'patterns',id),{grid,updatedAt:now,updatedBy:by});p.grid=grid;showToast('Cleared "'+key+'".');}
  catch(e){showToast('Could not clear: '+(e.message||e),true);}
  _ptnBusy=false;_ptnBlockRepaint();
};
window.ptnAddExtraPom=async function(id){
  if(!_canManagePatterns()||_ptnBusy)return;
  const p=_ptnBlock(id);if(!p)return;
  const label=typeof prompt==='function'?String(prompt('Name of the point of measure (for this block only):','')||'').trim():'';
  if(!label)return;
  const howTo=typeof prompt==='function'?String(prompt('How to measure it (one or two lines):','')||'').trim():'';
  const key=_ptnKeyFromLabel(label);
  if(_ptnRowsFor(p).some(r=>r.key===key)){showToast('A point called "'+label+'" is already on this block.',true);return;}
  const extraPoms=(p.extraPoms||[]).concat([{key,label,howTo}]);
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBusy=true;
  try{await updateDoc(doc(db,'patterns',id),{extraPoms,updatedAt:now,updatedBy:by});p.extraPoms=extraPoms;showToast('Added "'+label+'" to '+p.code+'.');}
  catch(e){showToast('Could not add: '+(e.message||e),true);}
  _ptnBusy=false;_ptnBlockRepaint();
};
window.ptnRemoveExtraPom=async function(id,key){
  if(!_canManagePatterns()||_ptnBusy)return;
  const p=_ptnBlock(id);if(!p)return;
  const extraPoms=(p.extraPoms||[]).filter(m=>m.key!==key);
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBusy=true;
  try{await updateDoc(doc(db,'patterns',id),{extraPoms,updatedAt:now,updatedBy:by});p.extraPoms=extraPoms;showToast('Removed the point; any numbers it held stay until you clear them.');}
  catch(e){showToast('Could not remove: '+(e.message||e),true);}
  _ptnBusy=false;_ptnBlockRepaint();
};

// ── Template editor page ──────────────────────────────────────────────────
function renderPatternPoms(){
  if(!_canSeePatternHub())return'<div class="empty">The Pattern Hub is in a test phase — Afnan, Ammar, Mustafa and Uzaib.</div>';
  return`<div id="pattern-poms-root">${_ptnPomsHTML()}</div>`;
}
function _ptnPomsRepaint(){const r=document.getElementById('pattern-poms-root');if(r)r.innerHTML=_ptnPomsHTML();}
function _ptnPomsHTML(){
  const head=`<button class="back-btn" onclick="window.showPage('pattern-blocks')">← Patterns</button>
  <div class="page-head" style="margin-bottom:10px"><div><h2 style="margin:0">Points of measure</h2><div style="color:var(--muted);font-size:12px;margin-top:2px">What gets measured on each kind of block, and how. Deleting a point never deletes numbers already recorded on a block.</div></div></div>`;
  if(_ptnPomsFailed)return head+`<div class="board-load-error" id="ptn-poms-failed">pom_templates: ${_ptnEsc(_ptnPomsErr||'')}. If that says <em>missing or insufficient permissions</em>, republish <code>firestore.rules</code>. <button class="btn-sm" onclick="window.ptnRetryLoad()">Retry</button></div>`;
  const can=_canManagePatterns();
  if(!pomTemplates.length)return head+`<div class="empty" id="ptn-poms-none">No templates yet. ${can?`<button class="btn-primary" onclick="window.ptnSeedPoms()">Seed the four templates</button>`:''}</div>`;
  if(!_ptnTemplate(_ptnPomsTplId))_ptnPomsTplId=pomTemplates[0].id;
  const t=_ptnTemplate(_ptnPomsTplId);
  const tabs=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${pomTemplates.map(x=>`<button class="btn-sm" style="${x.id===t.id?'background:var(--dark);color:var(--on-dark);border-color:var(--dark)':''}" onclick="window.ptnPomsTab('${_ptnEsc(x.id)}')">${_ptnEsc(x.label||x.id)} <span style="opacity:.7">${(x.poms||[]).length}</span></button>`).join('')}</div>`;
  const used=patterns.filter(p=>p.pomTemplate===t.id&&p.status!=='retired').length;
  const rows=(t.poms||[]).map((m,i)=>`<tr class="ptn-pom-row" data-key="${_ptnEsc(m.key)}" style="border-top:1px solid var(--border)">
    <td style="padding:6px 8px;white-space:nowrap;color:var(--muted);font-size:11px">${i+1}</td>
    <td style="padding:6px 8px">${can?`<input id="ptn-pom-label-${i}" value="${_ptnEsc(m.label||'')}" style="width:100%;min-width:140px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface-2);color:var(--text)">`:`<b>${_ptnEsc(m.label||'')}</b>`}<div style="font-size:10px;color:var(--muted)">${_ptnEsc(m.key)}</div></td>
    <td style="padding:6px 8px;min-width:260px">${can?`<textarea id="ptn-pom-how-${i}" rows="2" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:12px;background:var(--surface-2);color:var(--text)">${_ptnEsc(m.howTo||'')}</textarea>`:`<div style="font-size:12px">${_ptnEsc(m.howTo||'')}</div>`}</td>
    <td style="padding:6px 8px;white-space:nowrap">${m.photoUrl?`<a href="${_ptnEsc(m.photoUrl)}" target="_blank" rel="noopener"><img src="${_ptnEsc(m.photoUrl)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--border)"></a>`:'<span style="color:var(--muted);font-size:11px">no photo</span>'}${can?`<div><label class="btn-sm" style="cursor:pointer;display:inline-block;margin-top:4px">${m.photoUrl?'Replace':'Add photo'}<input type="file" accept="image/*" style="display:none" onchange="window.ptnPomPhoto('${_ptnEsc(t.id)}',${i},this)"></label>${m.photoUrl?` <button class="btn-sm" onclick="window.ptnPomPhotoClear('${_ptnEsc(t.id)}',${i})">remove</button>`:''}</div>`:''}</td>
    <td style="padding:6px 8px;white-space:nowrap;text-align:right">${can?`<button class="btn-sm" onclick="window.ptnPomMove('${_ptnEsc(t.id)}',${i},-1)" ${i===0?'disabled':''}>↑</button> <button class="btn-sm" onclick="window.ptnPomMove('${_ptnEsc(t.id)}',${i},1)" ${i===(t.poms||[]).length-1?'disabled':''}>↓</button> <button class="btn-sm" onclick="window.ptnPomDelete('${_ptnEsc(t.id)}',${i})">Delete</button>`:''}</td></tr>`).join('');
  return head+tabs+`<div class="card" style="padding:0;overflow:auto"><div style="padding:10px 12px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border)">Used by <b>${used}</b> block${used===1?'':'s'}. ${can?'Edit labels and how-to text in place, then Save.':''}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase"><th style="padding:8px"></th><th style="padding:8px">Point</th><th style="padding:8px">How to measure</th><th style="padding:8px">Photo</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">No points yet.</td></tr>'}</tbody></table>
    ${can?`<div style="padding:10px 12px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border)"><button class="btn-sm" onclick="window.ptnPomAdd('${_ptnEsc(t.id)}')">+ Add a point</button><button class="btn-primary" ${_ptnBusy?'disabled':''} onclick="window.ptnPomsSave('${_ptnEsc(t.id)}')">Save template</button></div>`:''}</div>`;
}
window.ptnPomsTab=function(id){_ptnPomsTplId=id;_ptnPomsRepaint();};
function _ptnReadTemplateForm(t){
  const poms=(t.poms||[]).map((m,i)=>{
    const l=document.getElementById('ptn-pom-label-'+i),h=document.getElementById('ptn-pom-how-'+i);
    return Object.assign({},m,{label:l?String(l.value||'').trim()||m.label:m.label,howTo:h?String(h.value||'').trim():m.howTo||''});
  });
  return poms;
}
async function _ptnWriteTemplate(t,poms,toastMsg){
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBusy=true;
  try{
    await setDoc(doc(db,'pom_templates',t.id),{id:t.id,label:t.label||t.id,poms,updatedAt:now,updatedBy:by},{merge:true});
    t.poms=poms;t.updatedAt=now;
    if(toastMsg)showToast(toastMsg);
    _ptnBusy=false;return true;
  }catch(e){console.error('[patterns] template save failed',e);showToast('Could not save the template: '+(e.message||e),true);_ptnBusy=false;return false;}
}
window.ptnPomsSave=async function(id){
  if(!_canManagePatterns()||_ptnBusy)return;
  const t=_ptnTemplate(id);if(!t)return;
  const poms=_ptnReadTemplateForm(t);
  if(poms.some(m=>!m.label)){showToast('Every point needs a label.',true);return;}
  if(await _ptnWriteTemplate(t,poms,'Saved '+(t.label||t.id)+'.'))_ptnLog('POM Template Saved',t.id+' — '+poms.length+' points');
  _ptnPomsRepaint();
};
window.ptnPomAdd=async function(id){
  if(!_canManagePatterns()||_ptnBusy)return;
  const t=_ptnTemplate(id);if(!t)return;
  const label=typeof prompt==='function'?String(prompt('Name of the new point of measure:','')||'').trim():'';
  if(!label)return;
  let key=_ptnKeyFromLabel(label);
  const keys=new Set((t.poms||[]).map(m=>m.key));let n=2;const base=key;while(keys.has(key))key=base+'_'+(n++);
  const poms=_ptnReadTemplateForm(t).concat([{key,label,howTo:''}]);
  if(await _ptnWriteTemplate(t,poms,'Added "'+label+'".'))_ptnLog('POM Added',t.id+' — '+label);
  _ptnPomsRepaint();
};
// Delete removes the ROW from the template only. Every block that recorded
// a number for it keeps that number (rendered as "no longer in the
// template") until someone clears it on that block. Said in the confirm.
window.ptnPomDelete=async function(id,i){
  if(!_canManagePatterns()||_ptnBusy)return;
  const t=_ptnTemplate(id);if(!t||!t.poms||!t.poms[i])return;
  const m=t.poms[i];
  const holders=patterns.filter(p=>p.pomTemplate===id&&Object.keys(p.grid||{}).some(s=>p.grid[s]&&p.grid[s][m.key]!==undefined)).length;
  if(typeof confirm==='function'&&!confirm('Delete "'+m.label+'" from this template? '+(holders?holders+' block'+(holders===1?' has':'s have')+' numbers for it — those are KEPT and shown as "no longer in the template" until cleared.':'No block has numbers for it yet.')))return;
  const poms=_ptnReadTemplateForm(t).filter((x,j)=>j!==i);
  if(await _ptnWriteTemplate(t,poms,'Deleted "'+m.label+'" from the template. Recorded numbers were kept.'))_ptnLog('POM Deleted',t.id+' — '+m.label);
  _ptnPomsRepaint();
};
window.ptnPomMove=async function(id,i,dir){
  if(!_canManagePatterns()||_ptnBusy)return;
  const t=_ptnTemplate(id);if(!t)return;
  const poms=_ptnReadTemplateForm(t);const j=i+dir;if(j<0||j>=poms.length)return;
  const tmp=poms[i];poms[i]=poms[j];poms[j]=tmp;
  await _ptnWriteTemplate(t,poms,null);_ptnPomsRepaint();
};
window.ptnPomPhoto=async function(id,i,input){
  if(!_canManagePatterns()||_ptnBusy)return;
  const t=_ptnTemplate(id);const file=input&&input.files&&input.files[0];if(!t||!file)return;
  if(typeof uploadToCloudinary!=='function'){showToast('Upload helper not loaded — refresh the page.',true);return;}
  _ptnBusy=true;_ptnPomsRepaint();
  let url;
  try{url=await uploadToCloudinary(file);}catch(e){showToast('Upload failed: '+(e.message||e),true);_ptnBusy=false;_ptnPomsRepaint();return;}
  _ptnBusy=false;
  const poms=_ptnReadTemplateForm(t);if(poms[i])poms[i]=Object.assign({},poms[i],{photoUrl:url});
  await _ptnWriteTemplate(t,poms,'Photo added.');_ptnPomsRepaint();
};
window.ptnPomPhotoClear=async function(id,i){
  if(!_canManagePatterns()||_ptnBusy)return;
  const t=_ptnTemplate(id);if(!t)return;
  const poms=_ptnReadTemplateForm(t);if(poms[i]){poms[i]=Object.assign({},poms[i]);delete poms[i].photoUrl;}
  await _ptnWriteTemplate(t,poms,'Photo removed.');_ptnPomsRepaint();
};
// Seed the four templates — only the ones missing, never over an edited one.
window.ptnSeedPoms=async function(){
  if(!_canManagePatterns()||_ptnBusy)return;
  if(_ptnPomsFailed){showToast('pom_templates did not load — cannot tell what exists. Retry first.',true);return;}
  const have=new Set(pomTemplates.map(t=>t.id));
  const missing=_PTN_POM_SEED.filter(t=>!have.has(t.id));
  if(!missing.length){showToast('All four templates already exist.');return;}
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBusy=true;
  try{
    const batch=writeBatch(db);
    missing.forEach(t=>batch.set(doc(db,'pom_templates',t.id),{id:t.id,label:t.label,poms:t.poms.map(m=>Object.assign({},m)),createdAt:now,createdBy:by,updatedAt:now,updatedBy:by}));
    await batch.commit();
    missing.forEach(t=>pomTemplates.push({id:t.id,label:t.label,poms:t.poms.map(m=>Object.assign({},m))}));
    showToast('Seeded '+missing.length+' template'+(missing.length===1?'':'s')+'.');_ptnLog('POM Templates Seeded',missing.map(t=>t.id).join(', '));
  }catch(e){console.error('[patterns] seed templates failed',e);showToast('Seed failed: '+(e.message||e),true);}
  _ptnBusy=false;
  if(currentPage==='pattern-poms')_ptnPomsRepaint();else _ptnBlockRepaint();
};

// ═══════════════════════════════════════════════════════════════════════════
// M4 — The 5 × 6 in label, one per SIZE in the bundle, operator-selected
// ═══════════════════════════════════════════════════════════════════════════
//
// Each traced sheet in a bundle gets its own sticker (Afnan, Q24): the
// block's identity, its home, the articles using it, THIS size's
// measurements, and a QR that deep-links to the block (#pattern=<id>).
// The engine's shared components are A4 by construction, so the
// `pattern-label` variant draws its own layout on a custom page and the
// QR is handed over as a matrix built here with the vendored
// qrcode-generator — the engine never learns about the library.
// `labelPrinted[size] = {at}` on the block records the last print; a label
// whose block, grid, home or article list changed since reads "reprint".

const _PTN_LABEL_PAGE={w:360,h:432};      // 5 × 6 in at 72 pt/in, portrait
const _PTN_LABEL_MAX_ARTICLES=12;
let _ptnLabelSel=new Set();               // blocks ticked on the rack page

function _ptnAppUrl(){try{return String(location.origin||'')+String(location.pathname||'/');}catch(e){return'/';}}
function _ptnBlockUrl(p){return _ptnAppUrl()+'#pattern='+encodeURIComponent(p.id);}
function _ptnQrMatrix(text){
  if(typeof qrcode!=='function')return null;
  try{
    const q=qrcode(0,'M');q.addData(String(text));q.make();
    const n=q.getModuleCount();const m=[];
    for(let r=0;r<n;r++){const row=[];for(let c=0;c<n;c++)row.push(!!q.isDark(r,c));m.push(row);}
    return m;
  }catch(e){console.warn('[patterns] QR failed',e);return null;}
}
// Everything one label needs, from one block and one size.
function _ptnLabelData(p,size){
  const cat=_ptnCategory(p.category);
  const arts=_ptnArticlesOf(p.id).map(a=>a.code).sort();
  const rows=(typeof _ptnRowsFor==='function'?_ptnRowsFor(p):[]).filter(r=>r.src!=='orphan');
  const g=(p.grid&&p.grid[size])||{};
  const measurements=rows.filter(r=>typeof g[r.key]==='number').map(r=>({label:r.label,value:_ptnFmt(g[r.key],'in')}));
  const url=_ptnBlockUrl(p);
  return{
    id:p.id,code:p.code,name:p.name||'',category:cat?cat.label:(p.category||''),fit:p.fit||'',
    size,sizes:p.sizes||[],hook:p.hook||null,slot:p.slot||null,
    articles:arts.slice(0,_PTN_LABEL_MAX_ARTICLES),more:Math.max(0,arts.length-_PTN_LABEL_MAX_ARTICLES),
    measurements,url,qr:_ptnQrMatrix(url),
    printedOn:new Date().toISOString().slice(0,10),
    gridUpdated:p.gridUpdatedAt?String(p.gridUpdatedAt).slice(0,10):'',
    tol:_PTN_TOL_IN
  };
}
// Has anything on the label changed since this size was last printed?
function _ptnLabelStatus(p,size){
  const rec=p.labelPrinted&&p.labelPrinted[size];
  if(!rec||!rec.at)return{state:'never'};
  const at=String(rec.at);
  let changed=false;
  if(p.updatedAt&&String(p.updatedAt)>at)changed=true;
  if(!changed)changed=_ptnArticlesOf(p.id).some(a=>a.updatedAt&&String(a.updatedAt)>at);
  return{state:changed?'stale':'current',at};
}
function _ptnLabelCardHTML(p){
  const can=_canManagePatterns();
  const sizes=p.sizes||[];
  if(!sizes.length)return'';
  const rows=sizes.map(s=>{const st=_ptnLabelStatus(p,s);
    const txt=st.state==='never'?'<span style="color:var(--muted)">never printed</span>':st.state==='stale'?`<span style="color:var(--accent-warning);font-weight:600">reprint — changed since ${_ptnEsc(String(st.at).slice(0,10))}</span>`:`<span style="color:var(--green)">printed ${_ptnEsc(String(st.at).slice(0,10))}</span>`;
    return`<label class="ptn-label-row" data-size="${_ptnEsc(s)}" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--border);font-size:13px">${can?`<input type="checkbox" class="ptn-label-size" value="${_ptnEsc(s)}" ${st.state!=='current'?'checked':''}>`:''}<b style="min-width:44px">${_ptnEsc(s)}</b>${txt}</label>`;}).join('');
  return`<div class="card" id="ptn-label-card" style="margin-top:14px"><div class="card-title">Labels <span style="font-weight:400;color:var(--muted);font-size:11px">5 × 6 in · one sticker per size in the bundle · ${typeof qrcode==='function'?'with a QR to this page':'<span style="color:var(--accent-warning)">QR library not loaded — labels print without a QR</span>'}</span></div>
    ${rows}
    ${can?`<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn-primary" ${_ptnBusy?'disabled':''} onclick="window.ptnPrintBlockLabels('${_ptnEsc(p.id)}','selected')">Print ticked</button><button class="btn-sm" ${_ptnBusy?'disabled':''} onclick="window.ptnPrintBlockLabels('${_ptnEsc(p.id)}','all')">Print all ${sizes.length}</button><span style="font-size:11px;color:var(--muted)">Sizes never printed or changed since are ticked for you.</span></div>`:''}
  </div>`;
}
window.ptnPrintBlockLabels=function(id,which){
  const p=_ptnBlock(id);if(!p)return;
  let sizes=p.sizes||[];
  if(which==='selected'){
    const picked=[];const boxes=(document.querySelectorAll?document.querySelectorAll('.ptn-label-size'):[])||[];
    boxes.forEach(el=>{if(el.checked)picked.push(el.value);});
    sizes=sizes.filter(s=>picked.indexOf(s)>-1);
  }
  if(!sizes.length){showToast('Tick at least one size.',true);return;}
  return window.ptnPrintLabels([{id,sizes}]);
};
// Print: one PDF, one page per (block, size), then record the print on
// each block — one update per block, never one per size.
window.ptnPrintLabels=async function(items){
  if(!_canSeePatternHub())return false;
  if(typeof window.printDocument!=='function'){showToast('The print engine did not load — refresh and try again.',true);return false;}
  const labels=[],perBlock=[];
  (items||[]).forEach(it=>{
    const p=_ptnBlock(it.id);if(!p)return;
    const sizes=(it.sizes&&it.sizes.length?it.sizes:(p.sizes||[])).filter(s=>(p.sizes||[]).indexOf(s)>-1);
    if(!sizes.length)return;
    sizes.forEach(s=>labels.push(_ptnLabelData(p,s)));
    perBlock.push({p,sizes});
  });
  if(!labels.length){showToast('Nothing to print — pick a block with sizes.',true);return false;}
  const date=new Date().toISOString().slice(0,10);
  const one=perBlock.length===1?perBlock[0].p.code:perBlock.length+'-blocks';
  try{
    await window.printDocument({type:'pattern-label',filename:'labels-'+one+'-'+date+'.pdf',data:{page:_PTN_LABEL_PAGE,labels,urduLevel:'none',documentNumber:one,documentType:'Pattern Label'}});
  }catch(e){console.error('[patterns] label print failed',e);showToast('Could not print: '+(e.message||e),true);return false;}
  // record — best effort; a failed record must not undo a print that happened
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  if(_canManagePatterns()){
    for(const {p,sizes} of perBlock){
      const labelPrinted=Object.assign({},p.labelPrinted||{});
      sizes.forEach(s=>{labelPrinted[s]={at:now,by};});
      try{await updateDoc(doc(db,'patterns',p.id),{labelPrinted});p.labelPrinted=labelPrinted;}
      catch(e){console.warn('[patterns] could not record the print',e);}
    }
  }
  showToast('Printed '+labels.length+' label'+(labels.length===1?'':'s')+'.');
  _ptnLog('Pattern Labels Printed',labels.length+' — '+perBlock.map(x=>x.p.code+' ('+x.sizes.join(' ')+')').join(', '));
  if(currentPage==='pattern-block')_ptnBlockRepaint();else if(currentPage==='pattern-blocks')_ptnBlocksRepaint();
  return true;
};
// Rack page: tick blocks, print every size of each.
window.ptnLabelToggle=function(id,on){if(on)_ptnLabelSel.add(id);else _ptnLabelSel.delete(id);const bar=document.getElementById('ptn-label-bar');if(bar)bar.innerHTML=_ptnLabelBarInner();};
function _ptnLabelBarInner(){
  const n=_ptnLabelSel.size;
  if(!n)return'<span style="font-size:12px;color:var(--muted)">Tick blocks to print their labels — every size in each bundle.</span>';
  return`<span style="font-size:12px"><b>${n}</b> block${n===1?'':'s'} ticked</span> <button class="btn-primary" onclick="window.ptnPrintSelectedBlocks()">Print labels</button> <button class="btn-sm" onclick="window.ptnLabelClear()">Clear</button>`;
}
window.ptnLabelClear=function(){_ptnLabelSel=new Set();_ptnBlocksRepaint();};
window.ptnPrintSelectedBlocks=function(){
  const items=Array.from(_ptnLabelSel).map(id=>({id,sizes:null}));
  if(!items.length){showToast('Tick at least one block.',true);return;}
  return window.ptnPrintLabels(items).then(ok=>{if(ok){_ptnLabelSel=new Set();}});
};

// ── Deep link: #pattern=<id> ──────────────────────────────────────────────
// The QR on every label points here. Consumed after startApp (a link
// opened cold, once auth has resolved) and on hashchange (pasted into an
// open tab) — the js/boards.js pattern, wrapping the global rather than
// editing js/auth.js. Gated on the same audience as the nav; a deep link
// is navigation and must not be a side door.
function _ptnParseHash(){
  const h=(typeof location!=='undefined'&&location.hash)||'';
  const m=/^#pattern=([A-Za-z0-9_\-]+)/.exec(h);
  return m?{id:decodeURIComponent(m[1])}:null;
}
function _ptnConsumeDeepLink(){
  const link=_ptnParseHash();
  if(!link||typeof session==='undefined'||!session)return false;
  if(!_canSeePatternHub())return false;
  if(currentPage==='pattern-block'&&_ptnBlockId===link.id)return false;
  _ptnBlockId=link.id;_ptnBlockQ='';_ptnGridDraft=null;_ptnGridDirty=false;
  window.showPage('pattern-block');
  return true;
}
if(typeof window.addEventListener==='function')window.addEventListener('hashchange',()=>{try{_ptnConsumeDeepLink();}catch(e){console.warn('[patterns] deep link failed',e);}});
const _ptnOrigStartApp=window.startApp;
if(typeof _ptnOrigStartApp==='function'){
  window.startApp=async function(){
    const out=await _ptnOrigStartApp.apply(this,arguments);
    try{_ptnConsumeDeepLink();}catch(e){console.warn('[patterns] deep link failed:',e);}
    return out;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// M5 — Revisions and the cutting notice
// ═══════════════════════════════════════════════════════════════════════════
//
// Editing the grid (M3) is silent and always was: entering ~8,000 numbers
// for the first time must not page anyone. A REVISION is an explicit act —
// "Record a revision", a one-line reason — and THAT is what tells cutting
// what moved, with the before/after of every changed cell attached.
//
// - patterns/{id}/revisions/{n} is APPEND-ONLY (rules: update/delete false),
//   like fabric_movements and the board activity feed. Each revision keeps
//   a FULL `snapshot` of the grid, so the next diff is against the record
//   itself rather than a baseline field that could drift from it. ~60
//   numbers; the honesty is worth the bytes.
// - The first revision has no prior snapshot, so every value reads as new.
//   That is not noise — it is cutting being told the spec exists — and it
//   avoids a special case that would need its own correctness argument.
// - pattern_notices/{id} carries a SNAPSHOT of the article codes affected.
//   Deriving them live would silently rewrite history every time an
//   article is reassigned; the notice records what cutting acted on.
// - The bell is the existing one (hrm_notifications, addressed by
//   forUser), exactly as Marketing M5 does — js/hrm.js needs no change.
//   Deterministic ids, and a notification is never re-raised.

let patternRevisions={};      // patternId → [{n,…}] newest first, loaded per block
let patternNotices=[];
let _ptnNoticesLoaded=false,_ptnNoticesFailed=false,_ptnNoticesErr=null;
let _ptnRevBusy=false;
let _ptnNoticeTab='open';

// ── Diffing two grids ─────────────────────────────────────────────────────
// Returns only the cells that differ: {size:{key:{from,to}}} plus a count.
// `from`/`to` are inches or null (null = the cell was empty / was cleared).
function _ptnGridDiff(before,after){
  const out={};let count=0;
  const sizes=new Set(Object.keys(before||{}).concat(Object.keys(after||{})));
  sizes.forEach(s=>{
    const b=(before&&before[s])||{},a=(after&&after[s])||{};
    const keys=new Set(Object.keys(b).concat(Object.keys(a)));
    keys.forEach(k=>{
      const from=typeof b[k]==='number'?b[k]:null,to=typeof a[k]==='number'?a[k]:null;
      if(from===to)return;
      (out[s]=out[s]||{})[k]={from,to};count++;
    });
  });
  return{cells:out,count};
}
function _ptnRevs(id){return patternRevisions[id]||[];}
function _ptnLastRev(id){const r=_ptnRevs(id);return r.length?r[0]:null;}
function _ptnRevBaseline(id){const last=_ptnLastRev(id);return last&&last.snapshot?last.snapshot:{};}
// What a revision recorded now would say — used to arm the button and to
// show the person what they are about to send before they send it.
function _ptnPendingDiff(p){return _ptnGridDiff(_ptnRevBaseline(p.id),p.grid||{});}
// One readable line per changed cell, for the notice and the bell.
function _ptnDiffLines(diff,limit){
  const out=[];
  Object.keys(diff.cells||{}).sort().forEach(s=>{
    Object.keys(diff.cells[s]).sort().forEach(k=>{
      const c=diff.cells[s][k];
      out.push(s+' · '+k+': '+(c.from==null?'—':_ptnFmt(c.from,'in'))+' → '+(c.to==null?'—':_ptnFmt(c.to,'in')));
    });
  });
  return limit&&out.length>limit?out.slice(0,limit).concat(['…and '+(out.length-limit)+' more']):out;
}
function _ptnRowLabel(p,key){
  const r=(typeof _ptnRowsFor==='function'?_ptnRowsFor(p):[]).find(x=>x.key===key);
  return r?r.label:key;
}

// ── Loaders — cannot reject ───────────────────────────────────────────────
async function loadPatternRevisions(id){
  if(!id)return;
  try{
    const snap=await getDocs(collection(db,'patterns',id,'revisions'));
    patternRevisions[id]=snap.docs.map(d=>Object.assign({id:d.id},d.data())).sort((a,b)=>(b.n||0)-(a.n||0));
  }catch(e){console.warn('[patterns] revisions load failed',e);patternRevisions[id]=patternRevisions[id]||[];}
}
async function loadPatternNotices(){
  _ptnNoticesFailed=false;_ptnNoticesErr=null;
  try{
    const snap=await getDocs(collection(db,'pattern_notices'));
    patternNotices=snap.docs.map(d=>Object.assign({id:d.id},d.data())).sort((a,b)=>String(b.raisedAt||'').localeCompare(String(a.raisedAt||'')));
  }catch(e){_ptnNoticesFailed=true;_ptnNoticesErr=(e&&(e.message||String(e)))||'read failed';console.warn('[patterns] pattern_notices load failed',e);}
  _ptnNoticesLoaded=true;
}
function _ptnOpenNotices(){return patternNotices.filter(n=>n.status!=='acknowledged');}
function _ptnNoticeBadge(){const n=_ptnOpenNotices().length;return n?` <span class="badge" style="font-size:10px">${n}</span>`:'';}

// ── Record a revision ─────────────────────────────────────────────────────
// One batch: the revision, the notice, and one bell row per recipient. A
// revision without a notice would be a private diary; a notice without a
// revision would have nothing to point at. They are written together.
async function _ptnRecordRevision(p,reason){
  const diff=_ptnPendingDiff(p);
  if(!diff.count)return{error:'Nothing has changed since the last revision.'};
  if(!reason||!String(reason).trim())return{error:'A revision needs a reason.'};
  const now=new Date().toISOString();
  const by=(typeof session!=='undefined'&&session&&session.u)||'';
  const byName=(typeof session!=='undefined'&&session&&session.name)||by;
  const n=(_ptnLastRev(p.id)||{}).n||0;
  const revN=n+1;
  const revId='rev_'+String(revN).padStart(3,'0');
  const noticeId='ptnn_'+p.id+'_r'+revN;
  const articleCodes=_ptnArticlesOf(p.id).map(a=>a.code).sort();
  const lines=_ptnDiffLines(diff,40);
  const rev={n:revN,at:now,by,byName,reason:String(reason).trim(),
    cells:diff.cells,changed:diff.count,snapshot:JSON.parse(JSON.stringify(p.grid||{})),noticeId};
  const notice={patternId:p.id,patternCode:p.code,patternName:p.name||'',revisionN:revN,
    articleCodes,summary:String(reason).trim(),changed:diff.count,lines,
    raisedBy:by,raisedByName:byName,raisedAt:now,status:'open',ackBy:'',ackAt:'',ackNote:''};
  const recipients=_PATTERN_CUTTING_USERS.slice();
  try{
    const batch=writeBatch(db);
    batch.set(doc(db,'patterns',p.id,'revisions',revId),rev);
    batch.set(doc(db,'pattern_notices',noticeId),notice);
    recipients.forEach(u=>{
      batch.set(doc(db,'hrm_notifications','ptn_rev_'+p.id+'_r'+revN+'_'+u),{
        id:'ptn_rev_'+p.id+'_r'+revN+'_'+u,type:'pattern_revision',
        title:'Pattern updated — '+p.code,
        message:_ptnEsc(String(reason).trim())+' · '+diff.count+' measurement'+(diff.count===1?'':'s')+' changed on '+_ptnEsc(p.name||p.code)+(p.hook&&p.slot?' (Hook '+p.hook+' / Slot '+p.slot+')':''),
        forUser:u,forRole:'',relatedTo:noticeId,createdAt:now,readBy:[],
        priority:'high',actionRequired:true,actionUrl:'pattern-notices'});
    });
    await batch.commit();
    patternRevisions[p.id]=[Object.assign({id:revId},rev)].concat(_ptnRevs(p.id));
    patternNotices.unshift(Object.assign({id:noticeId},notice));
    return{revN,changed:diff.count,recipients:recipients.length};
  }catch(e){console.error('[patterns] revision failed',e);return{error:(e&&(e.message||String(e)))||'write failed'};}
}
window.ptnRecordRevision=async function(id){
  if(!_canManagePatterns()||_ptnRevBusy)return false;
  const p=_ptnBlock(id);if(!p)return false;
  if(_ptnGridDirty){showToast('Save the measurements first — a revision records what is saved.',true);return false;}
  const diff=_ptnPendingDiff(p);
  if(!diff.count){showToast('Nothing has changed since the last revision.',true);return false;}
  const reason=typeof prompt==='function'?prompt('What changed on the paper, in one line?\n\n'+diff.count+' measurement'+(diff.count===1?'':'s')+' will be sent to cutting.',''):'';
  if(reason===null||!String(reason||'').trim())return false;
  _ptnRevBusy=true;_ptnBlockRepaint();
  const r=await _ptnRecordRevision(p,reason);
  _ptnRevBusy=false;
  if(r.error){showToast('Could not record the revision: '+r.error,true);_ptnBlockRepaint();return false;}
  showToast('Revision '+r.revN+' recorded — '+r.changed+' change'+(r.changed===1?'':'s')+' sent to cutting.');
  _ptnLog('Pattern Revision',p.code+' r'+r.revN+' — '+r.changed+' cells · '+String(reason).trim());
  _ptnBlockRepaint();return true;
};

// ── The revisions card on a block ─────────────────────────────────────────
function _ptnRevisionsCardHTML(p){
  const can=_canManagePatterns();
  const revs=_ptnRevs(p.id);
  const diff=_ptnPendingDiff(p);
  const pending=diff.count?`<div style="font-size:12px;color:var(--accent-warning);margin-bottom:8px"><b>${diff.count}</b> measurement${diff.count===1?'':'s'} ${revs.length?'changed since revision '+(_ptnLastRev(p.id)||{}).n:'recorded'} and not yet sent to cutting.<div style="color:var(--muted);margin-top:4px;line-height:1.5">${_ptnDiffLines(diff,6).map(l=>_ptnEsc(l)).join('<br>')}</div></div>`
    :`<div style="font-size:12px;color:var(--muted);margin-bottom:8px">Cutting has the current measurements.${revs.length?'':' No revision recorded yet.'}</div>`;
  const list=revs.length?revs.map(r=>{
    const notice=patternNotices.find(x=>x.id===r.noticeId);
    const state=notice?(notice.status==='acknowledged'?`<span style="color:var(--green)">acknowledged by ${_ptnEsc(notice.ackBy||'')}</span>`:'<span style="color:var(--accent-warning)">waiting for cutting</span>'):'';
    return`<div class="ptn-rev" data-n="${r.n}" style="border-top:1px solid var(--border);padding:8px 0;font-size:12px">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>Revision ${r.n}</b><span style="color:var(--muted)">${_ptnEsc(String(r.at||'').slice(0,10))} · ${_ptnEsc(r.byName||r.by||'')} · ${r.changed} change${r.changed===1?'':'s'}</span></div>
      <div style="margin-top:3px">${_ptnEsc(r.reason||'')}</div>
      <div style="color:var(--muted);margin-top:4px;line-height:1.5">${_ptnDiffLines({cells:r.cells||{},count:r.changed||0},6).map(l=>_ptnEsc(l)).join('<br>')}</div>
      ${state?`<div style="margin-top:4px">${state}</div>`:''}
    </div>`;}).join(''):'<div class="empty">No revisions yet.</div>';
  return`<div class="card" id="ptn-rev-card" style="margin-top:14px"><div class="card-title">Revisions <span style="font-weight:400;color:var(--muted);font-size:11px">a physical correction, mirrored here and sent to cutting</span></div>
    ${pending}
    ${can?`<button class="btn-primary" ${_ptnRevBusy||_ptnBusy||!diff.count?'disabled':''} onclick="window.ptnRecordRevision('${_ptnEsc(p.id)}')">Record a revision</button>${diff.count?'':'<span style="font-size:11px;color:var(--muted);margin-left:8px">Nothing to send.</span>'}`:''}
    <div style="margin-top:10px">${list}</div>
  </div>`;
}

// ── The notices page ──────────────────────────────────────────────────────
function renderPatternNotices(){
  if(!_canSeePatternHub())return'<div class="empty">The Pattern Hub is in a test phase — Afnan, Ammar, Mustafa and Uzaib.</div>';
  return`<div id="pattern-notices-root">${_ptnNoticesHTML()}</div>`;
}
function _ptnNoticesRepaint(){const r=document.getElementById('pattern-notices-root');if(r)r.innerHTML=_ptnNoticesHTML();}
function _ptnNoticesHTML(){
  const back=_canManagePatterns()?`<button class="back-btn" onclick="window.showPage('pattern-blocks')">← Patterns</button>`:'';
  const head=back+`<div class="page-head" style="margin-bottom:10px"><div><h2 style="margin:0">Pattern updates</h2><div style="color:var(--muted);font-size:12px;margin-top:2px">What changed on a physical pattern, and what to update at cutting.</div></div></div>`;
  if(_ptnNoticesFailed)return head+`<div class="board-load-error" id="ptn-notices-failed">pattern_notices: ${_ptnEsc(_ptnNoticesErr||'')}. If that says <em>missing or insufficient permissions</em>, republish <code>firestore.rules</code>. <button class="btn-sm" onclick="window.ptnRetryLoad()">Retry</button></div>`;
  const open=_ptnOpenNotices(),done=patternNotices.filter(n=>n.status==='acknowledged');
  const list=_ptnNoticeTab==='open'?open:done;
  const tabs=`<div style="display:flex;gap:6px;margin-bottom:12px"><button class="btn-sm" style="${_ptnNoticeTab==='open'?'background:var(--dark);color:var(--on-dark);border-color:var(--dark)':''}" onclick="window.ptnNoticeTab('open')">To do <b>${open.length}</b></button><button class="btn-sm" style="${_ptnNoticeTab==='done'?'background:var(--dark);color:var(--on-dark);border-color:var(--dark)':''}" onclick="window.ptnNoticeTab('done')">Done <b>${done.length}</b></button></div>`;
  if(!list.length)return head+tabs+`<div class="empty" id="ptn-notices-empty">${_ptnNoticeTab==='open'?'Nothing to update — every pattern change has been acknowledged.':'Nothing acknowledged yet.'}</div>`;
  const canAck=_canAckPatternNotice();
  const cards=list.map(n=>{
    const p=_ptnBlock(n.patternId);
    const home=p&&p.hook&&p.slot?'Hook '+p.hook+' / Slot '+p.slot:(p?'not on a hook':'');
    return`<div class="card ptn-notice" data-id="${_ptnEsc(n.id)}" style="margin-bottom:10px;${n.status!=='acknowledged'?'border-color:var(--accent-warning)':''}">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
        <div><div style="font-weight:700;font-size:14px">${_ptnEsc(n.patternCode||'')} · ${_ptnEsc(n.patternName||'')} <span style="font-weight:400;color:var(--muted);font-size:12px">revision ${n.revisionN}</span></div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${_ptnEsc(String(n.raisedAt||'').slice(0,10))} · by ${_ptnEsc(n.raisedByName||n.raisedBy||'')}${home?' · '+_ptnEsc(home):''}</div></div>
        ${p&&_canManagePatterns()?`<button class="btn-sm" onclick="window.ptnOpenBlock('${_ptnEsc(p.id)}')">Open the block</button>`:''}
      </div>
      <div style="margin-top:8px;font-size:13px"><b>${_ptnEsc(n.summary||'')}</b></div>
      <div style="margin-top:6px;font-size:12px;color:var(--muted);line-height:1.6">${(n.lines||[]).map(l=>_ptnEsc(l)).join('<br>')}</div>
      <div style="margin-top:8px;font-size:11px;color:var(--muted)">Articles cut from this pattern: ${(n.articleCodes||[]).length?_ptnEsc((n.articleCodes||[]).join(', ')):'none recorded'}</div>
      ${n.status==='acknowledged'
        ?`<div style="margin-top:10px;font-size:12px;color:var(--green)">Acknowledged by ${_ptnEsc(n.ackBy||'')} on ${_ptnEsc(String(n.ackAt||'').slice(0,10))}${n.ackNote?' — '+_ptnEsc(n.ackNote):''}</div>`
        :(canAck?`<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn-primary" ${_ptnBusy?'disabled':''} onclick="window.ptnAckNotice('${_ptnEsc(n.id)}')">I have updated the pattern</button><span style="font-size:11px;color:var(--muted)">Confirms the paper at cutting now matches.</span></div>`
          :'<div style="margin-top:10px;font-size:12px;color:var(--accent-warning)">Waiting for cutting to acknowledge.</div>')}
    </div>`;}).join('');
  return head+tabs+cards;
}
window.ptnNoticeTab=function(t){_ptnNoticeTab=t;_ptnNoticesRepaint();};
window.ptnAckNotice=async function(id){
  if(!_canAckPatternNotice()||_ptnBusy)return false;
  const n=patternNotices.find(x=>x.id===id);if(!n)return false;
  if(n.status==='acknowledged'){showToast('Already acknowledged.');return false;}
  const note=typeof prompt==='function'?prompt('Anything to note? (optional)',''):'';
  if(note===null)return false;
  const now=new Date().toISOString();const by=(typeof session!=='undefined'&&session&&session.u)||'';
  _ptnBusy=true;_ptnNoticesRepaint();
  try{
    // ONLY these four fields — firestore.rules limits the update to them.
    await updateDoc(doc(db,'pattern_notices',id),{status:'acknowledged',ackBy:by,ackAt:now,ackNote:String(note||'').trim()});
    Object.assign(n,{status:'acknowledged',ackBy:by,ackAt:now,ackNote:String(note||'').trim()});
    showToast('Thanks — recorded.');
    _ptnLog('Pattern Update Acknowledged',(n.patternCode||'')+' r'+n.revisionN);
  }catch(e){console.error('[patterns] ack failed',e);showToast('Could not record it: '+(e.message||e),true);}
  _ptnBusy=false;_ptnNoticesRepaint();return true;
};
const _PTN_ACK_FIELDS=['status','ackBy','ackAt','ackNote'];   // == the rules' hasOnly list
