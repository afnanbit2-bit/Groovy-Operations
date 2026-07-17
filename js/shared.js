/* Groovy Operations — shared.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */


const SETUP_CODE='GroovyOps2024';

const STAGES=[
  {key:'cutting',  label:'Cutting',    owner:'Zohaib',color:'#111111'},
  {key:'printing', label:'Embellishment QC',owner:'Asghar',color:'#111111'},
  {key:'bundling', label:'Bundling',   owner:'Zohaib',color:'#111111'},
  {key:'stitching',label:'Stitching',  owner:'Waqas', color:'#111111'},
  {key:'washing',  label:'Washing',    owner:'Abbas', color:'#111111'},
  {key:'qc',       label:'Final QC',   owner:'Haris', color:'#111111'},
];
const STAGE_KEYS=STAGES.map(s=>s.key);

const PRODUCT_CATALOG=[
  {code:'GB001',name:"CORE Tees | ACID Washed Blank"},
  {code:'GB002',name:"Fade Washed Blank"},
  {code:'GB003',name:"Oil Fade Blank"},
  {code:'GB004',name:"CORE Tees | Electric Blue Raglan"},
  {code:'GB005',name:"CORE Tees | Black Raglan"},
  {code:'GB006',name:"CORE Tees | Mocha Brown Raglan"},
  {code:'GB007',name:"CORE Tees | Racing Green Raglan"},
  {code:'GB008',name:"CORE Tees | Essential Slate Blue"},
  {code:'GB009',name:"CORE Tees | Mocha Brown"},
  {code:'GB010',name:"CORE Tees | Stone Grey"},
  {code:'GB011',name:"CORE Tees | Maroon"},
  {code:'GB012',name:"CORE Tees | Essential White"},
  {code:'GB013',name:"CORE Tees | Essential Black"},
  {code:'GB014',name:"Deep Blue Washed Blank"},
  {code:'GB015',name:"Mocha Brown Washed Blank"},
  {code:'GB016',name:"Slate Grey Washed Blank"},
  {code:'GB017',name:"Shadow Grey Washed Blank"},
  {code:'GB018',name:"Rust Orange Washed Blank"},
  {code:'GB019',name:"Emerald Green Washed Blank"},
  {code:'GB020',name:"Crimson Washed Blank"},
  {code:'GB021',name:"Cream Washed Blank"},
  {code:'GS001',name:"White Cuban Shirt"},
  {code:'GS002',name:"Black Cuban Shirt"},
  {code:'GS003',name:"Grey Cuban Shirt"},
  {code:'GS004',name:"Geto | Jujutsu Kaisen Cuban Shirt"},
  {code:'GS005',name:"The GTA Shirt - Maroon"},
  {code:'GS006',name:"Fugazi Shirt - Black"},
  {code:'GS007',name:"The Weyz - Black"},
  {code:'GS008',name:"The Weyz - Beige"},
  {code:'GS009',name:"The Boneless Wash Denim Shirt - Black"},
  {code:'GS010',name:"The Diesel shirt - ICE Blue"},
  {code:'GS011',name:"Star Applique Denim Shirt - Washed Blue"},
  {code:'GS012',name:"Pike Washed Cropped Shirt - Green"},
  {code:'GS013',name:"Pike Washed Cropped Shirt - Black"},
  {code:'GS014',name:"Washed Shirt Sunfaded"},
  {code:'GS015',name:"Cropped Pocket Shirt - White"},
  {code:'GS016',name:"The Cherub Faded Shirt"},
  {code:'GS017',name:"Seeking Redemption Shirt"},
  {code:'GS018',name:"Solar Button Shirt"},
  {code:'GS019',name:"Deep Candy Button Up Shirt"},
  {code:'GS020',name:"Classic Green Check Shirt"},
  {code:'GS022',name:"The Wanted Shirt"},
  {code:'GP001',name:"REBIRTH"},
  {code:'GP002',name:"ZORO | One Piece"},
  {code:'GP003',name:"ROLLER TEE"},
  {code:'GP004',name:"Afterdark Piping Top"},
  {code:'GP005',name:"GROOVY Studios"},
  {code:'GP006',name:"5 Way Stitch Top"},
  {code:'GP007',name:"GRVY FLAMES"},
  {code:'GP008',name:"VENOM Jersey"},
  {code:'GP009',name:"96 Double Layer Jersey – Mocha"},
  {code:'GP010',name:"96 Double Layer Jersey – Electric Blue"},
  {code:'GP011',name:"96 Double Layer Jersey – Racing Green"},
  {code:'GP012',name:"96 Double Layer Jersey – Frost Blue"},
  {code:'GP013',name:"Allover GRVY – Frost Blue"},
  {code:'GP014',name:"GRVY Energy Washed"},
  {code:'GP015',name:"Metallica"},
  {code:'GP016',name:"The Creator Tee"},
  {code:'GP017',name:"Jujutsu Kaisen | GOJO"},
  {code:'GP018',name:"Superman Full Sleeves Tee"},
  {code:'GP019',name:"Young & Turnt Tee"},
  {code:'GP020',name:"GRVYBirds | Puff Printed"},
  {code:'GP021',name:"MONEY LOVES ENERGY"},
  {code:'GP022',name:"Athletic Department Raglan"},
  {code:'GP023',name:"IGRIS | Solo Leveling"},
  {code:'GP024',name:"GREEN HUMMINGBIRD"},
  {code:'GP025',name:"SOLO LEVELING"},
  {code:'GP026',name:"Heart Ashtray Tee"},
  {code:'GP027',name:"Project Rebirth"},
  {code:'GP028',name:"Naruto (Pain)"},
  {code:'GP029',name:"DICES GRVY"},
  {code:'GP030',name:"Tanjiro Full Sleeves"},
  {code:'GP031',name:"BE THE PROBLEM"},
  {code:'GP032',name:"Institute Of GRVY Black"},
  {code:'GP033',name:"GRVY Shark"},
  {code:'GP034',name:"Hunter X Hunter Tee"},
  {code:'GP035',name:"The Best Is Yet To Come 2.0"},
  {code:'GP036',name:"HARSH & CRUEL #7"},
  {code:'GP037',name:"Chainsaw Man | Denji"},
  {code:'GP038',name:"GRVY Community"},
  {code:'GP039',name:"Alpha Jersey – Mocha Brown"},
  {code:'GP040',name:"Institute Of GRVY LB/DB"},
  {code:'GP041',name:"Keep That Same Energy"},
  {code:'GP042',name:"Thunder Bite Tee | GRVYEffect"},
  {code:'GP043',name:"Naruto Uzumaki"},
  {code:'GP044',name:"Fate In Motion T-Shirt"},
  {code:'GP045',name:"Never Stopping Culture T-Shirt"},
  {code:'GP046',name:"Money Over Your Feelings Tee"},
  {code:'GP047',name:"Dept. of Visionaries"},
  {code:'GP048',name:"Hell Star"},
  {code:'GP049',name:"Sanctuary"},
  {code:'GP050',name:"Zero To One"},
  {code:'GP051',name:"Motorhead"},
  {code:'GP052',name:"We Need Art In Our Lives"},
  {code:'GP053',name:"The Final Dance"},
  {code:'GP054',name:"Never Give Up"},
  {code:'GP055',name:"LA Lakers"},
  {code:'GP056',name:"Chill Out"},
  {code:'GP057',name:"ASAP Rocky"},
  {code:'GP058',name:"Burning Butterfly"},
  {code:'GP059',name:"Legacy Is The Vision"},
  {code:'GP060',name:"Chicago Bulls Black"},
  {code:'GP061',name:"Chicago Bulls White"},
  {code:'GP062',name:"Dropout T-Shirt"},
  {code:'GP063',name:"Death Note"},
  {code:'GP064',name:"Demon Slayer Zenitsu"},
  {code:'GP065',name:"Initial Assembly"},
  {code:'GP066',name:"South Side"},
  {code:'GP067',name:"Racer Tee V2"},
  {code:'GP068',name:"96 Double Layer Jersey – Black"},
  {code:'GP069',name:"Cold Blooded (Green)"},
  {code:'GP070',name:"Cold Blooded (Black)"},
  {code:'GTT001',name:"Legacy Club Sando"},
  {code:'GTT002',name:"Thunder Bite Sando | GRVYEffect"},
  {code:'GTT003',name:"WORLDWIDE Mint Green Sando"},
  {code:'GTT004',name:"Young & Turnt Sando"},
  {code:'GJ001',name:"Chrome Hearts Full Sleeves Jersey"},
  {code:'GJ002',name:"TIMELESS Basketball Jersey"},
  {code:'GJ003',name:"Allstars Basketball Jersey"},
  {code:'GJ004',name:"Outlaw Mesh Jersey"},
  {code:'GJ005',name:"Oreo Dunk Basketball Jersey"},
  {code:'GJ006',name:"88 Athletics Basketball Jersey"},
  {code:'GJ007',name:"The 69’ Baller Jersey"},
  {code:'GJ008',name:"#25 Basketball Jersey"},
  {code:'GJ009',name:"Star Basketball Jersey"},
  {code:'GBT001',name:"Basic Babytee – Black"},
  {code:'GBT002',name:"Basic Babytee – Electric Blue"},
  {code:'GBT003',name:"Basic Babytee – Mocha Brown"},
  {code:'GBT004',name:"Basic Babytee – Green"},
  {code:'GBT005',name:"Process Babytee"},
  {code:'GBT006',name:"Cherry Babytee"},
  {code:'GBT007',name:"Broken Souls Babytee"},
  {code:'GBT008',name:"Anime Girl Babytee"},
  {code:'GBT009',name:"LA Babytee"},
  {code:'GBT010',name:"Pulp Fiction Top"},
  {code:'GBT011',name:"GRVY Flowers Babytee"},
  {code:'GBT012',name:"Me & Bae Babytee"},
  {code:'GBT013',name:"Ditch Toxic People"},
  {code:'GBT014',name:"Main Character Babytee"},
  {code:'GBT015',name:"Top Tier Yapper Babytee"},
  {code:'GBT016',name:"Cosmic Cowgirl"},
  {code:'GBT017',name:"Y2K Star Babytee"},
  {code:'GBT018',name:"Batwoman Babytee"},
  {code:'GBT019',name:"GROOVY Girl | Babytee"},
  {code:'GH001',name:"Black Hoodie"},
  {code:'GH002',name:"Navy Blue hoodie"},
  {code:'GH003',name:"Hunter Green Hoodie"},
  {code:'GH004',name:"Light Grey Hoodie"},
  {code:'GH005',name:"Dark Grey Hoodie"},
  {code:'GH006',name:"Mocha Brown Hoodie"},
  {code:'GH007',name:"Cream Hoodie"},
  {code:'GH008',name:"Light Blue Hoodie"},
  {code:'GH009',name:"Camel Brown"},
  {code:'GH010',name:"Teal Blue"},
  {code:'GH011',name:"Dark Green"},
  {code:'GH012',name:"School Ruins Creativity"},
  {code:'GH013',name:"Blade Hoodie Foam"},
  {code:'GH014',name:"Dropout – Class of ’25 Edition"},
  {code:'GH015',name:"White Beard – One Piece"},
  {code:'GH016',name:"Naruto Pain (Hoodie)"},
  {code:'GH017',name:"Never Stopping Culture"},
  {code:'GH018',name:"Hunter X Hunter Hoodie"},
  {code:'GH019',name:"Straw Hat Club"},
  {code:'GH020',name:"Eden Made"},
  {code:'GH021',name:"Sanctuary Hoodie"},
  {code:'GH022',name:"Make Your Own Luck"},
  {code:'GH023',name:"I Hate Maths"},
  {code:'GH024',name:"All Hustle No Luck"},
  {code:'GH025',name:"Chicago Black"},
  {code:'GH026',name:"(Washed) Black Hoodie"},
  {code:'GH027',name:"Pastel Pink Hoodie"},
  {code:'GH028',name:"Electric Blue Hoodie"},
  {code:'GH029',name:"The Initial Hoodie"},
  {code:'GH030',name:"The Combat Washed Hoodie"},
  {code:'GH031',name:"Fade Washed Hoodie"},
  {code:'GH032',name:"#55 Frost Hoodie"},
  {code:'GH033',name:"The Floral Hoodie"},
  {code:'GH034',name:"Eden Made 2.0"},
  {code:'GH035',name:"Own Lane Own Pace"},
  {code:'GH037',name:"5 Way Stitch Hoodie"},
  {code:'GH038',name:"Chicago White"},
  {code:'GH039',name:"The Cult Classic"},
  {code:'GH040',name:"LA Lakers Hoodie"},
  {code:'GH041',name:"Charcoal Heather Grey Hoodie"},
  {code:'GSH001',name:"Money Over Your Feelings (Sweatshirt)"},
  {code:'GSH002',name:"Berserk"},
  {code:'GSH003',name:"Hidden In Plain Sight | Black"},
  {code:'GSH004',name:"Hidden In Plain Sight | Arctyc White"},
  {code:'GHZ001',name:"One Piece Fire Fist Zipper"},
  {code:'GHZ002',name:"The Good Attitude Club 2.0"},
  {code:'GHZ003',name:"Emerald Green Washed Zipper"},
  {code:'GHZ004',name:"Shadow Grey Washed Zipper"},
  {code:'GHZ005',name:"Ethereal Blue Washed Zipper"},
  {code:'GHZ006',name:"(GOJO) Jujutsu Kaisen Zipper"},
  {code:'GHZ007',name:"Flying Predator Zipper Hoodie"},
  {code:'GHZ008',name:"Racing Green | Essential Zipper"},
  {code:'GHZ009',name:"Plum | Essential Zipper"},
  {code:'GHZ010',name:"Maple Brown | Essential Zipper"},
  {code:'GHZ011',name:"Granite | Essential Zipper"},
  {code:'GHZ012',name:"The Utility Top | Lilac"},
  {code:'GHZ013',name:"The Utility Top | Granite Grey"},
  {code:'GHZ014',name:"The Utility Top | Arctyc White"},
  {code:'GHZ015',name:"The Utility Top | Heather Green"},
  {code:'GHZ016',name:"The Heritage Top | Wine Red"},
  {code:'GHZ017',name:"The Heritage Top | Black"},
  {code:'GHZ018',name:"The Heritage Top | Frost Blue"},
  {code:'GHZ019',name:"The Utility Top | Black"},
  {code:'GHZ020',name:"Black | Essential Zipper"},
  {code:'GHZ021',name:"Dark Heather Grey | Essential Zipper"},
  {code:'GHZ022',name:"The Illusion Zipper"},
  {code:'GCO001-T',name:"The Utility Set | Lilac | Top"},
  {code:'GCO002-T',name:"The Utility Set | Light Grey | Top"},
  {code:'GCO003-T',name:"The Utility Set | Heather Grey | Top"},
  {code:'GCO004-T',name:"The Utility Set | Heather Green | Top"},
  {code:'GCO005-T',name:"The Heritage Set | Wine Red | Top"},
  {code:'GCO006-T',name:"The Heritage Set | Black | Top"},
  {code:'GCO007-T',name:"The Heritage Set | Slate Blue | Top"},
  {code:'GCO001-B',name:"The Utility Set | Lilac | Bottom"},
  {code:'GCO002-B',name:"The Utility Set | Light Grey | Bottom"},
  {code:'GCO003-B',name:"The Utility Set | Heather Grey | Top"},
  {code:'GCO004-B',name:"The Utility Set | Heather Green | Top"},
  {code:'GCO005-B',name:"The Heritage Set | Wine Red | Bottom"},
  {code:'GCO006-B',name:"The Heritage Set | Black | Bottom"},
  {code:'GCO007-B',name:"The Heritage Set | Slate Blue | Bottom"},
  {code:'GCO008-T',name:"Utility Zip Hoodie | Black | Top"},
  {code:'GCO008-B',name:"Utility Zip Hoodie | Black | Bottom"},
  {code:'GO001',name:"Racer-Jacket"},
  {code:'GO002',name:"The Coach Jacket"},
  {code:'GO003',name:"The Heritage Jacket"},
  {code:'GD001',name:"CORE Denim | Black"},
  {code:'GD002',name:"CORE Denim | Stone Grey"},
  {code:'GD003',name:"CORE Denim | Washed Black"},
  {code:'GD004',name:"CORE Denim | Washed Blue"},
  {code:'GD005',name:"Rage Denim"},
  {code:'GD006',name:"Carpenter Washed Black Denim"},
  {code:'GD007',name:"Star Denim"},
  {code:'GD008',name:"Jorts | Hard Washed Grey"},
  {code:'GD009',name:"Fade Washed Denim"},
  {code:'GD010',name:"Project Rebirth Denim"},
  {code:'GD011',name:"Cross Star Denim Blue"},
  {code:'GD012',name:"Carpenter Dark Grey Denim"},
  {code:'GD013',name:"Carpenter Light Grey Denim"},
  {code:'GD014',name:"CORE Denim | Dark Stone"},
  {code:'GD015',name:"CORE Denim | White Stone"},
  {code:'GC001',name:"Utility V1 | Black Cargos"},
  {code:'GC002',name:"Utility V1 | Mocha Brown Cargos"},
  {code:'GC003',name:"Utility V1 | Grey Cargos"},
  {code:'GC004',name:"Utility V1 | Cream Cargos"},
  {code:'GC005',name:"Black VII Cargo"},
  {code:'GC006',name:"Slate Grey VII Cargo"},
  {code:'GC007',name:"Mint Chalk VII Cargo"},
  {code:'GC008',name:"Military Green VII Cargo"},
  {code:'GC009',name:"Utility V1 | Mint Green Cargos"},
  {code:'GC010',name:"The Tactical Cargo | Camo"},
  {code:'GC011',name:"Deep Blue Cargo Trousers"},
  {code:'GC012',name:"Olive Green Cargo Trousers"},
  {code:'GC013',name:"VII Cargo | Mocha Brown"},
  {code:'GC014',name:"VII Cargo | Dark Grey"},
  {code:'GST001',name:"Baggy Trousers | Black"},
  {code:'GST002',name:"Baggy Trousers | Cream"},
  {code:'GST003',name:"Baggy Trousers | Sage Green"},
  {code:'GST004',name:"Baggy Trousers | Mocha Brown"},
  {code:'GST005',name:"Baggy Trousers | Slate Blue"},
  {code:'GST006',name:"Piping Trouser | Black"},
  {code:'GST007',name:"Piping Trouser | Cream"},
  {code:'GST008',name:"Piping Trouser | Sage Green"},
  {code:'GST009',name:"Unity V1 – Slate Blue (winters)"},
  {code:'GST010',name:"Unity V1 – Mocha Brown"},
  {code:'GST011',name:"Unity V1 – Sandstone (winter)"},
  {code:'GST012',name:"Fade Washed Trouser"},
  {code:'GST013',name:"STAR Trouser | Black"},
  {code:'GST014',name:"Straight Fit Trouser | Slate Blue"},
  {code:'GST015',name:"Straight Fit Trouser | Cream"},
  {code:'GST016',name:"Slate Grey Essential Trouser (Winter)"},
  {code:'GST017',name:"Black Essential Trouser (winter)"},
  {code:'GST018',name:"Unity V1 – Slate Blue (Summers)"},
  {code:'GST019',name:"Unity V1 – Black (Winter)"},
  {code:'GST020',name:"The Heritage Pants | Wine Red"},
  {code:'GST021',name:"The Heritage Pants | Frost Blue"},
  {code:'GST022',name:"The Utility Sweats | Arctyc White"},
  {code:'GST023',name:"The Utility Sweats | Lilac"},
  {code:'GST024',name:"The Utility Sweats | Heather Green"},
  {code:'GST025',name:"The Utility Sweats | Granite Grey"},
  {code:'GST026',name:"Essential Trousers | Chalk"},
  {code:'GST027',name:"The Heritage Pants | Black"},
  {code:'GST028',name:"Heather Striped Trousers (Winters)"},
  {code:'GST029',name:"Navy Blue Trouser"},
  {code:'GST030',name:"The Utility Sweats | Black"},
  {code:'GST031',name:"Reverse Washed Cargo Pants"},
  {code:'GST032',name:"Baggy Trousers | Steel Grey"},
  {code:'GST033',name:"SCRIPT SWEATS | DEEP BLUE"},
  {code:'GST034',name:"SCRIPT SWEATS | GRAPHITE"},
  {code:'GST035',name:"SCRIPT SWEATS | DEEP GREEN"},
  {code:'GST036',name:"ON THE GO JOGGERS | PLUM"},
  {code:'GST037',name:"ON THE GO JOGGERS | DEEP GREEN"},
  {code:'GST038',name:"STRIPER CARGO | DEEP BLUE"},
  {code:'GST039',name:"STRIPER CARGO | PLUM"},
  {code:'GST040',name:"STRIPER CARGO | WINE RED"},
  {code:'GST041',name:"THE HERITAGE PANTS | KHAKI"},
  {code:'GST042',name:"THE WAVE PANT | Chocolate Brown"},
  {code:'GST043',name:"THE WAVE PANT | STEALTH"},
  {code:'GST044',name:"THE WAVE PANT | Heather Grey"},
  {code:'GST045',name:"Pintuck Baggy | Heather Grey"},
  {code:'GST046',name:"R1 Cargo | Khaki"},
  {code:'GST047',name:"R1 Cargo | Military Green"},
  {code:'GST048',name:"R1 Cargo | Cool Grey"},
  {code:'GST049',name:"Sigilism Trouser | Graphite Grey"},
  {code:'GSO001',name:"Aim Shorts | Ash Grey"},
  {code:'GSO002',name:"Aim Shorts | Deep Green"},
  {code:'GSO003',name:"Aim Shorts | Heather Grey"},
  {code:'GSO004',name:"Aim Shorts | Military Green"},
  {code:'GSO005',name:"Aim Shorts | Chocolate Brown"},
  {code:'GSO006',name:"Aim Shorts | Black"},
  {code:'GSO007',name:"Aim Shorts | Red Wine"},
  {code:'GSO008',name:"Aim Shorts | Cool Grey"},
  {code:'GSO009',name:"Aim Shorts | Cream"},
  {code:'GSO010',name:"Aim Shorts | Mocha Brown"},
  {code:'GSO011',name:"Aim Shorts | Deep Blue"},
  {code:'GSO012',name:"Aim Shorts | Plum"},
  {code:'GSO013',name:"Aim Shorts | Graphite Grey"},
  {code:'GSO014',name:"Aim Shorts | Stone Muave"},
  {code:'GSO015',name:"MF Shorts - Arctyc White"},
  {code:'GJO001',name:"Jorts | Hard Washed Grey"},
  {code:'CJ001',name:"Racing Blue Full Sleeves Jersey"},
  {code:'CJ002',name:"Racing Green Full Sleeves Jersey"},
  {code:'CJ003',name:"Racing Gold Full Sleeves Jersey"},
  {code:'CB001',name:"Charcoal Washed Blank"},
  {code:'CB002',name:"Ethereal Blue Washed Blank"},
  {code:'CB003',name:"Hunter Green Washed Blank"},
  {code:'CP001',name:"Champions (94)"},
  {code:'CP002',name:"Utopia"},
  {code:'CP003',name:"Jujutsu Kaisen (GETO)"},
  {code:'CP004',name:"Grow Back"},
  {code:'CP005',name:"Travis Scott (Raglan)"},
  {code:'CP006',name:"Blurred Acid"},
  {code:'CP007',name:"Attack On Titan (LEVI)"},
  {code:'CP008',name:"Fear Of God"},
  {code:'CP009',name:"Dreaming For Peace"},
  {code:'CP010',name:"Kanye West (DONDA)"},
  {code:'CP011',name:"Kendrick Lamar DAMN!"},
  {code:'CP012',name:"Destiny Club"},
  {code:'CP013',name:"Hunter X Hunter"},
  {code:'CP014',name:"Berserk"},
  {code:'CP015',name:"Wish Is Granted"},
  {code:'CP016',name:"Demon Slayer (Zenitsu)"},
  {code:'CP017',name:"Dragon Ball Z"},
  {code:'CP018',name:"The Weeknd"},
  {code:'CS001',name:"Cultured Legacy Posiedon"},
  {code:'CS002',name:"Cultured Legacy Made"},
  {code:'CH001',name:"CL Racing Hoodie"},
  {code:'CH002',name:"Life Is Such A Blessing"},
  {code:'CH003',name:"BLOODLINE Hoodie"},
  {code:'CH004',name:"Raw Seams Hoodie"},
  {code:'CH005',name:"Sorry Honey Hoodie"},
  {code:'CH006',name:"Cultured Art Dept."},
  {code:'CH007',name:"The Cultured Hoodie"},
  {code:'CH008',name:"Cultured URDU Hoodie"},
  {code:'CH009',name:"LightGrey Hoodie"},
  {code:'CH010',name:"Black Hoodie"},
  {code:'CH011',name:"Dark Grey Hoodie"},
  {code:'CH012',name:"Cream Hoodie"},
  {code:'CH013',name:"Camel Brown Hoodie"},
  {code:'CH014',name:"Wine Red Hoodie"},
  {code:'CH015',name:"Slate Grey Hoodie"},
  {code:'CH016',name:"Plum Plum Hoodie"},
  {code:'CD001',name:"12 Pockets Iced Cargo Jeans"},
  {code:'CD002',name:"CL Avante Garde Jeans"},
  {code:'CC001',name:"Assembly V2 Cargo"},
  {code:'CC002',name:"Liberty V1 Washed Cargo"},
  {code:'CC003',name:"Utility Black Cargo"},
  {code:'CC004',name:"Utility Moss Green Cargo"},
  {code:'AP001',name:"Imma Bloodystar"},
  {code:'AP002',name:"Fight Club"},
  {code:'AP003',name:"Nothing To Do (Raglan)"},
  {code:'AP004',name:"Fake News"},
  {code:'AP005',name:"Cowboy Bebop"},
  {code:'AP006',name:"Billionaire Nerds Club"},
  {code:'AP007',name:"In God We Trust"},
  {code:'AP008',name:"There’s No Planet B"},
  {code:'AP009',name:"Berserk"},
  {code:'AP010',name:"Lucid Ascension"},
  {code:'AP011',name:"Red Fever (SICK)"},
  {code:'AP012',name:"Rick & Morty"},
  {code:'AP013',name:"Club Hellboys"},
  {code:'AP014',name:"God Will Never Fail You"},
  {code:'AP015',name:"Jester’s Peace"},
  {code:'AP016',name:"Dark Uprising"},
  {code:'AP017',name:"Jujutsu Kaisen (GETO)"},
  {code:'AP018',name:"No Friends In The Industry"},
  {code:'AP019',name:"No Luck All God"},
  {code:'ATT001',name:"Glock-Proof (Vest)"},
  {code:'ATT002',name:"Attack On Titan (Vest)"},
  {code:'ATT003',name:"Off Script (Vest)"},
  {code:'AD001',name:"Sidewalk Scar Denim"},
  {code:'AD002',name:"Drifted Denim"},
  {code:'AD003',name:"Grey Matter Jorts"},
  {code:'AD004',name:"Cross-Fire Jorts"},
  {code:'AD005',name:"Noir-Cross Pants"},
  {code:'AST001',name:"Core Black Trousers"},
  {code:'AST002',name:"Core Grey Trousers"},
  {code:'AST003',name:"Black Straight-Fit Trouser"},
  {code:'AST004',name:"Camel Brown Straight-Fit Trouser"},
  {code:'AST005',name:"Slate Grey Straight-Fit Trouser"},
  {code:'AST006',name:"Dark Grey Straight-Fit Trouser"},
  {code:'AST007',name:"Cream Straight-Fit Trouser"},
  {code:'AH001',name:"BlackHoodie"},
  {code:'AH002',name:"Cream Hoodie"},
  {code:'AH003',name:"Slate Grey Hoodie"},
  {code:'AH004',name:"Dark Grey Hoodie"},
  {code:'AH005',name:"Charcoal Ash Hoodie"},
  {code:'AH006',name:"Navy Blue Hoodie"},
  {code:'AH007',name:"Camel Brown Hoodie"}
];

let session=null,allPOs=[],allPasses=[],currentPage='',viewingPO=null,poImages={front:null,back:null},gpRowIdx=0,loginInProgress=false,gpPage=1;
let stageWorkPO=null,stageWorkStage=null,currentBundles=[],cutState={poId:null,actualQty:{},pendingBundles:[]};
let gpActiveTab='outward',allReturns=[],allFabricIn=[],fabRollIdx=0;
let allGPEditRequests=[],_gpEditRowIdx=0;
let allFabricInventory=[],allFabricMovements=[];
let _fabInvFilter='in_stock',_fabInvSearchQ='',_fabInvDrillKey=null;
let _gpOutwardFabRolls=[];
let bundleDamage={},bundlePartIdx=0;
// ── Store state ──
let allItems=[],allTransactions=[],allTemplates=[],allRequests=[],allActivePOs=[];
let allStoreCategories=[];
let allPoIssueRequests=[],allPoEditRequests=[],allPoShortfalls=[];
let _issueViewingId=null;
let _miLines=[{itemCode:'',qty:''}];
let _invFilterCat='all',_invSearchQ='',_invSort='category';
let _rcvNewMode=false;
// ── HRM state ──
let allEmployees=[],allIncrementLogs=[],hrmPolicies=null,hrmDataLoaded=false;
let _empFilterQ='',_empFilterDept='',_empFilterPay='',_empFilterPending=false,_empViewingId=null;
// ── Payroll state ──
let allPayrollRuns=[],allPayslips=[],payrollDataLoaded=false;
let _payrollMonth=new Date().toISOString().slice(0,7);
let _payrollComputed=null; // cached calc result for current view
let _payslipViewingId=null;
// ── HRM Session 4 state — advances, loans, policy log, notifications ──
let allAdvances=[],allLoans=[],allPolicyChanges=[],allHRMNotifs=[],hrmS4DataLoaded=false;
let _advTab='pending',_advSearchQ='';
let _loanFilter='active';
let _hrmNotifPanelOpen=false;
// ── Bug Tracker state ──
let allBugs=[],bugsLoaded=false;
let _bugFilter='all',_bugSort='severity',_bugExpanded={};
let _bugTab='bugs';
let _bugExportSeverities=null,_bugExportCategories=null;
// ── Mustafa's task list — items raised by owners that need his attention ──
const MUSTAFA_TASKS=[
  {id:'set-join-dates',num:1,label:'Set join dates',detail:'31 employees were seeded with a placeholder date. Replace with each person\'s real joining date.',resolver:'pending-join-date'}
];
// ── Attendance state ──
let attendanceDate=new Date().toISOString().split('T')[0];
let attendanceTab='daily',attendanceMonth=new Date().toISOString().slice(0,7);
let liveAttendanceData={},dailyAttendanceData={},monthlyAttendanceCache={};
let _attLiveUnsub=null,_attDayUnsub=null,_attMonthSummary=null;
let _ilPage=1,_ilQ='',_ilPO='',_ilDir='';
let _tplRowIdx=0,_tplProdCode='',_tplProdName='',_tplEditId=null,_tplPage=1;
const TPL_PER=15;
let _poIssueData=null,_txFilterQ='',_txFilterType='';
const IL_PER=15,IL_MAX_PAGES=1000;   // effectively uncapped — page through all loaded movements
function showToast(msg,isErr=false){const t=document.getElementById('toast');t.textContent=msg;t.className='toast show'+(isErr?' err':'');setTimeout(()=>t.className='toast',3200);}

// ════════════════════════════════════════════════════════════════════════
//  Global loading system — one set of loaders for every section:
//   • Blocking buffer  (showLoader/hideLoader/withLoader) — for saves/submits
//   • Top progress bar (auto) — background reads + page navigation
//   • Skeleton         (gvSkeleton) — first paint of a section
//   • Button spinner   (gvBtnBusy/gvBtnDone) — a single button's own action
//  Auto-wired to every Firestore op in __bootApp so any slow action shows
//  feedback with NO per-callsite changes; also exposed for explicit use.
// ════════════════════════════════════════════════════════════════════════
let _gvBufCount=0,_gvBufTimer=null,_gvOpCount=0,_gvBarTimer=null;
function _gvEnsureNodes(){
  if(!document.getElementById('gv-progress')){
    const b=document.createElement('div');b.id='gv-progress';b.innerHTML='<div class="gv-bar"></div>';document.body.appendChild(b);
  }
  if(!document.getElementById('gv-overlay')){
    const o=document.createElement('div');o.id='gv-overlay';
    o.innerHTML='<div class="gv-buffer"><svg width="26" height="26" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="80 50"/></svg><span class="gv-buffer-lbl" id="gv-buffer-lbl">Working…</span></div>';
    document.body.appendChild(o);
  }
}
// Blocking buffer overlay (ref-counted; 25s safety auto-clear).
function showLoader(label){
  _gvEnsureNodes();_gvBufCount++;
  const l=document.getElementById('gv-buffer-lbl');if(l)l.textContent=label||'Working…';
  document.getElementById('gv-overlay')?.classList.add('on');
  clearTimeout(_gvBufTimer);_gvBufTimer=setTimeout(()=>{_gvBufCount=0;document.getElementById('gv-overlay')?.classList.remove('on');},25000);
}
function hideLoader(force){
  _gvBufCount=force?0:Math.max(0,_gvBufCount-1);
  if(_gvBufCount<=0){_gvBufCount=0;clearTimeout(_gvBufTimer);document.getElementById('gv-overlay')?.classList.remove('on');}
}
async function withLoader(fn,label){
  showLoader(label);
  try{return await(typeof fn==='function'?fn():fn);}
  finally{hideLoader();}
}
// Non-blocking top progress bar (ref-counted).
function _gvProgStart(){
  _gvEnsureNodes();_gvOpCount++;
  document.getElementById('gv-progress')?.classList.add('on');
  clearTimeout(_gvBarTimer);_gvBarTimer=setTimeout(()=>{_gvOpCount=0;document.getElementById('gv-progress')?.classList.remove('on');},25000);
}
function _gvProgStop(){
  _gvOpCount=Math.max(0,_gvOpCount-1);
  if(_gvOpCount<=0){_gvOpCount=0;clearTimeout(_gvBarTimer);document.getElementById('gv-progress')?.classList.remove('on');}
}
function _gvProgPulse(ms){_gvProgStart();setTimeout(_gvProgStop,ms||450);}
// Skeleton rows (shimmering placeholders) for a section's first paint.
function gvSkeleton(rows){
  rows=rows||4;const w1=[58,46,64,52,60,48],w2=[30,38,26,34,28,36];let out='';
  for(let i=0;i<rows;i++)out+='<div style="display:flex;gap:12px;align-items:center;padding:11px 2px;border-bottom:1px solid #f5f5f5"><div class="gv-skel" style="width:34px;height:34px;border-radius:9px;flex-shrink:0"></div><div style="flex:1"><div class="gv-skel" style="height:11px;width:'+w1[i%6]+'%;margin-bottom:7px"></div><div class="gv-skel" style="height:9px;width:'+w2[i%6]+'%"></div></div><div class="gv-skel" style="height:15px;width:54px;flex-shrink:0"></div></div>';
  return '<div class="card" style="padding:8px 14px">'+out+'</div>';
}
// Inline button spinner: lock a button + show a spinner while its action runs.
function gvBtnBusy(btn,label){
  if(!btn)return;btn.disabled=true;btn.dataset.gvHtml=btn.innerHTML;
  btn.innerHTML='<span class="spinner" style="border-top-color:currentColor;vertical-align:-2px"></span>'+(label?' '+label:'');
}
function gvBtnDone(btn){
  if(!btn)return;btn.disabled=false;if(btn.dataset.gvHtml!=null){btn.innerHTML=btn.dataset.gvHtml;delete btn.dataset.gvHtml;}
}
window.showLoader=showLoader;window.hideLoader=hideLoader;window.withLoader=withLoader;
window.gvSkeleton=gvSkeleton;window.gvBtnBusy=gvBtnBusy;window.gvBtnDone=gvBtnDone;
// Auto-write buffer: a save that runs >260ms raises the blocking buffer; fast
// writes show nothing (no flicker). Skipped while the Fabric section's own
// overlay is up, so the two never stack.
let _gvWr=0,_gvWrTimer=null,_gvWrShown=false;
function _gvWriteStart(){
  _gvWr++;
  if(_gvWr===1){clearTimeout(_gvWrTimer);_gvWrTimer=setTimeout(()=>{
    if(_gvWr>0&&!(typeof _fabBusy!=='undefined'&&_fabBusy)){_gvWrShown=true;showLoader('Saving…');}
  },260);}
}
function _gvWriteStop(){
  _gvWr=Math.max(0,_gvWr-1);
  if(_gvWr<=0){_gvWr=0;clearTimeout(_gvWrTimer);if(_gvWrShown){_gvWrShown=false;hideLoader();}}
}

async function logActivity(action,detail=''){
  if(!session)return;
  try{await addDoc(collection(db,'activity'),{user:session.name,role:session.title,action,detail,ts:Date.now(),date:new Date().toLocaleDateString('en-GB')});}catch(e){}
}

async function getNextId(field){
  const ref=doc(db,'counters','main');
  let next=1;
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    const cur=snap.exists()?(snap.data()[field]||0):0;
    next=cur+1;
    if(snap.exists())tx.update(ref,{[field]:next});
    else tx.set(ref,{pos:0,gatepasses:0,bundles:0,[field]:next});
  });
  return next;
}

async function reserveBundleIds(n){
  const ref=doc(db,'counters','main');
  let start=1;
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    const cur=snap.exists()?(snap.data().bundles||0):0;
    start=cur+1;
    if(snap.exists())tx.update(ref,{bundles:cur+n});
    else tx.set(ref,{pos:0,gatepasses:0,bundles:n});
  });
  return start;
}

async function uploadToCloudinary(file){
  const fd=new FormData();
  fd.append('file',file);
  fd.append('upload_preset','groovy-ops');
  const r=await fetch('https://api.cloudinary.com/v1_1/deww4lpym/image/upload',{method:'POST',body:fd});
  const d=await r.json();
  if(!d.secure_url)throw new Error(d.error?.message||'Cloudinary upload failed');
  return d.secure_url;
}

// ── Auth ──
function buildNav(){
  // Fulfilment account (Umair) — a single-purpose nav: Daily Performance only.
  if(session.role==='fulfillment'){
    const sb=document.getElementById('sidebar');
    if(sb)sb.innerHTML=`<div class="nav-item on" id="nav-fulfillment" onclick="window.showPage('fulfillment')">Daily Performance</div>`;
    _renderMobNav({isOwner:false,isWorker:false,isViewer:false,isStore:false,om:false,canPO:false});
    return;
  }
  const isOwner=session.role==='owner',canPO=session.canPO,isWorker=session.role==='worker',isViewer=session.role==='viewer',isStore=session.role==='store';
  const om=isOwner||session.role==='manager';
  const mainItems=[];
  if(!isWorker&&!isStore)mainItems.push({id:'dashboard',label:'Dashboard'});
  if(canPO)mainItems.push({id:'po-create',label:'New PO'});
  if(!isWorker&&!isStore)mainItems.push({id:'po-registry',label:'PO Registry'});
  if(isWorker||isViewer)mainItems.push({id:'my-work',label:'My Work'});
  if(!isStore)mainItems.push({id:'gatepass',label:'Gate Pass'});
  if(om||session.canFabric)mainItems.push({id:'fabric-inventory',label:'Fabric Inventory'});
  if(om)mainItems.push({id:'fulfillment',label:'Daily Performance'});
  if(om)mainItems.push({id:'bug-tracker',label:'🐛 Bug Tracker'});
  if(isOwner)mainItems.push({id:'shopify-intel',label:'Inventory Intel'});
  if(isOwner)mainItems.push({id:'activity',label:'Activity Log'});
  if(isOwner)mainItems.push({id:'users',label:'Users'});

  // HRM nav items — owners + managers only
  const hrmSubItems=[];
  if(om){
    hrmSubItems.push({id:'attendance',iconName:'clock',label:'Attendance'});
    hrmSubItems.push({id:'hrm-employees',iconName:'people',label:'Employees'});
    if(_canViewPayroll())hrmSubItems.push({id:'hrm-payroll',iconName:'money',label:'Payroll'});
    if(_canViewHRMOps())hrmSubItems.push({id:'hrm-advances',iconName:'list',label:'Advances'});
    if(_canViewHRMOps())hrmSubItems.push({id:'hrm-loans',iconName:'money',label:'Loans'});
    if(_canViewHRMOps())hrmSubItems.push({id:'hrm-policy',iconName:'gear',label:'Policy Engine'});
  }
  // Printing module nav items (worker-aware; used for mobile bottom nav)
  const printItems=[];
  if(om||session.u==='ammar'||session.u==='haris'||isPrintWorker())printItems.push({id:'recipe-directory',label:'Recipe Directory'});
  if(om||['asghar','zohaib','waqas','haris'].includes(session.u))printItems.push({id:'printing-jobs',label:'Embellishment Jobs'});
  if(om)printItems.push({id:'observer-tower',label:'Observer Tower'});
  if(canManageRecipes()||isQCWorker())printItems.push({id:'color-library',label:'Color Library'});

  const storeSubItems=[];
  if(!isWorker){
    storeSubItems.push({id:'store-dashboard',label:'Dashboard'});
    if(typeof _canViewCash==='function'&&_canViewCash())storeSubItems.push({id:'store-cash-ledger',label:'💰 Cash Ledger'});
    storeSubItems.push({id:'store-inventory',label:'Inventory'});
    storeSubItems.push({id:'store-receive',label:'Receive Stock'});
    storeSubItems.push({id:'store-issue',label:'Issue Stock'});
    storeSubItems.push({id:'store-log',label:'Stock Log'});
    storeSubItems.push({id:'store-analytics',label:'Analytics'});
    storeSubItems.push({id:'store-templates',label:'Trim Templates'});
    storeSubItems.push({id:'po-issue-list',label:'PO Issue Requests'});
    if(typeof _canApproveEdits==='function'&&_canApproveEdits())storeSubItems.push({id:'po-edit-inbox',label:'Edit Inbox'});
  }

  // Desktop sidebar uses the same worker-aware list as the mobile "More" sheet
  // so workers (asghar, zohaib, waqas, haris) see the printing pages they're
  // entitled to instead of a navless sidebar.
  const printSubItems=isStore?[]:printItems;

  const mainNav=mainItems.map(i=>`<div class="nav-item" id="nav-${i.id}" onclick="window.showPage('${i.id}')">${i.label}</div>`).join('');
  const storeOpen=currentPage.startsWith('store-')||isStore;
  // Workers have very few printing items, so default the section open for them
  // (one extra tap to discover their only printing-jobs link feels punitive).
  const printOpen=isWorker||['recipe-directory','printing-jobs','observer-tower','recipe-create','recipe-detail','printing-job-detail','qc-report-page','billing-detail','color-library'].includes(currentPage)||currentPage.startsWith('recipe-')||currentPage.startsWith('printing-')||currentPage==='observer-tower';
  const hrmOpen=currentPage.startsWith('hrm-');
  const storeNav=storeSubItems.length?`
    <div class="nav-divider"></div>
    <div class="nav-item" id="nav-store-toggle" onclick="window.toggleStoreNav()" style="display:flex;justify-content:space-between;align-items:center">
      <span>Store</span><span id="store-nav-arrow" style="font-size:10px;transition:transform .2s">${storeOpen?'▾':'▸'}</span>
    </div>
    <div id="store-subnav" style="overflow:hidden;transition:max-height .2s;max-height:${storeOpen?(storeSubItems.length*40+8)+'px':'0'}">
      ${storeSubItems.map(i=>`<div class="nav-item" id="nav-${i.id}" onclick="window.showPage('${i.id}')" style="padding-left:22px;font-size:12px">${i.label}</div>`).join('')}
    </div>`:'';
  const printNav=printSubItems.length?`
    <div class="nav-divider"></div>
    <div class="nav-item" id="nav-print-toggle" onclick="window.togglePrintNav()" style="display:flex;justify-content:space-between;align-items:center">
      <span>Embellishments Department</span><span id="print-nav-arrow" style="font-size:10px;transition:transform .2s">${printOpen?'▾':'▸'}</span>
    </div>
    <div id="print-subnav" style="overflow:hidden;transition:max-height .2s;max-height:${printOpen?(printSubItems.length*40+8)+'px':'0'}">
      ${printSubItems.map(i=>`<div class="nav-item" id="nav-${i.id}" onclick="window.showPage('${i.id}')" style="padding-left:22px;font-size:12px">${i.label}</div>`).join('')}
    </div>`:'';

  const hrmNav=hrmSubItems.length?`
    <div class="nav-divider"></div>
    <div class="nav-item" id="nav-hrm-toggle" onclick="window.toggleHRMNav()" style="display:flex;justify-content:space-between;align-items:center">
      <span>HRM</span><span id="hrm-nav-arrow" style="font-size:10px;transition:transform .2s">${hrmOpen?'▾':'▸'}</span>
    </div>
    <div id="hrm-subnav" style="overflow:hidden;transition:max-height .2s;max-height:${hrmOpen?(hrmSubItems.length*40+8)+'px':'0'}">
      ${hrmSubItems.map(i=>`<div class="nav-item" id="nav-${i.id}" onclick="window.showPage('${i.id}')" style="padding-left:22px;font-size:12px"><span class="icon">${i.iconName?_icon(i.iconName,16):''}</span>${i.label}</div>`).join('')}
    </div>`:'';

  document.getElementById('sidebar').innerHTML=mainNav+printNav+storeNav+hrmNav;
  // ── Mobile bottom nav: 5-button "More" pattern (3 buttons for workers) ──
  _renderMobNav({isOwner,isWorker,isViewer,isStore,om,canPO,printItems,storeSubItems,hrmSubItems,mainItems});
}

// Inline SVG icon set — monochrome line icons that inherit colour from
// the surrounding element. 24×24 viewBox, currentColor stroke.
function _icon(name,size){
  size=size||20;
  const svgs={
    home:    '<path d="M3 11l9-8 9 8v10a2 2 0 01-2 2h-4v-7h-6v7H5a2 2 0 01-2-2V11z"/>',
    po:      '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
    door:    '<path d="M5 3h10v18H5zM15 12h5"/><circle cx="12" cy="12" r="0.6"/>',
    people:  '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M22 19c0-2.5-2-4.5-4.5-4.5"/>',
    more:    '<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>',
    plus:    '<path d="M12 5v14M5 12h14"/>',
    box:     '<path d="M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10"/>',
    tray:    '<path d="M3 13h6l1 2h4l1-2h6v6H3zM3 13l3-8h12l3 8"/>',
    clock:   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    money:   '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v6M18 9v6"/>',
    list:    '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    gear:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5h0a1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    user:    '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    palette: '<path d="M12 3a9 9 0 100 18 3 3 0 003-3 1.5 1.5 0 011.5-1.5H18a3 3 0 003-3A9 9 0 0012 3z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/>',
    print:   '<rect x="6" y="3" width="12" height="6"/><path d="M6 17H4a2 2 0 01-2-2v-3a2 2 0 012-2h16a2 2 0 012 2v3a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>',
    shop:    '<path d="M3 9h18l-2 11H5L3 9z"/><path d="M8 9V6a4 4 0 018 0v3"/>',
    activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    eye:     '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
  };
  const inner=svgs[name]||'';
  return`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function _mobNavBtn(id,iconName,label,onclick){
  return`<button class="mob-nav-btn" id="mobnav-${id}" data-mob-id="${id}" onclick="${onclick}"><span class="icon">${_icon(iconName,22)}</span><span>${label}</span></button>`;
}

function _renderMobNav(ctx){
  const{isOwner,isWorker,isViewer,isStore,om,canPO}=ctx;
  const mob=document.getElementById('mob-nav');
  if(!mob)return;
  let html='',cols=5;

  if(session&&session.role==='fulfillment'){
    // Fulfilment (Umair): Analytics · Record · Log.
    mob.className='cols-3';
    mob.style.gridTemplateColumns='';
    mob.innerHTML=_mobNavBtn('fulfillment','activity','Analytics',"window.showFulfillTab('analytics')")
                 +_mobNavBtn('fulfillment-entry','plus','Record',"window.showFulfillTab('entry')")
                 +_mobNavBtn('fulfillment-log','list','Log',"window.showFulfillTab('log')");
    _updateMobNavActive(currentPage);
    return;
  }

  if(isWorker||isViewer){
    // Workers/viewers: 3-button nav
    cols=3;
    html=_mobNavBtn('my-work','home','My Work',"window.showPage('my-work')")
        +_mobNavBtn('gatepass','door','Gate Pass',"window.showPage('gatepass')")
        +_mobNavBtn('me','user','Me',"window.showPage('me')");
  } else if(isStore){
    // Store role (Raees): 5-button store-focused
    cols=5;
    html=_mobNavBtn('store-dashboard','home','Home',"window.showPage('store-dashboard')")
        +_mobNavBtn('store-inventory','box','Inventory',"window.showPage('store-inventory')")
        +_mobNavBtn('store-receive','plus','Receive',"window.showPage('store-receive')")
        +_mobNavBtn('store-issue','tray','Issue',"window.showPage('store-issue')")
        +_mobNavBtn('more','more','More','window.openStoreMoreSheet()');
  } else {
    // Owner / Manager: 5-button with More pattern
    cols=5;
    html=_mobNavBtn('dashboard','home','Home',"window.showPage('dashboard')")
        +_mobNavBtn('po','po','PO','window.openPOSheet()')
        +_mobNavBtn('gatepass','door','Gate Pass',"window.showPage('gatepass')")
        +(om?_mobNavBtn('hrm','people','HRM','window.openHRMSheet()'):'')
        +_mobNavBtn('more','more','More','window.openMoreSheet()');
  }
  mob.className=cols===3?'cols-3':'';
  mob.innerHTML=html;
  _updateMobNavActive(currentPage);
}

function _updateMobNavActive(pageId){
  document.querySelectorAll('#mob-nav .mob-nav-btn').forEach(b=>b.classList.remove('active'));
  // Direct page → button mapping
  const direct=document.querySelector(`#mob-nav [data-mob-id="${pageId}"]`);
  if(direct){direct.classList.add('active');return;}
  // Group mappings (page belongs to a sheet group)
  const groups={
    'po-create':'po','po-registry':'po','po-detail':'po','stage-work':'po',
    'attendance':'hrm','hrm-employees':'hrm','hrm-payroll':'hrm','hrm-advances':'hrm','hrm-loans':'hrm','hrm-policy':'hrm',
    'recipe-directory':'more','recipe-create':'more','recipe-detail':'more','recipe-draft':'more','recipe-draft-review':'more','printing-jobs':'more','printing-job-detail':'more','observer-tower':'more','qc-report-page':'more','billing-detail':'more','color-library':'more',
    'store-dashboard':'more','store-inventory':'more','store-receive':'more','store-issue':'more','store-log':'more','store-analytics':'more','store-templates':'more','po-issue-list':'more','po-issue-detail':'more','po-edit-inbox':'more','store-cash-ledger':'more',
    'activity':'more','users':'more','bug-tracker':'more','shopify-intel':'more','fulfillment':'more',
    'my-work':'my-work'
  };
  const grp=groups[pageId];
  if(grp){
    const btn=document.querySelector(`#mob-nav [data-mob-id="${grp}"]`);
    if(btn)btn.classList.add('active');
  }
}

window.toggleStoreNav=function(){
  const sub=document.getElementById('store-subnav');
  const arrow=document.getElementById('store-nav-arrow');
  if(!sub)return;
  const open=sub.style.maxHeight!=='0px'&&sub.style.maxHeight!=='0';
  sub.style.maxHeight=open?'0':'300px';
  if(arrow)arrow.textContent=open?'▸':'▾';
};
window.togglePrintNav=function(){
  const sub=document.getElementById('print-subnav');
  const arrow=document.getElementById('print-nav-arrow');
  if(!sub)return;
  const open=sub.style.maxHeight!=='0px'&&sub.style.maxHeight!=='0';
  sub.style.maxHeight=open?'0':'300px';
  if(arrow)arrow.textContent=open?'▸':'▾';
};
window.toggleHRMNav=function(){
  const sub=document.getElementById('hrm-subnav');
  const arrow=document.getElementById('hrm-nav-arrow');
  if(!sub)return;
  const open=sub.style.maxHeight!=='0px'&&sub.style.maxHeight!=='0';
  sub.style.maxHeight=open?'0':'300px';
  if(arrow)arrow.textContent=open?'▸':'▾';
};

// ── Mobile bottom-sheet menu ──
window.openMobSheet=function(title,items){
  const sheet=document.getElementById('mob-sheet');
  const back=document.getElementById('mob-sheet-backdrop');
  const titleEl=document.getElementById('mob-sheet-title');
  const itemsEl=document.getElementById('mob-sheet-items');
  if(!sheet||!back||!itemsEl)return;
  titleEl.textContent=title||'';
  titleEl.style.display=title?'block':'none';
  itemsEl.innerHTML=items.map(it=>{
    const active=it.pageId&&currentPage===it.pageId?' active':'';
    const handler=it.onClick?it.onClick:`window.showPage('${it.pageId}');window.closeMobSheet()`;
    const iconHTML=it.iconName?_icon(it.iconName,20):(it.icon||'');
    return`<button class="mob-sheet-item${active}" onclick="${handler}"><span class="icon">${iconHTML}</span><span>${it.label}</span></button>`;
  }).join('');
  // Force reflow for transition
  back.classList.add('open');
  requestAnimationFrame(()=>sheet.classList.add('open'));
};
window.closeMobSheet=function(){
  const sheet=document.getElementById('mob-sheet');
  const back=document.getElementById('mob-sheet-backdrop');
  if(sheet)sheet.classList.remove('open');
  if(back)back.classList.remove('open');
};
// Close sheet on Escape

window.openPOSheet=function(){
  const items=[];
  if(session.canPO)items.push({iconName:'plus',label:'New PO',pageId:'po-create'});
  items.push({iconName:'po',label:'PO Registry',pageId:'po-registry'});
  window.openMobSheet('Production Orders',items);
};

window.openHRMSheet=function(){
  const isOM=session&&['owner','manager'].includes(session.role);
  if(!isOM)return;
  const items=[
    {iconName:'clock',label:'Attendance',pageId:'attendance'},
    {iconName:'people',label:'Employees',pageId:'hrm-employees'},
    {iconName:'money',label:'Payroll',pageId:'hrm-payroll'},
    {iconName:'list',label:'Advances',pageId:'hrm-advances'},
    {iconName:'money',label:'Loans',pageId:'hrm-loans'},
    {iconName:'gear',label:'Policy Engine',pageId:'hrm-policy'}
  ];
  window.openMobSheet('HRM',items);
};

window.openMoreSheet=function(){
  const isOwner=session.role==='owner';
  const om=isOwner||session.role==='manager';
  const items=[];
  if(session.canPO)items.push({iconName:'plus',label:'New PO',pageId:'po-create'});
  items.push({iconName:'po',label:'PO Registry',pageId:'po-registry'});
  if(om||session.canFabric)items.push({iconName:'box',label:'Fabric Inventory',pageId:'fabric-inventory'});
  if(om)items.push({iconName:'activity',label:'Daily Performance',pageId:'fulfillment'});
  // Embellishments dept items (visible to owners/managers + relevant workers)
  if(om||session.u==='ammar'||session.u==='haris'||(typeof isPrintWorker==='function'&&isPrintWorker()))items.push({iconName:'palette',label:'Recipe Directory',pageId:'recipe-directory'});
  if(om||['asghar','zohaib','waqas','haris'].includes(session.u))items.push({iconName:'print',label:'Embellishment Jobs',pageId:'printing-jobs'});
  if(om)items.push({iconName:'eye',label:'Observer Tower',pageId:'observer-tower'});
  if(typeof canManageRecipes==='function'&&(canManageRecipes()||(typeof isQCWorker==='function'&&isQCWorker())))items.push({iconName:'palette',label:'Color Library',pageId:'color-library'});
  // Store — opens a full sub-menu (Dashboard, Cash Ledger, Inventory, …)
  items.push({iconName:'shop',label:'Store ›',onClick:'window.openStoreSubSheet()'});
  // Owner-only
  if(om)items.push({iconName:'list',label:'Bug Tracker',pageId:'bug-tracker'});
  if(isOwner)items.push({iconName:'shop',label:'Inventory Intel',pageId:'shopify-intel'});
  if(isOwner)items.push({iconName:'activity',label:'Activity Log',pageId:'activity'});
  if(isOwner)items.push({iconName:'user',label:'Users',pageId:'users'});
  window.openMobSheet('More',items);
};

// Full Store sub-menu — reached by tapping "Store ›" in the main More sheet,
// so every store page (incl. Cash Ledger) is reachable on mobile.
window.openStoreSubSheet=function(){
  const items=[
    {iconName:'home',label:'Store Dashboard',pageId:'store-dashboard'},
    {iconName:'box',label:'Inventory',pageId:'store-inventory'},
    {iconName:'plus',label:'Receive Stock',pageId:'store-receive'},
    {iconName:'tray',label:'Issue Stock',pageId:'store-issue'},
    {iconName:'activity',label:'Stock Log',pageId:'store-log'}
  ];
  if(typeof _canViewCash==='function'&&_canViewCash())items.push({iconName:'activity',label:'💰 Cash Ledger',pageId:'store-cash-ledger'});
  items.push(
    {iconName:'activity',label:'Analytics',pageId:'store-analytics'},
    {iconName:'list',label:'Trim Templates',pageId:'store-templates'},
    {iconName:'tray',label:'PO Issue Requests',pageId:'po-issue-list'}
  );
  if(typeof _canApproveEdits==='function'&&_canApproveEdits())items.push({iconName:'list',label:'Edit Inbox',pageId:'po-edit-inbox'});
  window.openMobSheet('Store',items);
};

window.openStoreMoreSheet=function(){
  const items=[];
  if(typeof _canViewCash==='function'&&_canViewCash())items.push({iconName:'activity',label:'💰 Cash Ledger',pageId:'store-cash-ledger'});
  items.push(
    {iconName:'activity',label:'Stock Log',pageId:'store-log'},
    {iconName:'activity',label:'Analytics',pageId:'store-analytics'},
    {iconName:'list',label:'Trim Templates',pageId:'store-templates'},
    {iconName:'tray',label:'PO Issue Requests',pageId:'po-issue-list'}
  );
  if(typeof _canApproveEdits==='function'&&_canApproveEdits())items.push({iconName:'list',label:'Edit Inbox',pageId:'po-edit-inbox'});
  window.openMobSheet('More',items);
};

window._hrmNotifAction=function(url){
  if(!url)return;
  const colonIdx=url.indexOf(':');
  if(colonIdx>-1){
    const page=url.slice(0,colonIdx);
    const id=url.slice(colonIdx+1);
    if(id)_issueViewingId=id;
    window.showPage(page);
  }else{
    window.showPage(url);
  }
};

window.showPage=async function(id){
  // Fulfilment account is scoped to Daily Performance — ignore any nav to
  // other pages (e.g. the topbar logo's dashboard link).
  if(session&&session.role==='fulfillment'&&id!=='fulfillment')id='fulfillment';
  currentPage=id;
  document.querySelectorAll('.nav-item,.mob-nav-item').forEach(n=>n.classList.remove('on'));
  document.getElementById('nav-'+id)?.classList.add('on');
  document.getElementById('mobnav-'+id)?.classList.add('on');
  if(typeof _updateMobNavActive==='function')_updateMobNavActive(id);
  if(typeof closeMobSheet==='function')window.closeMobSheet();
  // Auto-open dropdowns when navigating to sub-pages
  if(id.startsWith('store-')||id.startsWith('po-issue-')||id==='po-edit-inbox'){
    const sub=document.getElementById('store-subnav');
    const arrow=document.getElementById('store-nav-arrow');
    if(sub&&sub.style.maxHeight==='0px'){sub.style.maxHeight='300px';if(arrow)arrow.textContent='▾';}
  }
  if(id.startsWith('recipe-')||id.startsWith('printing-')||id==='observer-tower'||id==='qc-report-page'||id==='billing-detail'){
    const sub=document.getElementById('print-subnav');
    const arrow=document.getElementById('print-nav-arrow');
    if(sub&&sub.style.maxHeight==='0px'){sub.style.maxHeight='300px';if(arrow)arrow.textContent='▾';}
  }
  // Lazy-load store data on first store page visit
  if((id.startsWith('store-')||id.startsWith('po-issue-')||id==='po-edit-inbox')&&!allItems.length){await loadStoreData();}
  renderPage(id);
};

function renderPage(id){
  const m=document.getElementById('main-content');
  if(id==='dashboard'){m.innerHTML=renderDashboard(); if(typeof _hrmPopulateDashboard==='function')setTimeout(_hrmPopulateDashboard,0);}
  else if(id==='po-create')m.innerHTML=renderPOCreate();
  else if(id==='po-registry')m.innerHTML=renderRegistry();
  else if(id==='my-work'){m.innerHTML=renderMyWork(); if(typeof _populateWorkerHRMWidget==='function')setTimeout(_populateWorkerHRMWidget,0);}
  else if(id==='me'){m.innerHTML=renderMePage(); if(typeof _populateWorkerHRMWidget==='function')setTimeout(_populateWorkerHRMWidget,0);}
  else if(id==='gatepass'){gpPage=1;m.innerHTML=renderGatePass();window.switchGPTab(gpActiveTab||'outward');}
  else if(id==='fabric-inventory'){_fabInvDrillKey=null;m.innerHTML=renderFabricPage();window.switchFabTab('stock');}
  else if(id==='fulfillment'){if(!fulfillReportsLoaded){m.innerHTML=gvSkeleton(6);loadFulfillmentData().then(()=>{if(currentPage===id)m.innerHTML=renderFulfillmentPage();});}else m.innerHTML=renderFulfillmentPage();}
  else if(id==='activity'){loadActivity();return;}
  else if(id==='users')m.innerHTML=renderUsers();
  else if(id==='bug-tracker'){
    if(!bugsLoaded){m.innerHTML=gvSkeleton(6);loadBugReports().then(()=>{if(currentPage===id)m.innerHTML=renderBugTrackerPage();}).catch(e=>{if(currentPage===id)m.innerHTML='<div class="empty">Could not load bug reports: '+(e.message||'permission denied')+'</div>';});}
    else m.innerHTML=renderBugTrackerPage();
  }
  else if(id==='po-detail')renderDetailPage();
  else if(id==='stage-work')renderStageWorkPage();
  // ── Store pages ──
  else if(id==='store-dashboard')m.innerHTML=renderStoreDashboard();
  else if(id==='store-inventory')m.innerHTML=renderInventory();
  else if(id==='store-receive'){m.innerHTML=renderStoreReceive();onRcvItemChange();}
  else if(id==='store-issue'){m.innerHTML=renderStoreIssue();onIssItemChange();loadActivePOs();}
  else if(id==='store-templates'){m.innerHTML=renderStoreTemplates();const _si=document.getElementById('tpl-prod-search');if(_si){_si.addEventListener('input',()=>filterTplProd(_si.value));_si.addEventListener('focus',()=>filterTplProd(_si.value));}}
  else if(id==='store-log'){_ilPage=1;_ilQ='';_ilPO='';m.innerHTML=renderStoreLog();refreshIssueLog();}
  else if(id==='store-analytics')m.innerHTML=renderStoreAnalytics();
  else if(id==='store-cash-ledger'){if(!cashDataLoaded){m.innerHTML=gvSkeleton(6);loadStoreCashData().then(()=>{if(currentPage===id)m.innerHTML=renderStoreCashLedger();});}else m.innerHTML=renderStoreCashLedger();}
  else if(id==='po-issue-list'){if(!allItems.length){m.innerHTML=gvSkeleton(6);loadStoreData().then(()=>{if(currentPage===id)m.innerHTML=renderPoIssueList();});}else m.innerHTML=renderPoIssueList();}
  else if(id==='po-issue-detail'){if(!allItems.length){m.innerHTML=gvSkeleton(6);loadStoreData().then(()=>{if(currentPage===id)m.innerHTML=renderPoIssuePickList();});}else m.innerHTML=renderPoIssuePickList();}
  else if(id==='po-edit-inbox'){if(!allItems.length){m.innerHTML=gvSkeleton(6);loadStoreData().then(()=>{if(currentPage===id)m.innerHTML=renderPoEditInbox();});}else m.innerHTML=renderPoEditInbox();}
  // ── Printing module pages ──
  else if(id==='recipe-directory'){if(!printingDataLoaded)loadPrintingData().then(()=>{if(currentPage===id)m.innerHTML=renderRecipeDirectory();});else m.innerHTML=renderRecipeDirectory();}
  else if(id==='recipe-create')m.innerHTML=renderRecipeCreatePage();
  else if(id==='recipe-detail')renderRecipeDetailPage();
  else if(id==='recipe-draft'){if(!printingDataLoaded)loadPrintingData().then(()=>{if(currentPage===id)m.innerHTML=renderRecipeDraftPage();});else m.innerHTML=renderRecipeDraftPage();}
  else if(id==='recipe-draft-review'){if(!printingDataLoaded)loadPrintingData().then(()=>{if(currentPage===id)renderRecipeDraftReviewPage();});else renderRecipeDraftReviewPage();}
  else if(id==='printing-jobs'){if(!printingDataLoaded)loadPrintingData().then(()=>{if(currentPage===id)m.innerHTML=renderPrintingJobsPage();});else m.innerHTML=renderPrintingJobsPage();}
  else if(id==='printing-job-detail')renderPrintingJobDetailPage();
  else if(id==='observer-tower'){if(!printingDataLoaded)loadPrintingData().then(()=>{if(currentPage===id)m.innerHTML=renderObserverTower();});else m.innerHTML=renderObserverTower();}
  else if(id==='qc-report-page')renderQCReportPage();
  else if(id==='billing-detail')renderBillingDetailPage();
  else if(id==='color-library'){if(!printingDataLoaded)loadPrintingData().then(()=>{if(currentPage===id)m.innerHTML=renderColorLibraryPage();});else m.innerHTML=renderColorLibraryPage();}
  // ── HRM module pages ──
  else if(id==='shopify-intel'){
    if(!_siLoaded){m.innerHTML=_siLoadingSkeleton();const _siProm=loadShopifyData();Promise.race([_siProm,new Promise((_,rej)=>setTimeout(()=>rej(new Error('Load timed out')),90000))]).then(()=>{if(currentPage===id)m.innerHTML=renderShopifyDashboard();}).catch(e=>{_siLoadError=(e.message||e);if(currentPage===id)m.innerHTML=renderShopifyDashboard();_siProm.then(()=>{if(currentPage===id&&_siLoaded){_siLoadError=null;m.innerHTML=renderShopifyDashboard();}}).catch(()=>{});});}
    else m.innerHTML=renderShopifyDashboard();
  }
  else if(id==='hrm-employees'){if(!hrmDataLoaded)loadHRMData().then(()=>{if(currentPage===id)m.innerHTML=renderHRMEmployeesPage();});else m.innerHTML=renderHRMEmployeesPage();}
  else if(id==='attendance'){if(!hrmDataLoaded)loadHRMData().then(()=>{if(currentPage===id){m.innerHTML=renderAttendancePage();_attendanceAfterRender();}});else{m.innerHTML=renderAttendancePage();_attendanceAfterRender();}}
  else if(id==='hrm-payroll'){
    if(!_canViewPayroll()){m.innerHTML='<div class="empty">Payroll is restricted to Afnan, Ammar and Mustafa.</div>';}
    else if(!hrmDataLoaded||!payrollDataLoaded){Promise.all([hrmDataLoaded?null:loadHRMData(),payrollDataLoaded?null:loadPayrollData()]).then(()=>{if(currentPage===id){m.innerHTML=renderPayrollPage();_payrollAfterRender();}});}
    else {m.innerHTML=renderPayrollPage();_payrollAfterRender();}
  }
  else if(id==='hrm-advances'){
    if(!_canViewHRMOps()){m.innerHTML='<div class="empty">Restricted to Afnan, Ammar and Mustafa.</div>';}
    else if(!hrmDataLoaded||!hrmS4DataLoaded){Promise.all([hrmDataLoaded?null:loadHRMData(),hrmS4DataLoaded?null:loadHRMSession4Data()]).then(()=>{if(currentPage===id)m.innerHTML=renderAdvancesPage();});}
    else m.innerHTML=renderAdvancesPage();
  }
  else if(id==='hrm-loans'){
    if(!_canViewHRMOps()){m.innerHTML='<div class="empty">Restricted to Afnan, Ammar and Mustafa.</div>';}
    else if(!hrmDataLoaded||!hrmS4DataLoaded){Promise.all([hrmDataLoaded?null:loadHRMData(),hrmS4DataLoaded?null:loadHRMSession4Data()]).then(()=>{if(currentPage===id)m.innerHTML=renderLoansPage();});}
    else m.innerHTML=renderLoansPage();
  }
  else if(id==='hrm-policy'){
    if(!_canViewHRMOps()){m.innerHTML='<div class="empty">Restricted to Afnan, Ammar and Mustafa.</div>';}
    else if(!hrmDataLoaded||!hrmS4DataLoaded){Promise.all([hrmDataLoaded?null:loadHRMData(),hrmS4DataLoaded?null:loadHRMSession4Data()]).then(()=>{if(currentPage===id)m.innerHTML=renderPolicyEnginePage();});}
    else m.innerHTML=renderPolicyEnginePage();
  }
}

// ── Dashboard — extended in Chunk 5 with printing KPI strip ──

const BUG_PAGE_NAMES={
  'dashboard':'Dashboard',
  'po-create':'New PO',
  'po-registry':'PO Registry',
  'po-detail':'PO Detail',
  'stage-work':'Stage Work',
  'my-work':'My Work',
  'me':'Worker Me',
  'gatepass':'Gate Pass',
  'fabric-inventory':'Fabric Inventory',
  'fulfillment':'Daily Performance',
  'attendance':'HRM Attendance',
  'hrm-employees':'HRM Employees',
  'hrm-payroll':'HRM Payroll',
  'hrm-advances':'HRM Advances',
  'hrm-loans':'HRM Loans',
  'hrm-policy':'HRM Policy Engine',
  'store-dashboard':'Store Dashboard',
  'store-inventory':'Store Inventory',
  'store-receive':'Store Receive',
  'store-issue':'Store Issue',
  'store-templates':'Trim Templates',
  'store-log':'Store Log',
  'store-cash-ledger':'Cash Ledger',
  'recipe-directory':'Recipe Directory',
  'recipe-create':'Recipe Create',
  'recipe-detail':'Recipe Detail',
  'printing-jobs':'Embellishment Jobs',
  'printing-job-detail':'Embellishment Job Detail',
  'observer-tower':'Observer Tower',
  'qc-report-page':'QC Report',
  'billing-detail':'Billing Detail',
  'color-library':'Color Library',
  'bug-tracker':'Bug Tracker',
  'activity':'Activity Log',
  'users':'Users'
};
function getCurrentPageName(){ return BUG_PAGE_NAMES[currentPage]||currentPage||'Unknown Page'; }

async function loadBugReports(){
  try{
    const snap=await getDocs(query(collection(db,'bug_reports'),orderBy('reportedAt','desc'))).catch(()=>({docs:[]}));
    allBugs=snap.docs.map(d=>({...d.data(),_id:d.id}));
    bugsLoaded=true;
    if(typeof _populateOwnerBugBanner==='function')_populateOwnerBugBanner();
  }catch(e){console.warn('loadBugReports failed:',e.message);}
}

// ── Bug report modal (any signed-in user) ──
window.openBugReportModal=function(){
  document.getElementById('hrm-modal-back')?.remove();
  const pageName=getCurrentPageName();
  const device=window.innerWidth<600?'Mobile':'Desktop';
  const back=document.createElement('div');
  back.className='hrm-modal-back';back.id='hrm-modal-back';
  back.onclick=ev=>{ if(ev.target===back)window.closeBugReportModal(); };
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:520px;padding:0;overflow:hidden">
    <div style="background:#1A1A2E;color:white;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div style="min-width:0">
        <div style="font-size:11px;letter-spacing:.06em;opacity:.6">REPORT A BUG · بگ رپورٹ</div>
        <div style="margin:4px 0 0;font-size:18px;font-weight:700">Help us improve Groovy Ops</div>
      </div>
      <button onclick="window.closeBugReportModal()" style="background:none;border:none;color:white;font-size:24px;cursor:pointer;line-height:1">×</button>
    </div>
    <div style="padding:20px">
      <div style="background:#F9FAFB;padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:11px;color:var(--muted);line-height:1.7">
        📍 Page: <strong style="color:var(--text)">${pageName}</strong><br>
        👤 Reporter: ${session.name} · ${session.role}<br>
        💻 Device: ${device}
      </div>
      <div class="field" style="margin-bottom:12px"><label>What went wrong? *</label><input id="bug-title" placeholder="e.g. Save button doesn't work on PO form"></div>
      <div class="field" style="margin-bottom:12px"><label>Describe what happened</label><textarea id="bug-description" rows="3" placeholder="e.g. Clicked save, got an error message" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:#FAFAFA;resize:vertical"></textarea></div>
      <div class="field" style="margin-bottom:12px"><label>What did you expect to happen?</label><textarea id="bug-expected" rows="2" placeholder="e.g. The PO should have been saved" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:#FAFAFA;resize:vertical"></textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div class="field"><label>Category</label><select id="bug-category">
          <option value="ui">🎨 UI / Design</option>
          <option value="data">📊 Wrong data</option>
          <option value="permission">🔒 Permission</option>
          <option value="calculation">🧮 Wrong calc</option>
          <option value="missing-feature">✨ Missing feature</option>
          <option value="other">📝 Other</option>
        </select></div>
        <div class="field"><label>How urgent?</label><select id="bug-severity">
          <option value="critical">🔴 Critical — blocks work</option>
          <option value="high">🟠 High — causes problems</option>
          <option value="medium" selected>🟡 Medium — annoying</option>
          <option value="low">🟢 Low — nice to fix</option>
        </select></div>
      </div>
      <div class="field" style="margin-bottom:6px"><label>Screenshot (optional, very helpful)</label><input id="bug-screenshot" type="file" accept="image/*" onchange="window._bugPreviewImg(this)"></div>
      <div id="bug-screenshot-preview" style="display:none;margin-top:6px"><img style="max-width:100%;border-radius:6px;border:1px solid var(--border)" /></div>
      <div id="bug-screenshot-status" style="font-size:11px;color:var(--muted);margin-top:4px"></div>
    </div>
    <div style="padding:14px 20px;border-top:1px solid var(--border);background:#F9FAFB;display:flex;gap:10px">
      <button class="btn-outline" style="flex:1" onclick="window.closeBugReportModal()">Cancel</button>
      <button class="btn-primary" style="flex:2;width:auto;margin-top:0;padding:10px" onclick="window.submitBugReport()">Submit Bug Report</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

window.closeBugReportModal=function(){
  document.getElementById('hrm-modal-back')?.remove();
};

window._bugPreviewImg=function(input){
  const wrap=document.getElementById('bug-screenshot-preview');
  if(!wrap)return;
  const file=input.files&&input.files[0];
  if(!file){wrap.style.display='none';return;}
  const img=wrap.querySelector('img');
  img.src=URL.createObjectURL(file);
  wrap.style.display='block';
};

window.submitBugReport=async function(){
  const title=document.getElementById('bug-title')?.value?.trim()||'';
  if(!title)return showToast('Please describe what went wrong.',true);
  const desc=document.getElementById('bug-description')?.value?.trim()||'';
  const exp=document.getElementById('bug-expected')?.value?.trim()||'';
  const category=document.getElementById('bug-category')?.value||'other';
  const severity=document.getElementById('bug-severity')?.value||'medium';
  const fileInput=document.getElementById('bug-screenshot');
  const statusEl=document.getElementById('bug-screenshot-status');
  let screenshotUrl='';
  if(fileInput&&fileInput.files&&fileInput.files[0]){
    if(statusEl)statusEl.textContent='Uploading screenshot…';
    try{
      screenshotUrl=await uploadToCloudinary(fileInput.files[0]);
      if(statusEl)statusEl.textContent='';
    }catch(e){
      if(statusEl)statusEl.textContent='Screenshot upload failed; submitting without it.';
      screenshotUrl='';
    }
  }
  const ref=doc(collection(db,'bug_reports'));
  const data={
    id:ref.id,
    reportedBy:session.u,
    reporterRole:session.role,
    reporterName:session.name,
    reportedAt:Date.now(),
    pageWhereOccurred:getCurrentPageName(),
    pageUrl:window.location.href,
    deviceType:window.innerWidth<600?'mobile':'desktop',
    browserInfo:(navigator.userAgent||'').slice(0,200),
    title,
    description:desc,
    expectedBehavior:exp,
    stepsToReproduce:'',
    screenshotUrl,
    category,
    severity,
    status:'open',
    priority:3,
    assignedTo:'',
    resolvedBy:'',
    resolvedAt:0,
    resolution:'',
    duplicateOfBugId:'',
    comments:[],
    upvotes:[]
  };
  try{
    await setDoc(ref,data);
    allBugs.unshift({...data,_id:ref.id});
    // Notify owners (high priority for critical)
    if(typeof _hrmNotify==='function'){
      await _hrmNotify({
        type:'bug_report',
        title:`New bug: ${title}`,
        message:`${session.name} (${session.role}) reported a ${severity} bug on ${data.pageWhereOccurred}.`,
        forRole:'owner',
        relatedTo:ref.id,
        priority:severity==='critical'?'high':'normal',
        actionRequired:severity==='critical',
        actionUrl:'bug-tracker'
      });
    }
    await logActivity('Bug reported',`${title} (${severity}) on ${data.pageWhereOccurred}`);
    if(typeof _populateOwnerBugBanner==='function')_populateOwnerBugBanner();
    showToast('Bug reported. Thank you for the feedback! 🐛');
    window.closeBugReportModal();
    if(currentPage==='bug-tracker'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderBugTrackerPage();}
  }catch(e){
    if(statusEl)statusEl.textContent='';
    showToast('Submit failed: '+e.message+' — Likely Firestore rules need publishing.',true);
  }
};

// ── Bug Tracker page ──
function renderBugTrackerPage(){
  const isOM=session&&['owner','manager'].includes(session.role);
  if(!isOM&&session.role!=='worker')return'<div class="empty">Restricted.</div>';
  // Workers see only their own bugs
  const visible=isOM?allBugs.slice():allBugs.filter(b=>b.reportedBy===session.u);
  const open=visible.filter(b=>b.status==='open'||b.status==='investigating');
  const critical=open.filter(b=>b.severity==='critical').length;
  const high=open.filter(b=>b.severity==='high').length;
  const investigating=visible.filter(b=>b.status==='investigating').length;
  const weekAgo=Date.now()-7*86400000;
  const fixedThisWeek=visible.filter(b=>b.status==='fixed'&&(b.resolvedAt||0)>weekAgo).length;
  const stats=`<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px" class="bug-stats-strip">
    <div class="card" style="padding:14px;background:var(--accent-urgent-soft)"><div style="font-size:10px;text-transform:uppercase;color:var(--accent-urgent);letter-spacing:.06em">🔴 Critical</div><div style="font-size:24px;font-weight:700;color:var(--accent-urgent);margin-top:4px">${critical}</div></div>
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">🟠 High</div><div style="font-size:24px;font-weight:700;margin-top:4px">${high}</div></div>
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">🟡 Open</div><div style="font-size:24px;font-weight:700;margin-top:4px">${open.length}</div></div>
    <div class="card" style="padding:14px;background:var(--accent-success-soft)"><div style="font-size:10px;text-transform:uppercase;color:var(--accent-success);letter-spacing:.06em">✅ Fixed (week)</div><div style="font-size:24px;font-weight:700;color:var(--accent-success);margin-top:4px">${fixedThisWeek}</div></div>
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Total</div><div style="font-size:24px;font-weight:700;margin-top:4px">${visible.length}</div></div>
  </div>`;

  // Tabs (owners/managers only — workers don't need Fix Sessions)
  const tabs=isOM?`<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px">
    <button onclick="window.bugSetTab('bugs')" style="padding:10px 16px;background:none;border:none;border-bottom:2px solid ${_bugTab==='bugs'?'#1A1A2E':'transparent'};font-weight:${_bugTab==='bugs'?'700':'500'};color:${_bugTab==='bugs'?'#1A1A2E':'var(--muted)'};cursor:pointer;font-family:inherit;font-size:13px">🐛 Bugs</button>
    <button onclick="window.bugSetTab('sessions')" style="padding:10px 16px;background:none;border:none;border-bottom:2px solid ${_bugTab==='sessions'?'#1A1A2E':'transparent'};font-weight:${_bugTab==='sessions'?'700':'500'};color:${_bugTab==='sessions'?'#1A1A2E':'var(--muted)'};cursor:pointer;font-family:inherit;font-size:13px">📦 Fix Sessions</button>
  </div>`:'';

  const head=`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
    <div>
      <div class="page-title">🐛 Bug Tracker</div>
      <div class="page-sub">${isOM?'Internal bug reports across the app':'Your reported bugs'}</div>
    </div>
    <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.openBugReportModal()">+ Report Bug</button>
  </div>
  ${stats}${tabs}`;

  if(isOM&&_bugTab==='sessions')return head+_renderFixSessionsList(visible);

  // Bugs tab
  const filters=['all','open','critical','high','investigating','fixed'];
  const filterLabels={all:'All',open:'Open',critical:'🔴 Critical',high:'🟠 High',investigating:'🔍 Investigating',fixed:'✅ Fixed'};
  const exportableCount=isOM?_getExportableBugs(visible).length:0;
  const exportBtn=isOM?`<button class="btn-outline" onclick="window.exportBugsForFix()" style="display:flex;align-items:center;gap:6px;margin-left:auto;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;font-size:12px;cursor:pointer;font-family:inherit">📤 Export for Fix <span id="export-count-badge" style="background:#E94560;color:white;font-size:10px;padding:2px 6px;border-radius:10px;font-weight:700">${exportableCount}</span></button>`:'';
  const filterBar=`<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
    ${filters.map(f=>`<button class="filter-chip ${_bugFilter===f?'active':''}" onclick="window.bugSetFilter('${f}')">${filterLabels[f]}</button>`).join('')}
    ${exportBtn}
    <select id="bug-sort" onchange="window.bugSetSort(this.value)" style="${isOM?'':'margin-left:auto;'}padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
      <option value="severity" ${_bugSort==='severity'?'selected':''}>Sort by Severity</option>
      <option value="newest" ${_bugSort==='newest'?'selected':''}>Newest First</option>
      <option value="oldest" ${_bugSort==='oldest'?'selected':''}>Oldest First</option>
      <option value="upvotes" ${_bugSort==='upvotes'?'selected':''}>Most Reported</option>
    </select>
  </div>`;
  return head+filterBar+`<div id="bug-list">${_renderBugList(visible)}</div>`;
}

// Bugs eligible for export = currently filtered visible bugs, excluding fixed/wont-fix/duplicate
function _getExportableBugs(visible){
  let list=(visible||allBugs).slice();
  if(_bugFilter==='open')list=list.filter(b=>b.status==='open'||b.status==='investigating');
  else if(_bugFilter==='critical')list=list.filter(b=>b.severity==='critical');
  else if(_bugFilter==='high')list=list.filter(b=>b.severity==='high');
  else if(_bugFilter==='investigating')list=list.filter(b=>b.status==='investigating');
  else if(_bugFilter==='fixed')list=list.filter(b=>b.status==='fixed');
  return list.filter(b=>b.status!=='fixed'&&b.status!=='wont-fix'&&b.status!=='duplicate');
}

window.bugSetTab=function(t){
  _bugTab=t;
  const m=document.getElementById('main-content');
  if(m)m.innerHTML=renderBugTrackerPage();
};

function _renderBugList(visible){
  let list=visible.slice();
  if(_bugFilter==='open')list=list.filter(b=>b.status==='open'||b.status==='investigating');
  else if(_bugFilter==='critical')list=list.filter(b=>b.severity==='critical');
  else if(_bugFilter==='high')list=list.filter(b=>b.severity==='high');
  else if(_bugFilter==='investigating')list=list.filter(b=>b.status==='investigating');
  else if(_bugFilter==='fixed')list=list.filter(b=>b.status==='fixed');
  const sevRank={critical:0,high:1,medium:2,low:3};
  if(_bugSort==='severity')list.sort((a,b)=>(sevRank[a.severity]??99)-(sevRank[b.severity]??99)||(b.reportedAt||0)-(a.reportedAt||0));
  else if(_bugSort==='newest')list.sort((a,b)=>(b.reportedAt||0)-(a.reportedAt||0));
  else if(_bugSort==='oldest')list.sort((a,b)=>(a.reportedAt||0)-(b.reportedAt||0));
  else if(_bugSort==='upvotes')list.sort((a,b)=>(b.upvotes?.length||0)-(a.upvotes?.length||0));
  if(!list.length)return'<div class="empty">No bugs match this filter.</div>';
  return list.map(b=>_bugCardHTML(b)).join('');
}

function _bugCardHTML(b){
  const sevColor={critical:'var(--accent-urgent)',high:'#C2410C',medium:'var(--accent-warning)',low:'var(--accent-success)'}[b.severity]||'var(--muted)';
  const sevIcon={critical:'🔴',high:'🟠',medium:'🟡',low:'🟢'}[b.severity]||'⚪';
  const expanded=!!_bugExpanded[b._id];
  const upCount=Array.isArray(b.upvotes)?b.upvotes.length:0;
  const upActive=Array.isArray(b.upvotes)&&b.upvotes.includes(session.u);
  const isOM=session&&['owner','manager'].includes(session.role);
  const comments=Array.isArray(b.comments)?b.comments:[];
  const commentsHTML=comments.length?comments.map(c=>`<div style="background:#fafafa;padding:8px 10px;border-radius:6px;margin-bottom:4px"><div style="font-size:11px;color:var(--muted)">${c.by||'—'} · ${_hrmTimeAgo(c.at)}</div><div style="font-size:13px;margin-top:2px">${(c.text||'').replace(/[<>]/g,'')}</div></div>`).join(''):'';
  const screenshotHTML=b.screenshotUrl?`<div style="margin-bottom:14px"><img src="${b.screenshotUrl}" style="max-width:100%;border-radius:8px;border:1px solid var(--border);cursor:pointer" onclick="window.open('${b.screenshotUrl}','_blank')"></div>`:'';
  const expectedHTML=b.expectedBehavior?`<div style="margin-bottom:14px"><div style="font-size:11px;text-transform:uppercase;color:var(--muted);margin-bottom:4px">Expected</div><div style="font-size:14px">${(b.expectedBehavior||'').replace(/[<>]/g,'')}</div></div>`:'';
  // Auto-fix detection — show badge if any comment starts with [CLAUDE_CODE_FIXED]
  const ccComment=comments.find(c=>(c.text||'').startsWith('[CLAUDE_CODE_FIXED]'));
  const ccBadge=ccComment?`<div style="background:#EAF3DE;padding:8px 12px;border-radius:6px;font-size:12px;color:#3B6D11;display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
    <span>🤖 Fixed by Claude Code · ${_hrmTimeAgo(ccComment.at)}</span>
    ${b.verified?`<span style="background:#1D9E75;color:white;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">VERIFIED</span>`:(isOM?`<button class="btn-sm" style="margin-left:auto" onclick="event.stopPropagation();window.verifyFix('${b._id}')">Verify Fix</button>`:'')}
  </div>`:'';
  const ownerActions=isOM?`<div style="display:flex;gap:6px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--border);margin-top:10px">
    <button class="btn-outline" style="font-size:11px;padding:5px 10px" onclick="window.bugAssign('${b._id}')">📌 Assign</button>
    <button class="btn-outline" style="font-size:11px;padding:5px 10px" onclick="window.bugUpdateStatus('${b._id}','investigating')">🔍 Investigating</button>
    <button class="btn-outline" style="font-size:11px;padding:5px 10px;color:var(--accent-success);border-color:var(--accent-success)" onclick="window.bugUpdateStatus('${b._id}','fixed')">✅ Mark Fixed</button>
    <button class="btn-outline" style="font-size:11px;padding:5px 10px" onclick="window.bugUpdateStatus('${b._id}','wont-fix')">❌ Won't Fix</button>
    <button class="btn-outline" style="font-size:11px;padding:5px 10px" onclick="window.bugMarkDuplicate('${b._id}')">🔗 Duplicate</button>
  </div>`:'';
  return`<div class="card bug-card ${expanded?'expanded':''}" style="padding:16px;margin-bottom:10px;border-left:3px solid ${sevColor}" id="bug-card-${b._id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;cursor:pointer;gap:10px;flex-wrap:wrap" onclick="window.bugToggleCard('${b._id}')">
      <div style="flex:1;min-width:200px">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span class="severity-badge ${b.severity}">${sevIcon} ${b.severity}</span>
          <span class="bug-status-badge ${b.status}">${b.status}</span>
          <span class="bug-cat-badge">${b.category||'other'}</span>
        </div>
        <div style="font-weight:600;font-size:15px;margin-top:8px">${(b.title||'').replace(/[<>]/g,'')}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">Reported by ${b.reporterName||'—'} (${b.reporterRole||'—'}) · ${_hrmTimeAgo(b.reportedAt)} · on <strong>${b.pageWhereOccurred||'—'}</strong></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button onclick="event.stopPropagation();window.bugUpvote('${b._id}')" style="background:${upActive?'var(--accent-success-soft)':'#fff'};border:1px solid ${upActive?'var(--accent-success)':'var(--border)'};border-radius:20px;padding:4px 10px;font-size:12px;cursor:pointer;color:${upActive?'var(--accent-success)':'var(--text)'}">👍 ${upCount}</button>
        <span class="bug-arrow">▼</span>
      </div>
    </div>
    <div class="bug-card-expanded" style="display:${expanded?'block':'none'};margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
      ${ccBadge}
      <div style="margin-bottom:14px"><div style="font-size:11px;text-transform:uppercase;color:var(--muted);margin-bottom:4px">Description</div><div style="font-size:14px">${(b.description||'(none)').replace(/[<>]/g,'')}</div></div>
      ${expectedHTML}
      ${screenshotHTML}
      ${b.assignedTo?`<div style="font-size:12px;color:var(--muted);margin-bottom:8px">Assigned to: <strong>${b.assignedTo}</strong></div>`:''}
      ${b.resolution?`<div style="font-size:12px;color:var(--accent-success);margin-bottom:8px">Resolution: ${(b.resolution||'').replace(/[<>]/g,'')}</div>`:''}
      ${b.duplicateOfBugId?`<div style="font-size:12px;color:var(--muted);margin-bottom:8px">Duplicate of: ${b.duplicateOfBugId}</div>`:''}
      ${comments.length?`<div style="margin-bottom:10px"><div style="font-size:11px;text-transform:uppercase;color:var(--muted);margin-bottom:6px">Comments (${comments.length})</div>${commentsHTML}</div>`:''}
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <input type="text" id="bug-comment-${b._id}" placeholder="Add comment…" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:#FAFAFA">
        <button class="btn-outline" style="font-size:12px;padding:6px 14px" onclick="window.bugAddComment('${b._id}')">Send</button>
      </div>
      ${ownerActions}
    </div>
  </div>`;
}

window.bugSetFilter=function(f){_bugFilter=f;const m=document.getElementById('main-content');if(m)m.innerHTML=renderBugTrackerPage();};
window.bugSetSort=function(s){_bugSort=s;const m=document.getElementById('main-content');if(m)m.innerHTML=renderBugTrackerPage();};

window.bugToggleCard=function(id){
  _bugExpanded[id]=!_bugExpanded[id];
  const card=document.getElementById('bug-card-'+id);
  if(card)card.classList.toggle('expanded',_bugExpanded[id]);
};

window.bugUpvote=async function(id){
  const b=allBugs.find(x=>x._id===id);if(!b)return;
  const ups=Array.isArray(b.upvotes)?b.upvotes.slice():[];
  const me=session.u;
  if(ups.includes(me))ups.splice(ups.indexOf(me),1); else ups.push(me);
  try{
    await updateDoc(doc(db,'bug_reports',id),{upvotes:ups});
    b.upvotes=ups;
    if(currentPage==='bug-tracker'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderBugTrackerPage();}
  }catch(e){showToast('Upvote failed: '+e.message,true);}
};

window.bugAddComment=async function(id){
  const input=document.getElementById('bug-comment-'+id);
  const text=input?.value?.trim()||'';
  if(!text)return;
  const b=allBugs.find(x=>x._id===id);if(!b)return;
  const comments=Array.isArray(b.comments)?b.comments.slice():[];
  comments.push({by:session.name,at:Date.now(),text});
  try{
    await updateDoc(doc(db,'bug_reports',id),{comments});
    b.comments=comments;
    if(input)input.value='';
    // Notify the original reporter (unless they're the commenter)
    if(b.reportedBy&&b.reportedBy!==session.u&&typeof _hrmNotify==='function'){
      await _hrmNotify({
        type:'bug_comment',
        title:'New comment on your bug report',
        message:`${session.name}: "${text.slice(0,160)}"`,
        forUser:b.reportedBy,
        relatedTo:id,
        priority:'normal',
        actionUrl:'bug-tracker'
      });
    }
    if(currentPage==='bug-tracker'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderBugTrackerPage();_bugExpanded[id]=true;const c=document.getElementById('bug-card-'+id);if(c)c.classList.add('expanded');}
  }catch(e){showToast('Comment failed: '+e.message,true);}
};

window.bugAssign=async function(id){
  if(!session||!['owner','manager'].includes(session.role))return showToast('Owners/managers only.',true);
  const b=allBugs.find(x=>x._id===id);if(!b)return;
  const who=prompt('Assign this bug to (username):',b.assignedTo||'');
  if(who==null)return;
  try{
    await updateDoc(doc(db,'bug_reports',id),{assignedTo:who.trim()});
    b.assignedTo=who.trim();
    await logActivity('Bug assigned',`${b.title} → ${who.trim()}`);
    showToast('Assigned ✓');
    if(currentPage==='bug-tracker'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderBugTrackerPage();_bugExpanded[id]=true;}
  }catch(e){showToast('Assign failed: '+e.message,true);}
};

window.bugUpdateStatus=async function(id,newStatus){
  if(!session||!['owner','manager'].includes(session.role))return showToast('Owners/managers only.',true);
  const b=allBugs.find(x=>x._id===id);if(!b)return;
  let resolution='';
  if(newStatus==='fixed'||newStatus==='wont-fix'){
    resolution=prompt(newStatus==='fixed'?'What was fixed? (optional)':'Reason for not fixing? (optional)','')||'';
  }
  const update={status:newStatus};
  if(newStatus==='fixed'){update.resolvedBy=session.name;update.resolvedAt=Date.now();update.resolution=resolution;}
  else if(newStatus==='wont-fix'){update.resolution=resolution;update.resolvedBy=session.name;update.resolvedAt=Date.now();}
  try{
    await updateDoc(doc(db,'bug_reports',id),update);
    Object.assign(b,update);
    // Notify reporter
    if(b.reportedBy&&typeof _hrmNotify==='function'){
      const titles={investigating:'Your bug is being investigated',fixed:'Your bug has been fixed! ✅',"wont-fix":'Your bug report has been reviewed','open':'Your bug was reopened'};
      await _hrmNotify({
        type:'bug_status',
        title:titles[newStatus]||`Bug status: ${newStatus}`,
        message:`"${b.title}" — ${newStatus}${resolution?'. '+resolution:''}`,
        forUser:b.reportedBy,
        relatedTo:id,
        priority:newStatus==='fixed'?'normal':'normal',
        actionUrl:'bug-tracker'
      });
    }
    await logActivity('Bug '+newStatus,`${b.title}${resolution?' · '+resolution:''}`);
    showToast(`Marked ${newStatus} ✓`);
    if(typeof _populateOwnerBugBanner==='function')_populateOwnerBugBanner();
    if(currentPage==='bug-tracker'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderBugTrackerPage();}
  }catch(e){showToast('Update failed: '+e.message,true);}
};

window.bugMarkDuplicate=async function(id){
  if(!session||!['owner','manager'].includes(session.role))return showToast('Owners/managers only.',true);
  const b=allBugs.find(x=>x._id===id);if(!b)return;
  const dup=prompt('Duplicate of which bug ID?','');
  if(!dup||!dup.trim())return;
  try{
    await updateDoc(doc(db,'bug_reports',id),{status:'duplicate',duplicateOfBugId:dup.trim(),resolvedBy:session.name,resolvedAt:Date.now()});
    Object.assign(b,{status:'duplicate',duplicateOfBugId:dup.trim(),resolvedBy:session.name,resolvedAt:Date.now()});
    await logActivity('Bug marked duplicate',`${b.title} → ${dup.trim()}`);
    showToast('Marked duplicate ✓');
    if(typeof _populateOwnerBugBanner==='function')_populateOwnerBugBanner();
    if(currentPage==='bug-tracker'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderBugTrackerPage();}
  }catch(e){showToast('Failed: '+e.message,true);}
};

// ── Owner dashboard widget — critical bugs banner + general bug card ──
function _populateOwnerBugBanner(){
  if(!session||session.role!=='owner')return;
  const wrap=document.getElementById('owner-bug-banner');
  if(!wrap)return;
  const openBugs=allBugs.filter(b=>b.status==='open'||b.status==='investigating');
  const openCritical=openBugs.filter(b=>b.severity==='critical').length;
  const exportable=openBugs.filter(b=>!b.exportedForFix||b.status==='open').length;
  let html='';
  if(openCritical>0){
    html+=`<div class="card" style="padding:14px;margin-bottom:14px;background:var(--accent-urgent-soft);border-left:3px solid var(--accent-urgent);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--accent-urgent);letter-spacing:.06em;font-weight:700">⚠ Critical Bugs Open</div>
        <div style="font-size:16px;font-weight:700;margin-top:2px">${openCritical} critical bug${openCritical===1?'':'s'} need attention</div>
      </div>
      <button class="btn-primary" style="background:var(--accent-urgent);width:auto;padding:8px 16px;margin-top:0" onclick="window.showPage('bug-tracker')">View →</button>
    </div>`;
  }
  if(openBugs.length>0){
    const showExport=openBugs.length>=5;
    html+=`<div class="card" style="padding:14px;margin-bottom:16px;background:#F9FAFB">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <div style="font-size:11px;text-transform:uppercase;color:#6B7280;letter-spacing:.06em">🐛 Bug Tracker</div>
          <div style="font-size:14px;font-weight:600;margin-top:4px">${openBugs.length} open bug${openBugs.length===1?'':'s'} · ${exportable} ready to export</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-sm" onclick="window.showPage('bug-tracker')">View All</button>
          ${showExport?`<button class="btn-primary btn-sm" style="padding:5px 10px;font-size:11px;width:auto;margin-top:0" onclick="window.showPage('bug-tracker');setTimeout(()=>window.exportBugsForFix(),50)">Export Now</button>`:''}
        </div>
      </div>
    </div>`;
  }
  wrap.innerHTML=html;
}

// ───────────────────────────────────────────────────────────
// Bug Export & Batch Fix Workflow
// ───────────────────────────────────────────────────────────

window.exportBugsForFix=function(){
  if(!session||!['owner','manager'].includes(session.role))return showToast('Owners/managers only.',true);
  // Initialize filter state from defaults if first time
  if(!_bugExportSeverities)_bugExportSeverities=new Set(['critical','high','medium']);
  if(!_bugExportCategories)_bugExportCategories=new Set(['ui','data','permission','calculation']);
  document.getElementById('hrm-modal-back')?.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';back.id='hrm-modal-back';
  back.onclick=ev=>{if(ev.target===back)window.closeBugExportModal();};
  back.innerHTML=_bugExportModalShell();
  document.body.appendChild(back);
  _bugExportRefreshPreview();
};

window.closeBugExportModal=function(){
  document.getElementById('hrm-modal-back')?.remove();
};

function _bugExportModalShell(){
  return`<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:700px;border-radius:12px;padding:0;overflow:hidden;max-height:90vh;display:flex;flex-direction:column">
    <div style="background:#1A1A2E;color:white;padding:16px 20px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:11px;letter-spacing:.06em;opacity:.6">EXPORT BUGS FOR CLAUDE CODE</div>
        <h3 id="export-modal-count" style="margin:4px 0 0;font-size:18px;font-weight:700">— bugs ready to fix</h3>
      </div>
      <button onclick="window.closeBugExportModal()" style="background:none;border:none;color:white;font-size:24px;cursor:pointer;line-height:1">×</button>
    </div>
    <div style="padding:20px;flex:1;overflow-y:auto">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
        <div>
          <label style="font-size:11px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.04em">Severity to include</label>
          <div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap;font-size:12px">
            ${[['critical','🔴 Critical'],['high','🟠 High'],['medium','🟡 Medium'],['low','🟢 Low']].map(([v,lab])=>`<label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px"><input type="checkbox" ${_bugExportSeverities.has(v)?'checked':''} onchange="window._bugExportToggleSev('${v}',this.checked)"> ${lab}</label>`).join('')}
          </div>
        </div>
        <div>
          <label style="font-size:11px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.04em">Categories</label>
          <div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap;font-size:12px">
            ${[['ui','UI'],['data','Data'],['permission','Permission'],['calculation','Calculation'],['missing-feature','Features'],['other','Other']].map(([v,lab])=>`<label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px"><input type="checkbox" ${_bugExportCategories.has(v)?'checked':''} onchange="window._bugExportToggleCat('${v}',this.checked)"> ${lab}</label>`).join('')}
          </div>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <label style="font-size:11px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.04em">Generated Claude Code Prompt</label>
          <button class="btn-sm" onclick="window.copyExportText()">📋 Copy</button>
        </div>
        <textarea id="export-output" rows="20" readonly style="width:100%;padding:12px;border:1px solid #E5E5E7;border-radius:6px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;background:#F9FAFB;color:#1A1A2E;resize:vertical;line-height:1.5"></textarea>
      </div>
      <div style="background:#FAEEDA;padding:10px 12px;border-radius:6px;font-size:12px;color:#854F0B;line-height:1.5">
        💡 <strong>How to use:</strong> Click "Copy & Mark as Exported", then paste into a fresh Claude Code session. Claude Code will fix the bugs in batches and auto-mark them as fixed in your bug tracker.
      </div>
    </div>
    <div style="padding:16px 20px;border-top:1px solid #E5E5E7;background:#F9FAFB;display:flex;gap:10px">
      <button class="btn-outline" style="flex:1" onclick="window.closeBugExportModal()">Cancel</button>
      <button class="btn-primary" style="flex:2;width:auto;margin-top:0;padding:10px" onclick="window.copyAndMarkExported()">📋 Copy &amp; Mark as Exported</button>
    </div>
  </div>`;
}

window._bugExportToggleSev=function(v,on){
  if(on)_bugExportSeverities.add(v); else _bugExportSeverities.delete(v);
  _bugExportRefreshPreview();
};
window._bugExportToggleCat=function(v,on){
  if(on)_bugExportCategories.add(v); else _bugExportCategories.delete(v);
  _bugExportRefreshPreview();
};

function _bugExportRefreshPreview(){
  const bugs=getFilteredBugsForExport();
  const txt=document.getElementById('export-output');
  if(txt)txt.value=generateExportText(bugs);
  const cnt=document.getElementById('export-modal-count');
  if(cnt)cnt.textContent=`${bugs.length} open bug${bugs.length===1?'':'s'} ready to fix`;
}

function getFilteredBugsForExport(){
  return allBugs.filter(b=>
    (b.status==='open'||b.status==='investigating')&&
    _bugExportSeverities.has(b.severity)&&
    _bugExportCategories.has(b.category||'other')
  );
}

function generateExportText(bugs){
  let txt=`# GROOVY OPERATIONS — BATCH BUG FIX SESSION
Generated: ${new Date().toLocaleString()}
Repo: afnanbit2-bit/Groovy-Operations
Total bugs: ${bugs.length}

## INSTRUCTIONS FOR CLAUDE CODE

You are fixing ${bugs.length} bugs in index.html. Follow this exact protocol:

1. **Read index.html FULLY** before making any changes
2. **Group bugs by module** (PO, HRM, Store, Gate Pass, Attendance, etc.)
3. **Fix one module at a time** — small targeted edits, not rewrites
4. **After each fix**, update the bug document in Firestore collection \`bug_reports\`:
   - Set \`status: "fixed"\`
   - Set \`resolvedBy: "claude-code"\`
   - Set \`resolvedAt: <ISO timestamp>\`
   - Add to \`comments\` array: { by: "claude-code", at: "<ISO>", text: "[CLAUDE_CODE_FIXED] <description of fix>" }
   - Set \`resolution: <what was changed>\`
5. **Commit per module** with message: "Fix bugs: <module name> (<count> bugs)"
6. **Push to main** at the end
7. **Skip bugs you cannot safely fix** — leave their status as "open" and add a comment explaining why

## SEVERITY ORDER
Fix in this order: critical → high → medium → low

## CRITICAL RULES
- Do NOT rewrite existing functions — modify them surgically
- Do NOT remove features
- Do NOT change Firestore schema unless a bug requires it
- Do NOT change Firebase config
- Test mental model: "Will this break X feature that already works?"
- If unsure, skip and comment instead of breaking things

---

## BUGS TO FIX (${bugs.length} total)

`;
  if(bugs.length===0){
    txt+=`\n_No bugs match the current filter. Adjust severity/category checkboxes to include more bugs._\n`;
    return txt;
  }
  const modules=groupBugsByModule(bugs);
  for(const [moduleName,moduleBugs] of Object.entries(modules)){
    txt+=`\n### MODULE: ${moduleName} (${moduleBugs.length} bug${moduleBugs.length===1?'':'s'})\n\n`;
    moduleBugs.forEach(bug=>{
      txt+=`---\n\n`;
      txt+=`**Bug ID:** ${bug._id||bug.id||'—'}\n`;
      txt+=`**Severity:** ${(bug.severity||'medium').toUpperCase()}\n`;
      txt+=`**Category:** ${bug.category||'other'}\n`;
      txt+=`**Page:** ${bug.pageWhereOccurred||'—'}\n`;
      txt+=`**Reported by:** ${bug.reporterName||'—'} (${bug.reporterRole||'—'})\n`;
      txt+=`**Device:** ${bug.deviceType||'—'}\n\n`;
      txt+=`**Title:** ${bug.title||'(no title)'}\n\n`;
      if(bug.description)txt+=`**What happened:**\n${bug.description}\n\n`;
      if(bug.expectedBehavior)txt+=`**Expected:**\n${bug.expectedBehavior}\n\n`;
      if(bug.screenshotUrl)txt+=`**Screenshot:** ${bug.screenshotUrl}\n\n`;
      if(Array.isArray(bug.upvotes)&&bug.upvotes.length>0)txt+=`**Reported by ${bug.upvotes.length} other user${bug.upvotes.length===1?'':'s'}**\n\n`;
      if(Array.isArray(bug.comments)&&bug.comments.length>0){
        txt+=`**Comments:**\n`;
        bug.comments.forEach(c=>{txt+=`- ${c.by||'—'}: ${c.text||''}\n`;});
        txt+=`\n`;
      }
    });
  }
  txt+=`\n---\n\n## END OF BUG LIST\n\nProceed module by module. Mark each bug as fixed in Firestore as you go. Commit and push when complete.\n`;
  return txt;
}

function groupBugsByModule(bugs){
  const modules={'PO Management':[],'HRM':[],'Store':[],'Gate Pass':[],'Attendance':[],'Embellishments':[],'Other':[]};
  bugs.forEach(bug=>{
    const page=(bug.pageWhereOccurred||'').toLowerCase();
    if(page.includes('attendance'))modules['Attendance'].push(bug);
    else if(page.includes('po')||page.includes('stage work'))modules['PO Management'].push(bug);
    else if(page.includes('hrm')||page.includes('payroll')||page.includes('employee')||page.includes('advance')||page.includes('loan')||page.includes('policy')||page.includes('my work')||page.includes('worker me'))modules['HRM'].push(bug);
    else if(page.includes('store')||page.includes('inventory')||page.includes('trim'))modules['Store'].push(bug);
    else if(page.includes('gate'))modules['Gate Pass'].push(bug);
    else if(page.includes('embellishment')||page.includes('printing')||page.includes('recipe')||page.includes('observer')||page.includes('qc')||page.includes('billing')||page.includes('color library'))modules['Embellishments'].push(bug);
    else modules['Other'].push(bug);
  });
  Object.keys(modules).forEach(k=>{if(modules[k].length===0)delete modules[k];});
  return modules;
}

window.copyExportText=async function(){
  const txt=document.getElementById('export-output')?.value||'';
  if(!txt)return showToast('Nothing to copy.',true);
  try{
    await navigator.clipboard.writeText(txt);
    showToast('Copied to clipboard ✓');
  }catch(e){showToast('Copy failed: '+e.message,true);}
};

window.copyAndMarkExported=async function(){
  const txt=document.getElementById('export-output')?.value||'';
  const bugs=getFilteredBugsForExport();
  if(bugs.length===0)return showToast('No bugs match filter.',true);
  try{await navigator.clipboard.writeText(txt);}
  catch(e){showToast('Copy failed: '+e.message+' — bugs not marked.',true);return;}
  const exportSession='export-'+Date.now();
  const exportedAt=new Date().toISOString();
  try{
    const batch=writeBatch(db);
    bugs.forEach(bug=>{
      const ref=doc(db,'bug_reports',bug._id);
      batch.update(ref,{
        exportedForFix:true,
        exportedAt,
        exportSession,
        exportedBy:session.name,
        status:'investigating'
      });
    });
    await batch.commit();
    bugs.forEach(bug=>{
      Object.assign(bug,{exportedForFix:true,exportedAt,exportSession,exportedBy:session.name,status:'investigating'});
    });
    await logActivity('Bugs exported for fix',`${bugs.length} bugs · session ${exportSession}`);
    showToast(`Copied ${bugs.length} bug${bugs.length===1?'':'s'} to clipboard. Paste into Claude Code now.`);
    window.closeBugExportModal();
    if(currentPage==='bug-tracker'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderBugTrackerPage();}
    if(typeof _populateOwnerBugBanner==='function')_populateOwnerBugBanner();
  }catch(e){showToast('Mark-exported failed: '+e.message,true);}
};

// ── Verify a Claude-Code-fixed bug ──
window.verifyFix=async function(id){
  if(!session||!['owner','manager'].includes(session.role))return showToast('Owners/managers only.',true);
  const b=allBugs.find(x=>x._id===id);if(!b)return;
  const ok=confirm(`Verify the fix for "${b.title}"?\n\nClick OK if the fix works.\nClick Cancel to reopen the bug.`);
  if(ok){
    try{
      await updateDoc(doc(db,'bug_reports',id),{verified:true,verifiedBy:session.name,verifiedAt:Date.now()});
      Object.assign(b,{verified:true,verifiedBy:session.name,verifiedAt:Date.now()});
      await logActivity('Bug fix verified',b.title);
      showToast('Verified ✓');
    }catch(e){return showToast('Verify failed: '+e.message,true);}
  } else {
    const reason=prompt('Why is the fix not working?','')||'';
    try{
      const comments=Array.isArray(b.comments)?b.comments.slice():[];
      comments.push({by:session.name,at:Date.now(),text:`[VERIFY FAILED] ${reason||'Fix did not work'}`});
      await updateDoc(doc(db,'bug_reports',id),{status:'open',verified:false,resolvedBy:'',resolvedAt:0,resolution:'',comments});
      Object.assign(b,{status:'open',verified:false,resolvedBy:'',resolvedAt:0,resolution:'',comments});
      await logActivity('Bug reopened (verify failed)',`${b.title}${reason?' · '+reason:''}`);
      showToast('Reopened ✓');
    }catch(e){return showToast('Reopen failed: '+e.message,true);}
  }
  if(currentPage==='bug-tracker'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderBugTrackerPage();}
};

// ── Fix Sessions tab ──
function _renderFixSessionsList(visible){
  const sessionsMap={};
  allBugs.forEach(b=>{
    if(!b.exportSession)return;
    const s=sessionsMap[b.exportSession]||(sessionsMap[b.exportSession]={id:b.exportSession,exportedAt:b.exportedAt||'',exportedBy:b.exportedBy||'',bugs:[]});
    s.bugs.push(b);
  });
  const sessions=Object.values(sessionsMap).sort((a,b)=>(b.exportedAt||'').localeCompare(a.exportedAt||''));
  if(sessions.length===0){
    return`<div class="empty" style="padding:30px;text-align:center;color:var(--muted)">
      <div style="font-size:32px;margin-bottom:8px">📦</div>
      No fix sessions yet.<br>
      <div style="font-size:12px;margin-top:6px">Click "Export for Fix" on the Bugs tab to create your first session.</div>
    </div>`;
  }
  return sessions.map(s=>{
    const total=s.bugs.length;
    const fixedByCC=s.bugs.filter(b=>b.status==='fixed'&&Array.isArray(b.comments)&&b.comments.some(c=>(c.text||'').startsWith('[CLAUDE_CODE_FIXED]'))).length;
    const fixedAny=s.bugs.filter(b=>b.status==='fixed').length;
    const rate=total?Math.round(fixedAny/total*100):0;
    const barColor=rate>=70?'#1D9E75':(rate>=40?'#C2841A':'#E94560');
    const dt=s.exportedAt?new Date(s.exportedAt).toLocaleString():'—';
    return`<div class="card" style="padding:16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div>
          <div style="font-weight:600;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px">${s.id}</div>
          <div style="font-size:12px;color:#6B7280;margin-top:2px">Exported ${dt}${s.exportedBy?' · by '+s.exportedBy:''} · ${total} bug${total===1?'':'s'} · ${fixedByCC} fixed by Claude Code</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:24px;font-weight:700;color:${barColor}">${rate}%</div>
          <div style="font-size:11px;color:#6B7280">Fix rate</div>
        </div>
      </div>
      <div style="margin-top:10px;background:#F3F4F6;height:6px;border-radius:3px;overflow:hidden">
        <div style="background:${barColor};height:100%;width:${rate}%"></div>
      </div>
    </div>`;
  }).join('');
}


// ── App bootstrap (called by index.html module after Firebase bridge) ──
// These blocks were hoisted out of their original positions because they
// execute at load time and depend on cross-file load order / Firebase.
window.__bootApp=function(){
  // ── Auto-wire the global loaders to every Firestore op ──
  // Writes (setDoc/updateDoc/addDoc/deleteDoc/runTransaction/batch.commit)
  // raise the blocking buffer if slow; reads (getDoc/getDocs) drive the top
  // progress bar. No call site changes needed — every section is covered.
  (function(){
    const wrap=(name,start,stop)=>{const o=window[name];if(typeof o!=='function'||o.__gvWrapped)return;
      const w=function(){start();let r;try{r=o.apply(this,arguments);}catch(e){stop();throw e;}
        return Promise.resolve(r).then(v=>{stop();return v;},e=>{stop();throw e;});};
      w.__gvWrapped=true;window[name]=w;};
    ['setDoc','updateDoc','addDoc','deleteDoc','runTransaction'].forEach(n=>wrap(n,_gvWriteStart,_gvWriteStop));
    ['getDoc','getDocs'].forEach(n=>wrap(n,_gvProgStart,_gvProgStop));
    const wb=window.writeBatch;
    if(typeof wb==='function'&&!wb.__gvWrapped){
      const w=function(){const b=wb.apply(this,arguments);
        if(b&&typeof b.commit==='function'&&!b.commit.__gvWrapped){const oc=b.commit.bind(b);
          const nc=function(){_gvWriteStart();return Promise.resolve(oc()).then(v=>{_gvWriteStop();return v;},e=>{_gvWriteStop();throw e;});};
          nc.__gvWrapped=true;b.commit=nc;}
        return b;};
      w.__gvWrapped=true;window.writeBatch=w;
    }
  })();
  // showPage wrap: pulse the progress bar on nav + auto-load printing data
const _origShowPage=window.showPage;
window.showPage=async function(id){
  _gvProgPulse(500);
  // Auto-load printing data when visiting any printing page
  if(['recipe-directory','recipe-create','recipe-detail','printing-jobs','printing-job-detail','observer-tower','qc-report-page','billing-detail'].includes(id)&&!printingDataLoaded){
    await loadPrintingData();
  }
  return _origShowPage(id);
};
  // toggleNotifPanel wrap: merge HRM notifications into the panel
const _origToggleNotifPanel=window.toggleNotifPanel;
window.toggleNotifPanel=function(){
  const p=document.getElementById('notif-panel');if(!p)return;
  const open=p.style.display==='none'||!p.style.display;
  p.style.display=open?'block':'none';
  _hrmNotifPanelOpen=open;
  if(open)_renderHRMNotifPanel();
};
  // close product / gatepass dropdowns on outside click
document.addEventListener('click',e=>{
  const dd=document.getElementById('po-dropdown');
  if(dd&&!e.target.closest('#po-search')&&!e.target.closest('#po-dropdown'))dd.style.display='none';
  const dd2=document.getElementById('gp-article-dd');
  if(dd2&&!e.target.closest('#gp-article')&&!e.target.closest('#gp-article-dd'))dd2.style.display='none';
});
  // mobile sheet: Escape to close + swipe-down to dismiss
document.addEventListener('keydown',e=>{ if(e.key==='Escape')window.closeMobSheet(); });
// Swipe-down on handle to dismiss
(function(){
  let startY=null;
  document.addEventListener('touchstart',e=>{
    if(!e.target.classList||!e.target.classList.contains('mob-sheet-handle'))return;
    startY=e.touches[0].clientY;
  },{passive:true});
  document.addEventListener('touchend',e=>{
    if(startY==null)return;
    const endY=(e.changedTouches&&e.changedTouches[0]?.clientY)||startY;
    if(endY-startY>40)window.closeMobSheet();
    startY=null;
  });
})();
  // auth state -> start app / show login
onAuthStateChanged(auth,async user=>{
  if(loginInProgress)return;
  if(user&&!session){
    const saved=sessionStorage.getItem('u');
    const def=saved?USER_DEFS.find(x=>x.u===saved):null;
    if(def){session={...def,uid:user.uid};startApp();}
    else{await signOut(auth);document.getElementById('scr-login').style.display='flex';}
  }else if(!user&&!session){
    document.getElementById('scr-login').style.display='flex';
  }
});
};
