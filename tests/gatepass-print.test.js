/* Gate pass print (js/print-engine.js, variant 'gate-pass'): the fabric items table's last
   column head follows the unit the rows print (Oct 2026). A pass in METRES is a length, so
   its head reads 'Length' (every spelling of metres: m, meter(s), metre(s)); kg or no unit
   stays 'Weight' exactly as before; a pass that mixes both reads 'Weight / Length'. The
   stored unit is printed beside each number untouched. Driven against a recording fake
   jsPDF, like job-print: it proves what is DRAWN, not how a printer renders it. */
'use strict';
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const FAKE=`__docs=[];
FakePDF=function(opts){
  let W=595.28,H=841.89;
  const d=this;let page=1,pages=1,size=16,style='normal',ink='0,0,0',draw='0,0,0',lw=0.2;
  d.log={text:[],rect:[],line:[],pages:1};
  d.internal={pageSize:{getWidth:()=>W,getHeight:()=>H}};
  d.addPage=()=>{pages++;page=pages;d.log.pages=pages;return d;};
  d.setPage=p=>{page=p;return d;};
  d.getNumberOfPages=()=>pages;
  d.setFont=(f,s)=>{style=s||'normal';return d;};
  d.setFontSize=s=>{size=s;return d;};
  d.setTextColor=(r,g,b)=>{ink=[r,g,b].join(',');return d;};
  d.setDrawColor=(r,g,b)=>{draw=[r,g,b].join(',');return d;};
  d.setLineWidth=w=>{lw=w;return d;};
  ['setFillColor','addFileToVFS','addFont','roundedRect'].forEach(k=>{d[k]=function(){return d;};});
  d.getTextWidth=t=>String(t).length*size*0.5;
  d.splitTextToSize=(t,w)=>{const out=[];String(t).split('\\n').forEach(par=>{let cur='';par.split(' ').forEach(wd=>{const nx=cur?cur+' '+wd:wd;if(cur&&nx.length*size*0.5>w){out.push(cur);cur=wd;}else cur=nx;});out.push(cur);});return out;};
  d.text=(t,x,y,o)=>{(Array.isArray(t)?t:[t]).forEach((s,i)=>{d.log.text.push({t:String(s),x,y:y+i*size*1.15,page,size,style,ink,align:o&&o.align||'left',mode:o&&o.renderingMode||'',draw,lw});});return d;};
  d.rect=(x,y,w,h,st)=>{d.log.rect.push({x,y,w,h,st:st||'',page,draw,lw});return d;};
  d.line=(x1,y1,x2,y2)=>{d.log.line.push({x1,y1,x2,y2,page,draw,lw});return d;};
  d.log.images=[];d.addImage=(...a)=>{d.log.images.push(a);return d;};
  d.output=()=>({size:4096,fake:true});
  d.save=()=>{};
  __docs.push(d);
};
window.jspdf={jsPDF:FakePDF};
window.open=u=>{if(u)return null;return {closed:false,location:null,document:{open(){},write(){},close(){}},close(){this.closed=true;}};};`;

function engine(){
  const globals={console:{log(){},info(){},error(){},warn(){}},
    URL:{createObjectURL(){throw new TypeError('x');},revokeObjectURL(){}}};
  const e=harness.loadApp({files:['js/print-engine.js'],currentPage:'dashboard',globals});
  e.run(FAKE);
  return e;
}
async function printPass(e,data){
  const n=e.run('__docs.length');
  await e.run('window.printDocument('+J({type:'gate-pass',filename:'g.pdf',deliver:'blob',data})+')');
  return e.run('__docs['+n+']');
}
const BASE={documentNumber:'GP-021',gpType:'fabric',date:'2026-10-11',time:'10:00',person:'Hassan',article:'Tee',destination:'Factory',cutMaster:'Alam'};
const fab=(unit,w)=>({fabType:'Jersey',gsm:220,color:'Black',rollsCount:3,weight:w||30,unit});
const heads=d=>d.log.text.map(t=>t.t);

module.exports=async function(){
  const s=suite('gatepass-print');
  const e=engine();

  s.section('a pass in metres prints Length, not Weight');
  for(const u of ['m','meters','meter','metre','metres','M','Meters']){
    const d=await printPass(e,Object.assign({},BASE,{fabrics:[fab(u)]}));
    const T=heads(d);
    s.ok("unit '"+u+"': the head is Length and Weight is not printed",T.includes('Length')&&!T.includes('Weight'),J(T.filter(t=>/Length|Weight/.test(t))));
    s.ok("unit '"+u+"': the stored unit is printed beside the number untouched",T.includes('30 '+u),J(T.filter(t=>/^30 /.test(t))));
  }
  {
    // the single-fabric legacy shape (no fabrics array)
    const d=await printPass(e,Object.assign({},BASE,{fabricType:'Twill',fabricGsm:300,fabricColor:'Navy',rollsCount:2,fabricQty:45,fabricUnit:'m'}));
    const T=heads(d);
    s.ok('a pass with no fabrics array but fabricUnit m reads Length',T.includes('Length')&&!T.includes('Weight')&&T.includes('45 m'),J(T.filter(t=>/Length|Weight|^45/.test(t))));
  }

  s.section('kilos are unchanged');
  for(const u of ['kg','kgs',undefined,'']){
    const d=await printPass(e,Object.assign({},BASE,{fabrics:[fab(u)]}));
    const T=heads(d);
    s.ok("unit "+J(u)+": the head is still Weight",T.includes('Weight')&&!T.includes('Length')&&!T.includes('Weight / Length'),J(T.filter(t=>/Length|Weight/.test(t))));
    s.ok("unit "+J(u)+": prints '30 "+(u||'kg')+"' as before",T.includes('30 '+(u||'kg')),J(T.filter(t=>/^30 /.test(t))));
  }

  s.section('a pass that mixes both says so');
  {
    const d=await printPass(e,Object.assign({},BASE,{fabrics:[fab('kg',20),fab('m',40)]}));
    const T=heads(d);
    s.ok('Weight / Length',T.includes('Weight / Length')&&!T.includes('Weight')&&!T.includes('Length'),J(T.filter(t=>/Length|Weight/.test(t))));
    s.ok('each row keeps its own unit',T.includes('20 kg')&&T.includes('40 m'));
  }

  s.section('other pass types are untouched');
  {
    const d=await printPass(e,{documentNumber:'GP-022',gpType:'garments',date:'2026-10-11',items:[{size:'M',units:10,bundles:[1,2],bundleCount:2}]});
    const T=heads(d);
    s.ok('a garments pass has no Length / Weight head',!T.includes('Length')&&!T.includes('Weight / Length'),J(T.filter(t=>/Length|Weight/.test(t))));
    const d2=await printPass(e,{documentNumber:'GP-023',gpType:'other',date:'2026-10-11',items:[{article:'X',units:1,weight:2}]});
    s.ok('the generic table keeps its Weight head',heads(d2).includes('Weight'));
  }
  return s;
};
