/* ─────────────────────────────────────────────────────────────────────────
   Production Ops — Urdu / English strings and helpers (13 Oct 2026).

   NOT WIRED YET: no screen calls this file. It is a table plus pure helpers for a later wave.
   Urdu is shown ON SCREEN only (the browser shapes it with the self-hosted Jameel Noori Nastaleeq
   @font-face). It must NEVER be routed to a PDF (jsPDF cannot draw it: see CLAUDE.md "Print design
   system > Fonts"). Nothing here builds HTML from a string: DOM nodes use createElement/textContent.

   The Urdu was written by Claude and has NOT been checked by an Urdu speaker. Strings marked
   review:true are the ones least sure of (technical words, long sentences).

   Public API (the only globals besides PH_I18N_*):
     phI18nT(key,params,lang)   string, never throws, falls back en then the key
     phI18nPair(key,params)     {ur,en}
     phI18nGetLang(username) / phI18nSetLang(lang) / phI18nOnChange(fn) / phI18nLangFor(username)
     phI18nNode(doc,key,params,opts)   Urdu-first block, or just English
     phI18nToggleNode(doc,username)    the Urdu / English switch
   ───────────────────────────────────────────────────────────────────────── */

const PH_I18N_URDU_FIRST_USERS=['uzaib'];
const PH_I18N_LANG_KEY='groovy-ph-lang';
const PH_I18N_LANGS=['ur-first','en'];

const PH_I18N_STR={};
// _phI18nAdd(key, English, Urdu, review?) — one line per string
function _phI18nAdd(k,en,ur,review){PH_I18N_STR[k]=review?{en:en,ur:ur,review:true}:{en:en,ur:ur};}
(function(){
  const A=_phI18nAdd;

  /* ── shell chrome ─────────────────────────────────────────────── */
  A('shell.title','Production Ops','پروڈکشن آپس');
  A('shell.title_tab','Production Ops · {tab}','پروڈکشن آپس · {tab}');
  A('shell.exit','← Exit','← باہر');
  A('shell.menu_hide','Hide menu','مینو چھپائیں');
  A('shell.menu_show','Show menu','مینو دکھائیں');
  A('shell.rail_label','Production Ops sections','پروڈکشن آپس کے حصے');
  A('shell.view_only','View only','صرف دیکھ سکتے ہیں');
  A('shell.tab_overview','Overview','خلاصہ');
  A('shell.tab_queue','PO Queue','پی او قطار');
  A('shell.tab_cutting',"Today's Cutting",'آج کی کٹنگ');
  A('shell.retry','Retry','دوبارہ کوشش');
  A('shell.refresh','Refresh','تازہ کریں');
  A('shell.refreshing','Refreshing…','تازہ ہو رہا ہے…');
  A('shell.saving','Saving…','محفوظ ہو رہا ہے…');
  A('shell.working','Working…','کام ہو رہا ہے…');
  A('shell.loading','Loading Production Ops data','ڈیٹا آ رہا ہے');
  A('shell.loading_short','Loading','لوڈ ہو رہا ہے');
  A('shell.loading_pos','Loading the POs','پی اوز لوڈ ہو رہے ہیں');
  A('shell.chip_loaded','✓ Loaded','✓ لوڈ ہو گیا');
  A('shell.chip_failed','✕ FAILED','✕ ناکام');
  A('shell.chip_loading','… Loading','… لوڈ ہو رہا ہے');
  A('shell.not_loaded','not loaded','لوڈ نہیں ہوا');
  A('shell.not_loaded_yet','not loaded yet','ابھی لوڈ نہیں ہوا');
  A('shell.read_failed','read failed','پڑھنے میں ناکامی');
  A('shell.unavailable','unavailable — {collection}','دستیاب نہیں — {collection}');
  A('shell.saved','saved','محفوظ ہے');
  A('shell.none_saved_defaults','none saved yet - defaults apply','ابھی کچھ محفوظ نہیں - ڈیفالٹ لگے ہیں');
  A('shell.record_one','{n} record','{n} ریکارڈ');
  A('shell.record_many','{n} records','{n} ریکارڈ');
  A('shell.list_cut_limit',' (list is cut at its limit)',' (فہرست حد پر کٹ گئی)');
  A('shell.data_read_open','Data read on open','کھولتے وقت پڑھا گیا ڈیٹا');
  A('shell.could_not_read_one','Could not read {n} collection','{n} کلیکشن نہیں پڑھ سکے');
  A('shell.could_not_read_many','Could not read {n} collections','{n} کلیکشنز نہیں پڑھ سکے');
  A('shell.not_shown_as_zero','Nothing below is shown as zero for a collection that failed: it reads "not loaded".','جو کلیکشن ناکام ہوئی اس کا کوئی نمبر زیرو نہیں دکھایا جاتا: وہاں "لوڈ نہیں ہوا" لکھا ہے۔');
  A('shell.no_access','No access','رسائی نہیں');
  A('shell.no_access_msg','Production Ops is for Afnan, Ammar, Mustafa and Uzaib.','پروڈکشن آپس صرف عفنان، عمار، مصطفیٰ اور عزیب کے لیے ہے۔',true);
  A('shell.restricted','Production Ops is restricted to Afnan, Ammar, Mustafa and Uzaib.','پروڈکشن آپس صرف عفنان، عمار، مصطفیٰ اور عزیب کے لیے ہے۔',true);
  A('shell.no_tabs','No tabs','کوئی ٹیب نہیں');
  A('shell.no_tabs_msg','Your account has no Production Ops tabs.','آپ کے اکاؤنٹ پر پروڈکشن آپس کا کوئی ٹیب نہیں۔');
  A('shell.tab_failed','This tab could not be drawn','یہ ٹیب کھل نہیں سکا');
  A('shell.tab_empty','This tab drew nothing.','اس ٹیب میں کچھ نہیں آیا۔');
  A('shell.data_layer_missing','js/ph-data.js did not load - refresh the page.','ڈیٹا فائل لوڈ نہیں ہوئی - پیج ریفریش کریں۔');
  A('shell.tabs_you_can_open','Tabs you can open','جو ٹیب آپ کھول سکتے ہیں');
  A('shell.you_are_here','you are here','آپ یہاں ہیں');
  A('shell.placeholder_until_built','placeholder until built','ابھی بنا نہیں');
  A('shell.overview_blurb','Production Ops shell. The modules arrive tab by tab; this page shows what the data layer has read.','پروڈکشن آپس کا ڈھانچہ۔ ٹیب ایک ایک کر کے آئیں گے؛ یہ پیج دکھاتا ہے کہ ڈیٹا کیا پڑھا گیا۔',true);
  A('shell.readonly_note',"Your account can see Overview, PO Queue and Today's Cutting. Overview is view-only: PO drafts are entered in PO Queue and the cut is recorded in Today's Cutting.",'آپ خلاصہ، پی او قطار اور آج کی کٹنگ دیکھ سکتے ہیں۔ خلاصہ صرف دیکھنے کے لیے ہے: پی او ڈرافٹ پی او قطار میں لکھے جاتے ہیں اور کٹ آج کی کٹنگ میں درج ہوتی ہے۔',true);
  A('shell.open_monitor','Open the Monitor','مانیٹر کھولیں');

  /* ── generic read failures (pos / cut jobs) ───────────────────── */
  A('err.refused','{col}: could not be read - the signed-in account is refused. Retry; if it persists, check the published firestore.rules.','{col}: پڑھا نہیں جا سکا - اس اکاؤنٹ کو اجازت نہیں۔ دوبارہ کوشش کریں؛ پھر بھی نہ ہو تو rules چیک کروائیں۔',true);
  A('err.offline_copy','{col}: only this device\'s offline copy was available, so it was not read - get a connection and retry.','{col}: صرف اس فون/پی سی کی پرانی کاپی ملی، اصل ڈیٹا نہیں پڑھا - انٹرنیٹ ملا کر دوبارہ کوشش کریں۔');
  A('err.timeout','{col}: the read did not finish in {s}s - check the connection and retry.','{col}: {s} سیکنڈ میں پڑھا نہیں گیا - انٹرنیٹ چیک کریں اور دوبارہ کوشش کریں۔');
  A('err.quota','{col}: the Firestore read quota is used up - retry later.','{col}: پڑھنے کی روزانہ حد ختم ہو گئی - بعد میں کوشش کریں۔');
  A('err.failed','{col}: read failed ({why})','{col}: پڑھنے میں ناکامی ({why})');
  A('err.not_loaded','{col}: not loaded.','{col}: لوڈ نہیں ہوا۔');

  /* ── PO Queue board ───────────────────────────────────────────── */
  A('queue.title','PO Queue','پی او قطار');
  A('queue.blurb_mgr','Every released PO as a tile, by stage. Plan a cut day and master; owners and Mustafa can force a PO forward past cutting.','ہر ریلیز پی او اپنے مرحلے کے مطابق ایک ٹائل میں۔ کٹنگ کا دن اور ماسٹر طے کریں؛ اونرز اور مصطفیٰ پی او کو کٹنگ سے آگے بھیج سکتے ہیں۔',true);
  A('queue.blurb_floor','Enter PO drafts here. The board is for looking: your account cannot plan or move a PO.','پی او ڈرافٹ یہاں لکھیں۔ بورڈ صرف دیکھنے کے لیے ہے: آپ پی او کا پلان یا مرحلہ نہیں بدل سکتے۔');
  A('queue.sections','PO Queue sections','پی او قطار کے حصے');
  A('queue.sub_board','Board','بورڈ');
  A('queue.sub_drafts','Drafts','ڈرافٹ');
  A('queue.drafts_missing','The drafts panel is not part of this build yet.','ڈرافٹ کا حصہ ابھی اس ورژن میں نہیں۔');
  A('queue.drafts_failed','The drafts panel could not be drawn','ڈرافٹ کا حصہ کھل نہیں سکا');
  A('queue.drafts_empty','The drafts panel drew nothing.','ڈرافٹ کے حصے میں کچھ نہیں آیا۔');
  A('queue.lane_cutting','Cutting','کٹنگ');
  A('queue.lane_bundling','Bundling','بنڈلنگ');
  A('queue.lane_stitching','Stitching','سلائی');
  A('queue.lane_printing','Printing','پرنٹنگ');
  A('queue.lane_washing','Washing','واشنگ');
  A('queue.lane_qc','Final QC','فائنل کیو سی');
  A('queue.lane_reserved','Reserved (not released yet)','ریزرو (ابھی ریلیز نہیں)');
  A('queue.lane_completed','Completed','مکمل');
  A('queue.lane_unknown','Stage not recognised','مرحلہ پہچانا نہیں گیا');
  A('queue.could_not_read','Could not read the POs','پی اوز پڑھ نہیں سکے');
  A('queue.could_not_refresh','Could not refresh the POs','پی اوز تازہ نہیں ہو سکے');
  A('queue.showing_from','Showing the POs read at {time} (Pakistan time).','{time} (پاکستانی وقت) پر پڑھے گئے پی اوز دکھائے جا رہے ہیں۔');
  A('queue.only_newest','Only the newest {n} POs were read; older ones are not on the board.','صرف تازہ ترین {n} پی او پڑھے گئے؛ پرانے بورڈ پر نہیں ہیں۔');
  A('queue.jobs_not_loaded','Cut plans (po_cut_jobs) are not loaded, so planned days and masters are not shown and plans cannot be changed. Use Retry in the banner above.','کٹ پلان (po_cut_jobs) لوڈ نہیں ہوئے، اس لیے پلان کا دن اور ماسٹر نظر نہیں آ رہے اور پلان بدلا نہیں جا سکتا۔ اوپر والے بینر میں دوبارہ کوشش دبائیں۔',true);
  A('queue.masters_not_loaded','Cutting masters are not loaded, so a master cannot be picked.','کٹنگ ماسٹرز لوڈ نہیں ہوئے، اس لیے ماسٹر چنا نہیں جا سکتا۔');
  A('queue.settings_not_loaded','Settings are not loaded: delay thresholds and capacity use the built-in defaults.','سیٹنگز لوڈ نہیں ہوئیں: تاخیر کی حد اور گنجائش ڈیفالٹ ہیں۔');
  A('queue.explain','Cutting moves on when the cut is recorded on the cutting screen; the other stages are completed by their own queues. Force-advance is an owner override and asks first. Delay is judged for POs at cutting; age since "created" is shown but never counted as a delay.','کٹنگ تب آگے جاتی ہے جب کٹنگ اسکرین پر کٹ درج ہو؛ باقی مرحلے اپنی اپنی قطار میں مکمل ہوتے ہیں۔ زبردستی آگے بھیجنا اونر کا اختیار ہے اور پہلے پوچھتا ہے۔ تاخیر صرف کٹنگ والے پی اوز کی گنی جاتی ہے؛ "بنے ہوئے" کے دن دکھائے جاتے ہیں مگر تاخیر نہیں گنے جاتے۔',true);
  A('queue.no_pos_read','No POs read','کوئی پی او نہیں پڑھا گیا');
  A('queue.afloat','Afloat {n} pcs','افلوٹ {n} عدد');
  A('queue.afloat_tip','Units afloat: the issued pieces of released POs still at cutting','افلوٹ: وہ جاری شدہ پیس جن کے پی او ابھی کٹنگ پر ہیں',true);
  A('queue.in_production','In production {n} pcs','پروڈکشن میں {n} عدد');
  A('queue.in_production_tip','Released POs from cutting to final QC','کٹنگ سے فائنل کیو سی تک ریلیز پی او');
  A('queue.reserved_n','Reserved {n}','ریزرو {n}');
  A('queue.completed_n','Completed {n}','مکمل {n}');
  A('queue.cancelled_hidden','Cancelled {n} (hidden)','کینسل {n} (چھپے ہوئے)');
  A('queue.unrecognised_n','Unrecognised stage {n}','نامعلوم مرحلہ {n}');
  A('queue.without_qty','{n} without a quantity','{n} بغیر مقدار کے');
  A('queue.filter_label','Filter the board','بورڈ کو فلٹر کریں');
  A('queue.all_seasons','All seasons','تمام سیزن');
  A('queue.no_season','No season','سیزن نہیں');
  A('queue.all_masters','All masters','تمام ماسٹرز');
  A('queue.unassigned_plans_not_loaded','Unassigned (plans not loaded)','کسی کو نہیں دیا (پلان لوڈ نہیں)');
  A('queue.search_placeholder','Article code or name','آرٹیکل کوڈ یا نام');
  A('queue.search_label','Search article code or name','آرٹیکل کوڈ یا نام تلاش کریں');
  A('queue.delayed_only','Delayed only','صرف لیٹ');
  A('queue.lane_count','{n} POs','{n} پی او');
  A('queue.no_pos','No POs','کوئی پی او نہیں');
  A('queue.no_pos_msg','The POs were read and there are none (cancelled POs are not shown).','پی اوز پڑھے گئے اور کوئی نہیں ہے (کینسل پی او نہیں دکھائے جاتے)۔');
  A('queue.released_by_stage','Released POs by stage','مرحلے کے مطابق ریلیز پی او');
  A('queue.no_match','No POs match the filters.','فلٹر سے کوئی پی او نہیں ملا۔');
  A('queue.nothing_here','Nothing here.','یہاں کچھ نہیں۔');
  A('queue.show_more','Show {n} more','{n} اور دکھائیں');
  A('queue.afloat_mark','Issued pieces not yet cut: units afloat','جاری شدہ پیس جو ابھی کٹے نہیں: افلوٹ',true);
  A('queue.season_guessed','Guessed from the planned day, not stored on the PO','پلان کے دن سے اندازہ، پی او پر درج نہیں');
  A('queue.season_stored','Season stored on the PO','سیزن پی او پر درج ہے');
  A('queue.season_none','No season stored and no day to guess from','نہ سیزن درج ہے نہ اندازے کو دن');
  A('queue.no_article_code','(no article code)','(آرٹیکل کوڈ نہیں)');
  A('queue.qty_unknown','quantity unknown','مقدار معلوم نہیں');
  A('queue.pcs','{n} pcs','{n} عدد');
  A('queue.pcs_cut','{n} pcs (cut)','{n} عدد (کٹے ہوئے)');
  A('queue.plan_not_loaded','Plan: not loaded','پلان: لوڈ نہیں ہوا');
  A('queue.cut_on','Cut {day}','کٹنگ {day}');
  A('queue.no_cut_day','No cut day','کٹنگ کا دن نہیں');
  A('queue.no_master','no master','ماسٹر نہیں');
  A('queue.not_planned','Not planned','پلان نہیں ہوا');
  A('queue.age_created','Days since the PO was created: there is no recorded fabric-issue date','پی او بنے کو کتنے دن ہوئے: کپڑا جاری کرنے کی تاریخ درج نہیں');
  A('queue.age_released','Days since the PO was released','پی او ریلیز ہوئے کو کتنے دن');
  A('queue.age_issued','Days since the fabric was issued','کپڑا جاری ہوئے کو کتنے دن');
  A('queue.age_stage','Days since the previous stage finished','پچھلا مرحلہ ختم ہوئے کو کتنے دن');
  A('queue.age_since','{n}d since {basis}','{basis} سے {n} دن');
  A('queue.age_here','{n}d here','{n} دن سے یہاں');
  A('queue.delay_plan_passed','Plan passed {n}d ago','پلان کا دن {n} دن پہلے گزر گیا');
  A('queue.delay_capacity','Capacity: finishes {day}, +{n}d after plan','گنجائش کے حساب سے {day} کو ختم، پلان سے +{n} دن');
  A('queue.delay_stuck','Stuck {n}d','رکا ہوا {n} دن');
  A('queue.delay_slow','Slow {n}d','سست {n} دن');
  A('queue.open','Open {po}','{po} کھولیں');
  A('queue.change_plan','Change plan','پلان بدلیں');
  A('queue.plan_cut','Plan cut','کٹنگ پلان');
  A('queue.plan_cut_of','Plan the cut of {po}','{po} کی کٹنگ کا پلان');
  A('queue.force_advance','Force-advance → {stage}','زبردستی آگے → {stage}');
  A('queue.force_advance_tip','Owner override: marks {from} done and moves the PO to {stage}','اونر کا اختیار: {from} کو مکمل کر کے پی او کو {stage} میں بھیجتا ہے',true);
  A('queue.plan_title','Plan the cut · {po}','کٹنگ پلان · {po}');
  A('queue.plan_day','Planned cut day (leave empty for none)','کٹنگ کا دن (نہ ہو تو خالی چھوڑیں)');
  A('queue.master','Cutting master','کٹنگ ماسٹر');
  A('queue.no_master_opt','— No master —','— کوئی ماسٹر نہیں —');
  A('queue.master_current','{name} (current, not in the active list)','{name} (موجودہ، فعال فہرست میں نہیں)');
  A('queue.masters_unreadable','Cutting masters could not be read, so the master cannot be changed now.','کٹنگ ماسٹرز پڑھے نہیں گئے، اس لیے ابھی ماسٹر بدلا نہیں جا سکتا۔');
  A('queue.save_plan','Save plan','پلان محفوظ کریں');
  A('queue.nothing_changed','Nothing changed.','کچھ نہیں بدلا۔');
  A('queue.plan_saved','Plan saved for {po}','{po} کا پلان محفوظ ہو گیا');
  A('queue.plan_not_saved','Could not save the plan.','پلان محفوظ نہیں ہو سکا۔');
  A('queue.plans_reread','The plans were re-read: close this and open it again.','پلان دوبارہ پڑھے گئے: اسے بند کر کے دوبارہ کھولیں۔');
  A('queue.bad_day','The cut day must be a real day, YYYY-MM-DD.','کٹنگ کا دن اصلی تاریخ ہو، YYYY-MM-DD۔');
  A('queue.master_not_in_registry','That cutting master is not in the registry.','یہ کٹنگ ماسٹر رجسٹر میں نہیں ہے۔');
  A('queue.planning_managers','Planning is for the Production Ops managers (Afnan, Ammar, Mustafa).','پلان بنانا پروڈکشن آپس کے منیجرز (عفنان، عمار، مصطفیٰ) کا کام ہے۔',true);
  A('queue.writers_missing','The Production Ops writers did not load - refresh the page.','محفوظ کرنے والی فائل لوڈ نہیں ہوئی - پیج ریفریش کریں۔');
  A('queue.not_po_id','Not a PO id: {id}','یہ پی او نمبر نہیں: {id}');
  A('queue.force_owners_only','Only owners and Mustafa can force a PO forward.','پی او کو زبردستی آگے صرف اونرز اور مصطفیٰ بھیج سکتے ہیں۔');
  A('queue.move_running','Another move is still running.','دوسرا کام ابھی چل رہا ہے۔');
  A('queue.po_not_on_board','That PO is not on the board - refresh and try again.','یہ پی او بورڈ پر نہیں - ریفریش کر کے دوبارہ کوشش کریں۔');
  A('queue.could_not_advance','Could not advance: {why}','آگے نہیں بھیج سکے: {why}');

  /* ── PO Drafts ────────────────────────────────────────────────── */
  A('drafts.title','PO Drafts','پی او ڈرافٹ');
  A('drafts.blurb','PC-only entry. A draft is complete before it is marked ready; a ready draft is what gets issued as a PO in a later wave.','صرف پی سی پر لکھیں۔ ڈرافٹ پورا ہو تب "تیار" کریں؛ تیار ڈرافٹ بعد میں پی او بنایا جائے گا۔',true);
  A('drafts.pc_only_chip','PC-only entry','صرف پی سی پر انٹری');
  A('drafts.new','New draft','نیا ڈرافٹ');
  A('drafts.reading','Reading po_drafts…','ڈرافٹ پڑھے جا رہے ہیں…');
  A('drafts.could_not_read','PO drafts could not be read','پی او ڈرافٹ پڑھے نہیں جا سکے');
  A('drafts.not_shown_as_none','Nothing below is shown as "no drafts": the list was not read.','نیچے "کوئی ڈرافٹ نہیں" نہیں دکھایا جا رہا: فہرست پڑھی ہی نہیں گئی۔');
  A('drafts.filter_label','Filter drafts by status','حالت کے مطابق ڈرافٹ فلٹر کریں');
  A('drafts.cut_limit','The list was cut at its read limit ({n} drafts): older drafts are not shown.','فہرست پڑھنے کی حد ({n} ڈرافٹ) پر کٹ گئی: پرانے ڈرافٹ نہیں دکھائے گئے۔');
  A('drafts.none_yet','po_drafts was read and holds no drafts yet.','ڈرافٹ پڑھے گئے، ابھی کوئی ڈرافٹ نہیں۔');
  A('drafts.none_status','No draft is {status}.','کوئی ڈرافٹ {status} نہیں۔');
  A('drafts.status_draft','draft','ڈرافٹ');
  A('drafts.status_ready','ready','تیار');
  A('drafts.status_abandoned','abandoned','چھوڑا ہوا');
  A('drafts.status_all','All','سب');
  A('drafts.masters_unread_note','The cutting masters were not read, so completeness is shown as "not checked".','کٹنگ ماسٹرز نہیں پڑھے گئے، اس لیے مکمل ہونے کی جانچ "چیک نہیں ہوئی" دکھائی گئی ہے۔');
  A('drafts.no_article_yet','(no article chosen yet)','(ابھی آرٹیکل نہیں چنا)');
  A('drafts.qty_not_set','quantity not set','مقدار نہیں لکھی');
  A('drafts.revision','revision {n}','ریویژن {n}');
  A('drafts.updated','updated {when}','اپڈیٹ {when}');
  A('drafts.not_checked','not checked','چیک نہیں ہوا');
  A('drafts.missing_n','{n} missing','{n} کمی');
  A('drafts.open_draft','Open draft {id}','ڈرافٹ {id} کھولیں');
  A('drafts.not_in_list','Draft {id} is not in the list that was read. Retry the read.','ڈرافٹ {id} پڑھی گئی فہرست میں نہیں۔ دوبارہ پڑھیں۔');
  A('drafts.back','← Back to the list','← فہرست پر واپس');
  A('drafts.heading_existing','Draft {id}','ڈرافٹ {id}');
  A('drafts.heading_revision','Revision {n} · started by {who}','ریویژن {n} · شروع کرنے والا {who}');
  A('drafts.not_saved_yet','Not saved yet. Nothing is written until you press Save draft.','ابھی محفوظ نہیں۔ "ڈرافٹ محفوظ کریں" دبانے تک کچھ نہیں لکھا جاتا۔');
  A('drafts.sent_back','Sent back: {why}','واپس بھیجا گیا: {why}');
  A('drafts.locked_ready','This draft is READY: it is locked. A manager can send it back to draft to edit it.','یہ ڈرافٹ تیار ہے: لاک ہے۔ ایڈٹ کے لیے منیجر اسے واپس ڈرافٹ میں بھیج سکتا ہے۔');
  A('drafts.locked_abandoned','This draft was abandoned','یہ ڈرافٹ چھوڑ دیا گیا');
  A('drafts.locked_other','This draft is {status} and cannot be edited here.','یہ ڈرافٹ {status} ہے اور یہاں ایڈٹ نہیں ہو سکتا۔');
  A('drafts.masters_unreadable_title','The cutting masters could not be read','کٹنگ ماسٹرز پڑھے نہیں جا سکے');
  A('drafts.masters_unreadable_msg',' A draft cannot be marked ready until the masters are read, because the planned master cannot be checked.',' جب تک ماسٹرز نہ پڑھے جائیں ڈرافٹ "تیار" نہیں ہو سکتا، کیونکہ طے شدہ ماسٹر چیک نہیں ہو سکتا۔');
  A('drafts.catalog_search','Search the catalog by name or code, e.g. GH001 or Black Hoodie','نام یا کوڈ سے کیٹلاگ تلاش کریں، جیسے GH001 یا Black Hoodie');
  A('drafts.f_article_code','Article code *','آرٹیکل کوڈ *');
  A('drafts.f_article_name','Article name *','آرٹیکل کا نام *');
  A('drafts.f_pattern','Pattern number','پیٹرن نمبر');
  A('drafts.find_article','Find an article','آرٹیکل تلاش کریں');
  A('drafts.catalog_no_match','No article in the catalog matches "{q}". You can still type the code and name below.','کیٹلاگ میں "{q}" سے کوئی آرٹیکل نہیں ملا۔ آپ نیچے کوڈ اور نام خود لکھ سکتے ہیں۔');
  A('drafts.catalog_unavailable','The article catalog is not available here, so the code cannot be checked against it.','آرٹیکل کیٹلاگ یہاں دستیاب نہیں، اس لیے کوڈ چیک نہیں ہو سکتا۔');
  A('drafts.in_catalog','In the catalog: {name}','کیٹلاگ میں ہے: {name}');
  A('drafts.not_in_catalog','Not in the article catalog - check the code. (It is not blocked: a new article may not be listed yet.)','آرٹیکل کیٹلاگ میں نہیں - کوڈ چیک کریں۔ (روکا نہیں گیا: نیا آرٹیکل شاید ابھی درج نہ ہو۔)');
  A('drafts.f_total_qty','Total quantity (pcs) *','کل مقدار (عدد) *');
  A('drafts.use_sizes_total','Use the sizes total','سائز کا ٹوٹل استعمال کریں');
  A('drafts.f_size_axis','Size axis','سائز کی قسم');
  A('drafts.axis_auto','Automatic (from the article code)','خودکار (آرٹیکل کوڈ سے)');
  A('drafts.axis_alpha','Alpha (XXXS to 2XL)','الفا (XXXS سے 2XL)');
  A('drafts.axis_waist','Waist (26 to 40)','کمر (26 سے 40)');
  A('drafts.axis_free','Free size','فری سائز');
  A('drafts.sec_qty','Quantity and sizes','مقدار اور سائز');
  A('drafts.f_fabric_type','Fabric type *','کپڑے کی قسم *');
  A('drafts.ph_fabric_type','e.g. Terry, Fleece','جیسے ٹیری، فلیس');
  A('drafts.f_fabric_code','Fabric code','کپڑے کا کوڈ');
  A('drafts.ph_fabric_code','e.g. BLKTRY220','جیسے BLKTRY220');
  A('drafts.f_supply','Supply store','سپلائی اسٹور');
  A('drafts.ph_supply','Store/supplier','اسٹور/سپلائر');
  A('drafts.f_rolls','Total rolls','کل رول');
  A('drafts.f_fabric_qty','Planned fabric quantity *','کپڑے کی مقدار (پلان) *');
  A('drafts.f_fabric_unit','Planned fabric unit *','کپڑے کی اکائی *');
  A('drafts.unit_kg','kg','کلو');
  A('drafts.unit_m','m (meters)','میٹر');
  A('drafts.choose','- choose -','- منتخب کریں -');
  A('drafts.unit_hint','kg and m are never mixed.','کلو اور میٹر کبھی ملائے نہیں جاتے۔');
  A('drafts.sec_fabric','Fabric and supply','کپڑا اور سپلائی');
  A('drafts.std_unreadable','The consumption standards could not be read, so no fabric suggestion is shown.','کھپت کے معیار پڑھے نہیں گئے، اس لیے کپڑے کی تجویز نہیں دکھائی گئی۔');
  A('drafts.std_none','No consumption standard is saved for {code}.','{code} کے لیے کھپت کا معیار محفوظ نہیں۔');
  A('drafts.std_line','Standard for {code}: {per} per piece → about {total} for {n} pieces.','{code} کا معیار: {per} فی پیس → {n} پیس کے لیے تقریباً {total}۔');
  A('drafts.std_use','Use the standard ({total})','معیار استعمال کریں ({total})');
  A('drafts.f_season','Season *','سیزن *');
  A('drafts.season_hint','Stated, not guessed from a date.','خود چنیں، تاریخ سے اندازہ نہیں۔');
  A('drafts.f_cut_date','Planned cut date *','کٹنگ کی طے شدہ تاریخ *');
  A('drafts.f_req_date','Requested date *','مطلوبہ تاریخ *');
  A('drafts.req_hint','The date the PO asks for.','وہ تاریخ جو پی او مانگتا ہے۔');
  A('drafts.master_retired','{name} (retired or not in the registry)','{name} (ریٹائرڈ یا رجسٹر میں نہیں)');
  A('drafts.masters_not_loaded_opt','Masters not loaded','ماسٹرز لوڈ نہیں ہوئے');
  A('drafts.f_master','Planned cutting master *','طے شدہ کٹنگ ماسٹر *');
  A('drafts.no_active_master','The registry has no active master yet - a manager adds one in the Masters tab.','رجسٹر میں ابھی کوئی فعال ماسٹر نہیں - منیجر ماسٹرز ٹیب میں شامل کرے گا۔');
  A('drafts.master_registry_unread','The master registry was not read.','ماسٹر رجسٹر پڑھا نہیں گیا۔');
  A('drafts.emb_required','This PO needs embellishment (printing / embroidery)','اس پی او میں ایمبلشمنٹ (پرنٹنگ / ایمبرائیڈری) ہے');
  A('drafts.sec_emb','Embellishment and job copies','ایمبلشمنٹ اور جاب کاپیاں');
  A('drafts.job_copies','Job copies to print. They print separately from the PO. Leave all unticked for none.','پرنٹ کرنے والی جاب کاپیاں۔ یہ پی او سے الگ پرنٹ ہوتی ہیں۔ نہ چاہیے ہوں تو کچھ نہ چنیں۔');
  A('drafts.emb_later','The embellishment recipe lookup and the product photos are attached when the PO is issued (a later wave); a draft only records the choice.','ایمبلشمنٹ ریسیپی اور پروڈکٹ فوٹو پی او جاری ہونے پر لگیں گے (بعد میں)؛ ڈرافٹ صرف انتخاب لکھتا ہے۔',true);
  A('drafts.f_notes','Notes for this PO (optional)','اس پی او کے نوٹس (ضروری نہیں)');
  A('drafts.ph_notes','e.g. special instructions, buyer remarks','جیسے خاص ہدایات، بائر کے ریمارکس');
  A('drafts.save','Save draft','ڈرافٹ محفوظ کریں');
  A('drafts.mark_ready','Mark ready','تیار کریں');
  A('drafts.abandon','Abandon draft','ڈرافٹ چھوڑ دیں');
  A('drafts.discard','Discard draft','ڈرافٹ ختم کریں');
  A('drafts.abandon_managers','Only a manager (Afnan, Ammar, Mustafa) can abandon a ready draft.','تیار ڈرافٹ صرف منیجر (عفنان، عمار، مصطفیٰ) چھوڑ سکتا ہے۔');
  A('drafts.send_back','Send back to draft','واپس ڈرافٹ میں بھیجیں');
  A('drafts.send_back_unavailable','Not available from this screen.','اس اسکرین سے ممکن نہیں۔');
  A('drafts.send_back_managers','Only a manager (Afnan, Ammar, Mustafa) can send a ready draft back.','تیار ڈرافٹ واپس صرف منیجر (عفنان، عمار، مصطفیٰ) بھیج سکتا ہے۔');
  A('drafts.issue_later','Issue as PO (later wave)','پی او بنائیں (بعد میں)');
  A('drafts.issue_later_tip','Issuing creates the PO number and the PO in its own transaction and needs a rules change. It arrives in a later wave.','پی او جاری کرنے سے پی او نمبر اور پی او بنے گا؛ یہ بعد میں آئے گا۔',true);
  A('drafts.issue_later_note','Issuing a ready draft as a PO (the PO number and the pos document) is a later wave: it needs its own transaction and a rules change. Nothing here creates a PO.','تیار ڈرافٹ سے پی او بنانا بعد میں آئے گا۔ یہاں سے کوئی پی او نہیں بنتا۔');
  A('drafts.confirm_abandon','Abandon this draft? It stays in the list as abandoned and cannot be edited. A reason is required.','یہ ڈرافٹ چھوڑ دیں؟ یہ فہرست میں "چھوڑا ہوا" رہے گا اور ایڈٹ نہیں ہو گا۔ وجہ لکھنا ضروری ہے۔');
  A('drafts.confirm_send_back','Send this ready draft back to draft so it can be edited. A reason is required.','اس تیار ڈرافٹ کو واپس ڈرافٹ میں بھیجیں تاکہ ایڈٹ ہو سکے۔ وجہ لکھنا ضروری ہے۔');
  A('drafts.confirm_discard','Discard this new draft? Nothing was saved, so nothing is written.','یہ نیا ڈرافٹ ختم کریں؟ کچھ محفوظ نہیں ہوا تھا، اس لیے کچھ نہیں لکھا جائے گا۔');
  A('drafts.confirm_leave','Leave this draft? Your unsaved changes will be lost.','ڈرافٹ چھوڑ کر جائیں؟ محفوظ نہ کی گئی تبدیلیاں ضائع ہو جائیں گی۔');
  A('drafts.discard_leave','Discard changes and leave','تبدیلیاں ختم کر کے باہر جائیں');
  A('drafts.send_back_btn','Send back','واپس بھیجیں');
  A('drafts.discarded','Discarded. Nothing had been saved.','ختم کر دیا۔ کچھ محفوظ نہیں تھا۔');
  A('drafts.unsaved','unsaved changes','محفوظ نہ کی گئی تبدیلیاں');
  A('drafts.sizes_sum','Sizes add up to {n} pcs','سائز کا ٹوٹل {n} عدد');
  A('drafts.sizes_match',' - matches the quantity.',' - مقدار سے ملتا ہے۔');
  A('drafts.sizes_mismatch',' - the quantity says {n}.',' - مقدار {n} لکھی ہے۔');
  A('drafts.sizes_shown_axis','Sizes shown: {axis}','دکھائے گئے سائز: {axis}');
  A('drafts.axis_by_you','chosen by you','آپ کا چنا ہوا');
  A('drafts.axis_by_code','from the article code','آرٹیکل کوڈ سے');
  A('drafts.axis_default','the default axis','ڈیفالٹ');
  A('drafts.ratio','Ratio: {r}','تناسب: {r}');
  A('drafts.sizes_foreign_one','{n} size entry does not belong to this size axis and will not be saved.','{n} سائز اس قسم سے تعلق نہیں رکھتا اور محفوظ نہیں ہوگا۔');
  A('drafts.sizes_foreign_many','{n} size entries do not belong to this size axis and will not be saved.','{n} سائز اس قسم سے تعلق نہیں رکھتے اور محفوظ نہیں ہوں گے۔');
  A('drafts.not_complete','Not complete yet','ابھی مکمل نہیں');
  A('drafts.complete','Every required field is filled. This draft can be marked ready.','ضروری خانے سب بھرے ہیں۔ اب ڈرافٹ "تیار" ہو سکتا ہے۔');
  A('drafts.to_fix','{n} to fix before this can be marked ready:','"تیار" کرنے سے پہلے {n} ٹھیک کریں:');
  A('drafts.not_understood','Not understood','سمجھ نہیں آیا');
  A('drafts.worth_a_look','Worth a look (does not block):','ایک نظر دیکھ لیں (روکتا نہیں):');
  A('drafts.summary','Print-ready summary','خلاصہ (پرنٹ کے لیے تیار)');
  A('drafts.summary_incomplete','Summary (not print-ready: incomplete)','خلاصہ (پرنٹ کے لیے تیار نہیں: ادھورا)');
  A('drafts.s_sizes','Sizes ({total})','سائز ({total})');
  A('drafts.s_rolls','{n} rolls','{n} رول');
  A('drafts.s_fabric','Planned fabric','کپڑا (پلان)');
  A('drafts.s_not_required','Not required','ضروری نہیں');
  A('drafts.s_job_copies','Job copies','جاب کاپیاں');
  A('drafts.s_readonly','Read-only. Nothing is printed from here: the PO is printed after it is issued (a later wave).','صرف دیکھنے کے لیے۔ یہاں سے کچھ پرنٹ نہیں ہوتا: پی او جاری ہونے کے بعد پرنٹ ہوگا۔');
  A('drafts.f_cut_master_short','Cutting master','کٹنگ ماسٹر');
  A('drafts.reload_latest','Reload the latest copy','تازہ کاپی دوبارہ لوڈ کریں');
  A('drafts.edit_anyway','Edit anyway on this screen','پھر بھی اس اسکرین پر ایڈٹ کریں');
  A('drafts.pc_read_only_title','PO entry is PC-only - this screen is read-only','پی او انٹری صرف پی سی پر - یہ اسکرین صرف دیکھنے کی ہے');
  A('drafts.pc_not_pc','This does not look like a PC screen','یہ پی سی کی اسکرین نہیں لگتی');
  A('drafts.pc_hard','An owner has switched on the hard PC-only rule. This screen (width {w}) does not look like a PC, so you can read drafts here but nothing can be written. Open Production Ops on a PC.','اونر نے سخت "صرف پی سی" اصول لگایا ہے۔ یہ اسکرین (چوڑائی {w}) پی سی نہیں لگتی، اس لیے یہاں ڈرافٹ صرف پڑھ سکتے ہیں، لکھ نہیں سکتے۔ پروڈکشن آپس پی سی پر کھولیں۔',true);
  A('drafts.pc_hard_assumed','The PC-only setting could not be read, so the strict rule is assumed. This screen (width {w}) does not look like a PC: read-only. Open Production Ops on a PC, or retry the settings read.','"صرف پی سی" سیٹنگ پڑھی نہیں گئی، اس لیے سخت اصول مانا گیا۔ یہ اسکرین (چوڑائی {w}) پی سی نہیں لگتی: صرف دیکھ سکتے ہیں۔ پروڈکشن آپس پی سی پر کھولیں یا سیٹنگ دوبارہ پڑھیں۔',true);
  A('drafts.pc_warn','Warning: you are editing on a screen that does not look like a PC (width {w}). PO entry is meant for a PC. Everything you save is recorded as entered on a PC, so check it carefully.','خبردار: آپ ایسی اسکرین پر ایڈٹ کر رہے ہیں جو پی سی نہیں لگتی (چوڑائی {w})۔ پی او انٹری پی سی کے لیے ہے۔ جو محفوظ ہوگا وہ پی سی پر لکھا ہوا درج ہوگا، اس لیے غور سے چیک کریں۔',true);
  A('drafts.pc_soft','PO entry is meant for a PC (a screen at least 1024 px wide). This screen (width {w}) is read-only. If your window is just narrow, widen it - or edit anyway on this screen.','پی او انٹری پی سی کے لیے ہے (کم از کم 1024 پکسل چوڑی اسکرین)۔ یہ اسکرین (چوڑائی {w}) صرف دیکھنے کی ہے۔ ونڈو چھوٹی ہو تو بڑی کریں - یا پھر بھی اسی اسکرین پر ایڈٹ کریں۔',true);
  A('drafts.pc_guard_note','This check reads the browser\'s user agent and window width. It is a guard against mistakes, not a security boundary: it can be wrong and it can be faked, and the server cannot tell what device wrote a draft.','یہ جانچ براؤزر کی قسم اور ونڈو کی چوڑائی دیکھتی ہے۔ یہ غلطی سے بچاؤ ہے، سیکیورٹی نہیں: یہ غلط بھی ہو سکتی ہے اور جعلی بھی۔',true);
  A('drafts.no_access_msg','PO drafts are for the Production Ops team (Afnan, Ammar, Mustafa and Uzaib).','پی او ڈرافٹ پروڈکشن آپس ٹیم (عفنان، عمار، مصطفیٰ اور عزیب) کے لیے ہیں۔',true);
  A('drafts.code_missing_title','Production Ops code did not load','پروڈکشن آپس کا کوڈ لوڈ نہیں ہوا');
  A('drafts.code_missing_msg','js/ph-core.js, js/ph-data.js or js/ph-write.js is missing - refresh the page.','ضروری فائلیں لوڈ نہیں ہوئیں - پیج ریفریش کریں۔');
  A('drafts.not_drawn','PO drafts could not be drawn','پی او ڈرافٹ کھل نہیں سکے');
  A('drafts.err_not_whole','"{v}" is not a whole number of pieces','"{v}" پیس کی پوری گنتی نہیں');
  A('drafts.err_qty_not_whole','the quantity "{v}" is not a whole number of pieces','مقدار "{v}" پیس کی پوری گنتی نہیں');
  A('drafts.err_fabric_qty','the planned fabric quantity "{v}" is not a number','کپڑے کی مقدار "{v}" نمبر نہیں');
  A('drafts.err_not_date','"{v}" is not a date (YYYY-MM-DD)','"{v}" تاریخ نہیں (YYYY-MM-DD)');
  A('drafts.err_not_team','Your account is not on the Production Ops team, so it cannot write PO drafts.','آپ کا اکاؤنٹ پروڈکشن آپس ٹیم میں نہیں، اس لیے پی او ڈرافٹ نہیں لکھ سکتا۔');
  A('drafts.err_pc_hard','PO entry is PC-only and an owner has switched the hard rule on: nothing can be written from this screen.','پی او انٹری صرف پی سی پر ہے اور اونر نے سخت اصول لگایا ہے: اس اسکرین سے کچھ نہیں لکھا جا سکتا۔');
  A('drafts.err_pc_assumed','PO entry is PC-only. The PC-only setting could not be read, so the hard rule is assumed: nothing can be written from this screen.','پی او انٹری صرف پی سی پر ہے۔ سیٹنگ پڑھی نہیں گئی، اس لیے سخت اصول مانا گیا: اس اسکرین سے کچھ نہیں لکھا جا سکتا۔',true);
  A('drafts.err_pc_soft','PO entry is meant for a PC. This screen does not look like one, so the form is read-only.','پی او انٹری پی سی کے لیے ہے۔ یہ اسکرین پی سی نہیں لگتی، اس لیے فارم صرف دیکھنے کا ہے۔');
  A('drafts.err_unexpected','Unexpected error: {why}','غیر متوقع خرابی: {why}');
  A('drafts.err_cannot_change','This draft cannot be changed.','یہ ڈرافٹ بدلا نہیں جا سکتا۔');
  A('drafts.err_not_saved_fix','Not saved. Fix these first: {fields}','محفوظ نہیں ہوا۔ پہلے یہ ٹھیک کریں: {fields}');
  A('drafts.ok_created','Draft {id} created','ڈرافٹ {id} بن گیا');
  A('drafts.ok_saved','Draft saved (revision {n})','ڈرافٹ محفوظ (ریویژن {n})');
  A('drafts.ok_dropped_sizes','{n} size entries outside this size axis were not saved.','{n} سائز اس قسم سے باہر تھے اور محفوظ نہیں ہوئے۔');
  A('drafts.err_save','The draft could not be saved.','ڈرافٹ محفوظ نہیں ہو سکا۔');
  A('drafts.err_not_ready_fix','Not marked ready. Fix these first: {fields}','"تیار" نہیں ہوا۔ پہلے یہ ٹھیک کریں: {fields}');
  A('drafts.err_not_ready_missing','Not marked ready - the draft is incomplete. Missing: {fields}','"تیار" نہیں ہوا - ڈرافٹ ادھورا ہے۔ کمی: {fields}');
  A('drafts.ok_ready','Draft {id} is marked ready (revision {n}). It is locked; a manager can send it back.','ڈرافٹ {id} تیار ہو گیا (ریویژن {n})۔ یہ لاک ہے؛ منیجر واپس بھیج سکتا ہے۔');
  A('drafts.err_ready','The draft could not be marked ready.','ڈرافٹ "تیار" نہیں ہو سکا۔');
  A('drafts.err_abandon_unsaved','This draft was never saved, so there is nothing to abandon.','یہ ڈرافٹ کبھی محفوظ نہیں ہوا، اس لیے چھوڑنے کو کچھ نہیں۔');
  A('drafts.err_abandon_reason','A reason is needed to abandon a draft.','ڈرافٹ چھوڑنے کی وجہ لکھنا ضروری ہے۔');
  A('drafts.ok_abandoned','Draft {id} abandoned.','ڈرافٹ {id} چھوڑ دیا گیا۔');
  A('drafts.err_abandon','The draft could not be abandoned.','ڈرافٹ چھوڑا نہیں جا سکا۔');
  A('drafts.err_send_back_only_ready','Only a ready draft can be sent back.','صرف تیار ڈرافٹ واپس بھیجا جا سکتا ہے۔');
  A('drafts.err_send_back_reason','A reason is needed to send a draft back.','ڈرافٹ واپس بھیجنے کی وجہ لکھنا ضروری ہے۔');
  A('drafts.ok_sent_back','Draft {id} sent back to draft (revision {n}).','ڈرافٹ {id} واپس ڈرافٹ میں بھیج دیا (ریویژن {n})۔');
  A('drafts.err_send_back','The draft could not be sent back.','ڈرافٹ واپس نہیں بھیجا جا سکا۔');
  A('drafts.reason_placeholder','Reason','وجہ');

  /* ── Today's Cutting ──────────────────────────────────────────── */
  A('cut.title',"Today's Cutting",'آج کی کٹنگ');
  A('cut.blurb_floor','Roll check and Mark complete only','صرف رول چیک اور "مکمل" کرنا');
  A('cut.planned_for','Planned for {day}','{day} کے لیے پلان');
  A('cut.date_unreadable','The date could not be read.','تاریخ پڑھی نہیں جا سکی۔');
  A('cut.jobs_failed','The cutting jobs could not be read','کٹنگ جابز پڑھی نہیں جا سکیں');
  A('cut.jobs_not_loaded','po_cut_jobs: not loaded yet.','po_cut_jobs: ابھی لوڈ نہیں ہوا۔');
  A('cut.no_list_until_ok','Nothing is shown as zero: until the read works there is no list.','زیرو نہیں دکھایا جاتا: جب تک ڈیٹا نہ پڑھا جائے فہرست نہیں ہے۔');
  A('cut.summary_today','{n} planned today','آج {n} پلان');
  A('cut.summary_overdue','{n} overdue','{n} لیٹ');
  A('cut.summary_open_one','{n} open job','{n} کھلی جاب');
  A('cut.summary_open_many','{n} open jobs','{n} کھلی جابز');
  A('cut.summary_no_day','{n} with no planned day','{n} کا دن طے نہیں');
  A('cut.list_cut_limit','The list of cut jobs is cut at its limit, so some older jobs may be missing.','کٹ جابز کی فہرست حد پر کٹ گئی، اس لیے کچھ پرانی جابز غائب ہو سکتی ہیں۔');
  A('cut.todays_jobs',"Today's jobs",'آج کی جابز');
  A('cut.none_today','No cut jobs are planned for today.','آج کے لیے کوئی کٹ جاب پلان نہیں۔');
  A('cut.overdue_open','Overdue - still open','لیٹ - ابھی کھلی');
  A('cut.none_overdue','Nothing overdue.','کچھ لیٹ نہیں۔');
  A('cut.show_all_overdue','Show all {n} overdue','سب {n} لیٹ دکھائیں');
  A('cut.show_all','show all','سب دکھائیں');
  A('cut.job_card','Cut job {po}','کٹ جاب {po}');
  A('cut.open_overdue','Open overdue job {po}','لیٹ جاب {po} کھولیں');
  A('cut.day_late','{n} day late','{n} دن لیٹ');
  A('cut.days_late','{n} days late','{n} دن لیٹ');
  A('cut.chip_complete','✓ Complete','✓ مکمل');
  A('cut.chip_recorded','✓ Cut recorded','✓ کٹ درج ہو گئی');
  A('cut.chip_override','Override approved','استثنا منظور');
  A('cut.f_planned_fabric','Planned fabric','کپڑا (پلان)');
  A('cut.not_recorded_on_job','not recorded on the job','جاب پر درج نہیں');
  A('cut.reading_issue','Reading the fabric issue…','کپڑے کا اجرا پڑھا جا رہا ہے…');
  A('cut.no_issue_yet','No fabric issue was found for this PO yet.','اس پی او کے لیے ابھی کپڑے کا اجرا نہیں ملا۔');
  A('cut.weight_not_recorded',' · weight not recorded',' · وزن درج نہیں');
  A('cut.issued_to_po','Issued to the PO','پی او کو جاری');
  A('cut.in_all',' in all',' کل');
  A('cut.units_differ',' · units differ (kg and m)',' · اکائیاں مختلف ہیں (کلو اور میٹر)');
  A('cut.reading_po','Reading the PO…','پی او پڑھا جا رہا ہے…');
  A('cut.try_again','Try again','دوبارہ کوشش');
  A('cut.article_not_named','Article not named','آرٹیکل کا نام نہیں');
  A('cut.qty_not_recorded','quantity not recorded','مقدار درج نہیں');
  A('cut.no_master_assigned','No master assigned','ماسٹر مقرر نہیں');
  A('cut.planned_cut','Planned cut','طے شدہ کٹنگ');
  A('cut.no_day_set','no day set','دن طے نہیں');
  A('cut.rib','Rib {v}','ریب {v}');
  A('cut.gsm','{v} gsm','{v} جی ایس ایم');
  A('cut.no_rolls','no rolls','کوئی رول نہیں');
  A('cut.roll_check','Roll check','رول چیک');
  A('cut.no_check_saved','No roll check saved yet.','ابھی کوئی رول چیک محفوظ نہیں۔');
  A('cut.saved_check','Saved roll check: {n} verified','محفوظ رول چیک: {n} تصدیق شدہ');
  A('cut.saved_mismatch','✗ MISMATCH flagged','✗ فرق کی نشاندہی');
  A('cut.saved_match','✓ Matches the issue','✓ اجرا سے مطابقت ہے');
  A('cut.roll_missing_one','roll missing','رول غائب');
  A('cut.roll_missing_many','rolls missing','رول غائب');
  A('cut.roll_extra_one','extra roll','فالتو رول');
  A('cut.roll_extra_many','extra rolls','فالتو رول');
  A('cut.weight_outside','weight outside the limit','وزن حد سے باہر');
  A('cut.no_issue_no_rolls','No fabric issue was found for this PO, so there are no rolls to check.','اس پی او کا اجرا نہیں ملا، اس لیے چیک کرنے کو رول نہیں۔');
  A('cut.no_permission_check','This account cannot record a roll check.','یہ اکاؤنٹ رول چیک درج نہیں کر سکتا۔');
  A('cut.job_closed','This job is {status} - the roll check is closed.','یہ جاب {status} ہے - رول چیک بند ہے۔');
  A('cut.how_check','How to check the rolls','رول کیسے چیک کریں');
  A('cut.mode_scan','Scan rolls','رول اسکین کریں');
  A('cut.mode_count','Count only','صرف گنتی');
  A('cut.scan_placeholder','Scan or type a roll code','رول کوڈ اسکین کریں یا لکھیں');
  A('cut.scan_label','Roll code, then Enter','رول کوڈ لکھ کر Enter دبائیں');
  A('cut.weighed_total','Weighed total of the rolls ({unit}) - optional','رولز کا تولا ہوا کل وزن ({unit}) - ضروری نہیں');
  A('cut.rolls_counted','Rolls counted','گنے ہوئے رول');
  A('cut.weight_counted','Weight counted ({unit}) - optional','تولا ہوا وزن ({unit}) - ضروری نہیں');
  A('cut.present_tap_undo','{code} present, tap to undo','{code} موجود، واپس کرنے کو دبائیں');
  A('cut.not_seen_tap','{code} not seen, tap to mark present','{code} نظر نہیں آیا، موجود لگانے کو دبائیں');
  A('cut.present','✓ Present','✓ موجود');
  A('cut.not_seen','Not seen yet','ابھی نظر نہیں آیا');
  A('cut.not_on_issue','✗ Not on this issue','✗ اس اجرا میں نہیں');
  A('cut.remove','Remove {code}','{code} ہٹائیں');
  A('cut.rolls_verified','{n} rolls verified','{n} رول تصدیق شدہ');
  A('cut.mismatch_line','✗ MISMATCH: {what}','✗ فرق: {what}');
  A('cut.missing_line','Missing: {what}','غائب: {what}');
  A('cut.match_line','✓ Matches the issue.','✓ اجرا سے مطابقت ہے۔');
  A('cut.nothing_checked','Nothing checked yet.','ابھی کچھ چیک نہیں ہوا۔');
  A('cut.weight_not_compared','Weight not compared: {why}','وزن کا موازنہ نہیں ہوا: {why}');
  A('cut.weight_within','Weight {a} is within {tol} of the issued {b}','وزن {a} جاری شدہ {b} کے {tol} کے اندر ہے');
  A('cut.not_saved_yet','Not saved yet.','ابھی محفوظ نہیں۔');
  A('cut.save_check','Save roll check','رول چیک محفوظ کریں');
  A('cut.also_saves_flagged','This also saves the roll check, flagged as a mismatch.','یہ رول چیک بھی محفوظ کرے گا، فرق کے نشان کے ساتھ۔');
  A('cut.also_saves','This also saves the roll check.','یہ رول چیک بھی محفوظ کرے گا۔');
  A('cut.confirm_complete','Mark this job complete?','یہ جاب مکمل کریں؟');
  A('cut.yes_complete','Yes, mark complete','ہاں، مکمل کریں');
  A('cut.mark_complete','Mark complete','مکمل کریں');
  A('cut.reload_latest','Reload the latest','تازہ ترین دوبارہ لوڈ کریں');
  A('cut.check_qty_show','Check a cut quantity (preview)','کٹ مقدار چیک کریں (نمونہ)');
  A('cut.check_qty_hide','Hide cut-quantity check','کٹ مقدار کی جانچ چھپائیں');
  A('cut.check_qty_note','A preview of the cutting-done rule. Nothing is saved and nothing is recorded.','کٹنگ مکمل کرنے کے اصول کا نمونہ۔ کچھ محفوظ یا درج نہیں ہوتا۔');
  A('cut.cut_so_far','Cut so far: {n} pcs of {ord} ordered','اب تک کٹے: {n} عدد، آرڈر {ord}');
  A('cut.whole_only','Whole numbers only: {v}','صرف پورے نمبر: {v}');
  A('cut.gate_approved','✓ An owner or Mustafa already approved a variance for this PO (any quantity).','✓ اونر یا مصطفیٰ اس پی او کا فرق پہلے منظور کر چکے ہیں (کوئی بھی مقدار)۔');
  A('cut.gate_inside','✓ Inside the gate: {n} pcs ({lo} to {hi} pcs allowed).','✓ حد کے اندر: {n} عدد ({lo} سے {hi} عدد کی اجازت)۔');
  A('cut.gate_outside','✗ Outside the gate ({n} pcs, {pct}%). Recording this needs an owner or Mustafa to approve the variance first.','✗ حد سے باہر ({n} عدد، {pct}%)۔ درج کرنے سے پہلے اونر یا مصطفیٰ کو فرق منظور کرنا ہوگا۔');
  A('cut.gate_no_order','The ordered quantity is not recorded, so the gate cannot be shown.','آرڈر کی مقدار درج نہیں، اس لیے حد نہیں دکھائی جا سکتی۔');
  A('cut.gate_enter','Enter the pieces cut to see the gate','حد دیکھنے کے لیے کٹے ہوئے پیس لکھیں');
  A('cut.total_cut','Total cut','کل کٹے');
  A('cut.size_ordered','Size {s} (ordered {n})','سائز {s} (آرڈر {n})');
  A('cut.job_gone','{po}: this cut job is no longer in the list - refresh.','{po}: یہ کٹ جاب فہرست میں نہیں رہی - ریفریش کریں۔');
  A('cut.record_cut','Record the cut','کٹ درج کریں');
  A('cut.record_cut_tip','Opens the existing cutting screen (bundles, cut by size and the gate).','موجودہ کٹنگ اسکرین کھولتا ہے (بنڈل، سائز کے مطابق کٹ اور حد)۔');
  A('cut.record_already','The cut is already recorded (the PO is at {stage}).','کٹ پہلے درج ہو چکی ہے (پی او {stage} پر ہے)۔');
  A('cut.record_managers','Recording the cut is for the managers.','کٹ درج کرنا منیجرز کا کام ہے۔');
  A('cut.po_not_loaded_open','Open {po} from PO Registry to record the cut - the PO list is not loaded here.','کٹ درج کرنے کے لیے {po} کو پی او رجسٹری سے کھولیں - یہاں پی او فہرست لوڈ نہیں۔');
  A('cut.could_not_open','Could not open the cutting screen ({why})','کٹنگ اسکرین نہیں کھل سکی ({why})');
  A('cut.err_issue_not_loaded','The fabric issue is not loaded, so a roll cannot be checked yet.','کپڑے کا اجرا لوڈ نہیں، اس لیے رول ابھی چیک نہیں ہو سکتا۔');
  A('cut.roll_already','{code} was already scanned - counted once.','{code} پہلے اسکین ہو چکا - ایک بار گنا گیا۔');
  A('cut.roll_on_issue','{code} is on the issue - present.','{code} اجرا میں ہے - موجود۔');
  A('cut.roll_already_extra','{code} is already noted as not on this issue.','{code} پہلے ہی "اس اجرا میں نہیں" لکھا ہے۔');
  A('cut.roll_extra_noted','{code} is NOT on this PO\'s fabric issue - noted as extra.','{code} اس پی او کے اجرا میں نہیں ہے - فالتو لکھ لیا۔');
  A('cut.save_running','A save is already running.','محفوظ کرنا پہلے سے چل رہا ہے۔');
  A('cut.job_not_loaded','The cut job is not loaded.','کٹ جاب لوڈ نہیں۔');
  A('cut.writer_missing','js/ph-write.js did not load.','محفوظ کرنے والی فائل لوڈ نہیں ہوئی۔');
  A('cut.could_not_save_why','Could not save ({why})','محفوظ نہیں ہوا ({why})');
  A('cut.could_not_save','Could not save.','محفوظ نہیں ہو سکا۔');
  A('cut.err_only_open_check','Only an open cut job can take a roll check.','صرف کھلی جاب پر رول چیک ہو سکتا ہے۔');
  A('cut.err_check_not_ready','The roll check is not ready: {why}','رول چیک تیار نہیں: {why}');
  A('cut.err_scan_first','Scan or tick at least one roll first (or use Count only).','پہلے کم از کم ایک رول اسکین یا ٹک کریں (یا "صرف گنتی" استعمال کریں)۔');
  A('cut.saved_flagged','Saved - FLAGGED: {what}','محفوظ - نشان لگا: {what}');
  A('cut.saved_ok','Saved - all rolls match the issue.','محفوظ - سب رول اجرا سے ملتے ہیں۔');
  A('cut.err_no_complete','This account cannot mark a cut job complete.','یہ اکاؤنٹ کٹ جاب مکمل نہیں کر سکتا۔');
  A('cut.err_only_open_complete','Only an open cut job can be marked complete.','صرف کھلی جاب مکمل ہو سکتی ہے۔');
  A('cut.marked_complete','Marked complete','مکمل ہو گئی');
  A('cut.marked_complete_why','Marked complete - {what}','مکمل ہو گئی - {what}');
  A('cut.err_fix_check','Fix the roll check first: {why}','پہلے رول چیک ٹھیک کریں: {why}');
  A('cut.marked_flagged','Marked complete - roll check saved FLAGGED: {what}','مکمل ہو گئی - رول چیک نشان کے ساتھ محفوظ: {what}');
  A('cut.marked_matched','Marked complete - roll check saved, all rolls match.','مکمل ہو گئی - رول چیک محفوظ، سب رول ملتے ہیں۔');
  A('cut.marked_plain','Marked complete.','مکمل ہو گئی۔');
  A('cut.err_enter_count','enter how many rolls were counted (a whole number, zero or more)','لکھیں کتنے رول گنے (پورا نمبر، صفر یا زیادہ)');
  A('cut.err_weight_number','the weight must be a number above zero, or left empty','وزن صفر سے زیادہ نمبر ہو، یا خالی چھوڑیں');
  A('cut.err_units_mixed','the issue mixes kg and m, so a weight cannot be compared','اجرا میں کلو اور میٹر ملے ہیں، اس لیے وزن کا موازنہ نہیں ہو سکتا');
  A('cut.err_issued_weight','the issued weight is not recorded','جاری شدہ وزن درج نہیں');
  A('cut.err_no_rolls','no rolls are recorded as issued for this PO','اس پی او کے لیے کوئی رول جاری درج نہیں');
  A('cut.read_refused','{col}: could not be read - you may not have access to it, or the rules need republishing.','{col}: پڑھا نہیں جا سکا - شاید آپ کو اجازت نہیں، یا rules دوبارہ لگانے ہیں۔',true);
  A('cut.not_found_in_pos','{po} was not found in the PO list.','{po} پی او فہرست میں نہیں ملا۔');
  A('cut.offline_answer','answered from the offline copy','پرانی کاپی سے جواب ملا');

  /* ── Overview tiles (monitor, overview part) ──────────────────── */
  A('ov.title','Overview','خلاصہ');
  A('ov.blurb','Where production stands right now. Every number opens the list of POs behind it.','پروڈکشن ابھی کہاں کھڑی ہے۔ ہر نمبر دبانے سے اس کے پیچھے والے پی اوز کی فہرست کھلتی ہے۔');
  A('ov.po_read_at','Purchase orders read at {time} (PKT)','پی اوز {time} (پاکستانی وقت) پر پڑھے گئے');
  A('ov.refreshing_suffix',' · refreshing…',' · تازہ ہو رہا ہے…');
  A('ov.purchase_orders','Purchase orders','پی اوز');
  A('ov.pos_failed','Could not read the purchase orders','پی اوز پڑھ نہیں سکے');
  A('ov.pos_failed_note','Every figure that needs the POs reads "unavailable — pos" below; none is shown as zero.','جس نمبر کو پی اوز چاہییں وہاں نیچے "دستیاب نہیں — pos" لکھا ہے؛ کوئی نمبر زیرو نہیں دکھایا گیا۔');
  A('ov.t_pipeline','POs in pipeline','پائپ لائن میں پی او');
  A('ov.t_pipeline_cap','Released POs from cutting to final QC. Completed, reserved and cancelled POs are not in this number.','کٹنگ سے فائنل کیو سی تک ریلیز پی او۔ مکمل، ریزرو اور کینسل پی او اس نمبر میں نہیں۔');
  A('ov.t_afloat','Units afloat','افلوٹ یونٹس');
  A('ov.t_afloat_sub','{po} at cutting','{po} کٹنگ پر');
  A('ov.t_afloat_cap','Afloat = the pieces ISSUED (ordered quantity) of released POs still at cutting, i.e. not yet cut done.','افلوٹ = ریلیز پی اوز کے جاری شدہ (آرڈر) پیس جو ابھی کٹنگ پر ہیں، یعنی کٹنگ مکمل نہیں ہوئی۔',true);
  A('ov.t_inprod','Units in production','پروڈکشن میں یونٹس');
  A('ov.t_inprod_sub','{po}, cutting to final QC','{po}، کٹنگ سے فائنل کیو سی');
  A('ov.t_inprod_cap','In production = cutting to final QC. It counts the ACTUAL cut quantity once a PO is past cutting, so it differs from units afloat.','پروڈکشن میں = کٹنگ سے فائنل کیو سی۔ کٹنگ کے بعد اصل کٹی ہوئی مقدار گنی جاتی ہے، اس لیے یہ افلوٹ سے مختلف ہے۔',true);
  A('ov.t_reserved','Reserved POs','ریزرو پی او');
  A('ov.t_reserved_sub','not released to production','پروڈکشن کو ریلیز نہیں');
  A('ov.t_reserved_cap','Reserved POs are kept apart: they are in no other figure on this page.','ریزرو پی او الگ رکھے گئے ہیں: اس پیج کے کسی اور نمبر میں شامل نہیں۔');
  A('ov.t_stuck','Stuck POs','رکے ہوئے پی او');
  A('ov.t_stuck_sub','at one stage for {n} days or more','ایک مرحلے پر {n} دن یا زیادہ');
  A('ov.t_attention','Needs attention','توجہ چاہیے');
  A('ov.attention_summary','{stuck} stuck · {delayed} delayed · {gate} over the cut gate','{stuck} رکے · {delayed} لیٹ · {gate} کٹ کی حد سے باہر');
  A('ov.attention_none','Nothing is stuck, delayed or over the cut gate.','کچھ رکا، لیٹ یا کٹ کی حد سے باہر نہیں۔');
  A('ov.attention_none_judged','Nothing is stuck, delayed or over the cut gate among the POs that can be judged.','جن پی اوز کو جانچا جا سکتا ہے ان میں کچھ رکا، لیٹ یا کٹ کی حد سے باہر نہیں۔');
  A('ov.attention_no_start','{n} open PO with no start date cannot be judged (see Stuck POs).','{n} کھلا پی او بغیر شروع کی تاریخ کے جانچا نہیں جا سکتا (رکے ہوئے پی او دیکھیں)۔');
  A('ov.show_all','Show all {n}','سب {n} دکھائیں');
  A('ov.jobs_unread_delays','Delays against a planned cut day are not checked: po_cut_jobs could not be read.','طے شدہ کٹنگ کے دن کے مقابلے میں تاخیر چیک نہیں ہوئی: po_cut_jobs پڑھا نہیں جا سکا۔');
  A('ov.attn_cap','Delayed (past the {n}-day target or its planned cut day), stuck, and cuts outside the gate with no owner override on record. A PO can be on the list for more than one reason.','لیٹ ({n} دن کے ہدف یا طے شدہ کٹنگ کے دن سے آگے)، رکے ہوئے، اور وہ کٹ جو حد سے باہر ہیں اور اونر کی منظوری درج نہیں۔ ایک پی او ایک سے زیادہ وجہ سے فہرست میں آ سکتا ہے۔',true);
  A('ov.reason_stuck','▲ Stuck','▲ رکا ہوا');
  A('ov.reason_delayed','◆ Delayed','◆ لیٹ');
  A('ov.reason_gate','■ Over the cut gate','■ کٹ کی حد سے باہر');
  A('ov.no_qty','no quantity','مقدار نہیں');
  A('ov.no_qty_on_po','no quantity on the PO','پی او پر مقدار نہیں');
  A('ov.pcs_ordered','{n} pcs ordered','{n} عدد آرڈر');
  A('ov.pcs_reserved','{n} pcs reserved','{n} عدد ریزرو');
  A('ov.pcs_actual_or_ordered','{n} pcs ({basis})','{n} عدد ({basis})');
  A('ov.basis_cut','actual cut','اصل کٹے');
  A('ov.basis_ordered','ordered','آرڈر');
  A('ov.at_stage','at {stage}','{stage} پر');
  A('ov.stage_unknown','Unknown stage','نامعلوم مرحلہ');
  A('ov.unrecognised_link','{po} in a stage this app does not recognise','{po} ایسے مرحلے پر جو ایپ نہیں پہچانتی');
  A('ov.sum_differs','The pieces in the list ({n}) differ from the number — please report this.','فہرست کے پیس ({n}) نمبر سے مختلف ہیں — براہ کرم بتائیں۔');
  A('ov.unavailable_needs','This figure needs {a} and {b}, which could not be read.','اس نمبر کو {a} اور {b} چاہییں، جو پڑھے نہیں جا سکے۔');
  A('ov.close_list','Close the list','فہرست بند کریں');
  A('ov.pos_behind','{title} — the POs behind this number','{title} — اس نمبر کے پیچھے پی او');
  A('ov.sum_of_list','Sum of the list: {n}','فہرست کا ٹوٹل: {n}');
  A('ov.no_pos_behind','No POs behind this number.','اس نمبر کے پیچھے کوئی پی او نہیں۔');
  A('ov.pos_behind_short','{n} behind this number.','اس نمبر کے پیچھے {n}۔');
  A('ov.show_the','Show the {title}','{title} دکھائیں');
  A('ov.open_monitor','Open the Monitor','مانیٹر کھولیں');
  A('ov.quality','Data quality: {bits}.','ڈیٹا کی کوالٹی: {bits}۔');
  A('ov.q_cancelled','{po} left out of every figure','{po} کسی نمبر میں شامل نہیں');
  A('ov.q_unknown','{po} in an unrecognised stage (see POs in pipeline)','{po} نامعلوم مرحلے پر (پائپ لائن میں پی او دیکھیں)');
  A('ov.q_junk','{n} unreadable record ignored','{n} نہ پڑھا جانے والا ریکارڈ چھوڑ دیا گیا');
  A('ov.q_trunc','the PO list was cut at {n} — figures may be incomplete','پی او فہرست {n} پر کٹ گئی — نمبر ادھورے ہو سکتے ہیں');
  A('ov.q_jobs_trunc','the cutting-job list was cut at its limit — some planned cut days may be missing','کٹنگ جاب فہرست حد پر کٹ گئی — کچھ طے شدہ دن غائب ہو سکتے ہیں');
  A('ov.po_one','{n} PO','{n} پی او');
  A('ov.po_many','{n} POs','{n} پی او');
  A('ov.right_now','Right now','ابھی');
  A('ov.in_range','In the selected range','منتخب مدت میں');
  A('ov.scope_in_range','In range','مدت میں');
})();

/* ── helpers ──────────────────────────────────────────────────────── */
function _phI18nLangOk(l){return l==='ur-first'||l==='en';}
function _phI18nStore(){
  try{return typeof localStorage!=='undefined'?localStorage:null;}catch(e){return null;}
}
function _phI18nStr(v){return v===undefined||v===null?'':String(v);}
// Fill {token}s. Unknown tokens are left as written; a hostile value is just text (callers use textContent).
function _phI18nFill(s,params){
  if(typeof s!=='string')return '';
  if(!params||typeof params!=='object')return s;
  return s.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g,function(m,k){
    return Object.prototype.hasOwnProperty.call(params,k)?_phI18nStr(params[k]):m;
  });
}
// lang: 'ur' | 'en' (or 'ur-first' meaning ur). Falls back en, then the key. Never throws.
function phI18nT(key,params,lang){
  try{
    const e=Object.prototype.hasOwnProperty.call(PH_I18N_STR,key)?PH_I18N_STR[key]:null;
    if(!e)return _phI18nStr(key);
    const want=(lang==='ur'||lang==='ur-first')?'ur':'en';
    const raw=(want==='ur'&&e.ur)?e.ur:(e.en||_phI18nStr(key));
    return _phI18nFill(raw,params);
  }catch(x){return _phI18nStr(key);}
}
function phI18nPair(key,params){return{ur:phI18nT(key,params,'ur'),en:phI18nT(key,params,'en')};}

function _phI18nDefaultFor(username){
  return PH_I18N_URDU_FIRST_USERS.indexOf(String(username||''))>-1?'ur-first':'en';
}
function _phI18nCurrentUser(){
  try{return(typeof session!=='undefined'&&session&&typeof session.u==='string')?session.u:'';}catch(e){return '';}
}
// The stored per-device preference when valid, else this session's choice, else the default for this person.
function phI18nGetLang(username){return phI18nLangFor(username);}
const _phI18nListeners=[];
function phI18nOnChange(fn){
  if(typeof fn!=='function')return function(){};
  _phI18nListeners.push(fn);
  return function(){const i=_phI18nListeners.indexOf(fn);if(i>-1)_phI18nListeners.splice(i,1);};
}
// Stores the choice (best effort: blocked storage still changes the in-memory choice) and tells listeners once.
let _phI18nMem=null;
function phI18nSetLang(lang){
  if(!_phI18nLangOk(lang))return false;
  _phI18nMem=lang;
  try{const st=_phI18nStore();if(st)st.setItem(PH_I18N_LANG_KEY,lang);}catch(e){}
  _phI18nListeners.slice().forEach(function(fn){try{fn(lang);}catch(e){}});
  return true;
}
// Used by the screens: the stored choice, else this session's choice when storage is blocked, else the default.
function phI18nLangFor(username){
  const u=username===undefined?_phI18nCurrentUser():username;
  try{
    const st=_phI18nStore();
    const v=st?st.getItem(PH_I18N_LANG_KEY):null;
    if(_phI18nLangOk(v))return v;
  }catch(e){}
  if(_phI18nLangOk(_phI18nMem))return _phI18nMem;
  return _phI18nDefaultFor(u);
}

function _phI18nSpan(doc,cls,lang,dir,text){
  const s=doc.createElement('span');
  s.className=cls;s.setAttribute('lang',lang);s.setAttribute('dir',dir);
  s.textContent=text;
  return s;
}
// opts: {lang:'ur-first'|'en', tag:'span'|'div'|'p'...}. Urdu-first = Urdu block above a small English line.
function phI18nNode(doc,key,params,opts){
  const o=opts||{};
  const lang=_phI18nLangOk(o.lang)?o.lang:phI18nLangFor(o.username);
  const pair=phI18nPair(key,params);
  if(lang!=='ur-first'){
    return _phI18nSpan(doc,'phi-en-only','en','ltr',pair.en);
  }
  const wrap=doc.createElement(o.tag||'span');
  wrap.className='phi-pair';
  wrap.appendChild(_phI18nSpan(doc,'phi-ur','ur','rtl',pair.ur));
  wrap.appendChild(_phI18nSpan(doc,'phi-en','en','ltr',pair.en));
  return wrap;
}

// Two-button switch: اردو | English. Calls phI18nSetLang; the screens repaint through phI18nOnChange.
function phI18nToggleNode(doc,username){
  const cur=phI18nLangFor(username);
  const g=doc.createElement('div');
  g.className='phi-switch';
  g.setAttribute('role','group');
  g.setAttribute('aria-label','Language / زبان');
  [['ur-first','اردو','ur','rtl'],['en','English','en','ltr']].forEach(function(d){
    const b=doc.createElement('button');
    b.setAttribute('type','button');
    b.className='phi-switch-btn'+(cur===d[0]?' on':'');
    b.setAttribute('aria-pressed',cur===d[0]?'true':'false');
    b.setAttribute('lang',d[2]);b.setAttribute('dir',d[3]);
    b.setAttribute('data-lang',d[0]);
    b.textContent=d[1];
    b.addEventListener('click',function(){
      phI18nSetLang(d[0]);
      const kids=g.children;
      for(let i=0;i<kids.length;i++){
        const on=kids[i].getAttribute('data-lang')===d[0];
        kids[i].className='phi-switch-btn'+(on?' on':'');
        kids[i].setAttribute('aria-pressed',on?'true':'false');
      }
    });
    g.appendChild(b);
  });
  return g;
}
