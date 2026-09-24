#!/usr/bin/env node
/* For every drop position, compare what the USER sees (how much of the
   dragged card overlaps the column) against what the code DOES. */
'use strict';
const path=require('path');
const {loadApp}=require(path.join(__dirname,'..','tests/harness'));
const COL={x:400,y:100,w:280,h:120};      // a brand-new empty column, after layout
const CARD={w:220,h:100};

function joins(x,y){
  const app=loadApp({files:['js/boards.js'],
    session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},currentPage:'board-canvas'});
  app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
    _editConnectors=[];_editUnsorted=[];_boardsSelection=new Set(['n1']);_boardsUndo=[];_boardsRedo=[];
    _boardsCellFocus=null;_boardsConnSel=null;_boardsSuppressClick=false;_boardsSnapGrid=false;
    _editCards=[{id:'col',type:'column',title:'',x:${COL.x},y:${COL.y},w:${COL.w},h:${COL.h}},
                {id:'n1',type:'text',text:'a',x:60,y:600,w:${CARD.w},h:${CARD.h}}];`);
  app.run(`(function(){const h=document.getElementById('drag-head');
    window.boardsCardDragStart({currentTarget:h,target:h,clientX:0,clientY:0,pointerId:1,
      stopPropagation(){},shiftKey:false,ctrlKey:false,metaKey:false},'n1');})()`);
  const ev=t=>({type:t,clientX:x-60,clientY:y-600,pointerId:1,altKey:true,shiftKey:false});
  (app.state.listeners.pointermove||[]).slice().forEach(f=>f(ev('pointermove')));
  (app.state.listeners.pointerup||[]).slice().forEach(f=>f(ev('pointerup')));
  return !!app.run(`(_editCards.find(c=>c.id==='n1')||{}).columnId||''`);
}
function overlapPct(x,y){
  const ox=Math.max(0,Math.min(x+CARD.w,COL.x+COL.w)-Math.max(x,COL.x));
  const oy=Math.max(0,Math.min(y+CARD.h,COL.y+COL.h)-Math.max(y,COL.y));
  return Math.round(ox*oy/(CARD.w*CARD.h)*100);
}
let missed=[],ok=0,tested=0;
for(let x=COL.x-200;x<=COL.x+COL.w+20;x+=20)
  for(let y=COL.y-90;y<=COL.y+COL.h+40;y+=10){
    const p=overlapPct(x,y);if(p<25)continue;
    tested++;
    if(joins(x,y))ok++;else missed.push({x,y,p});
  }
console.log('drop positions where the card visually overlaps the column by 25% or more: '+tested);
console.log('  joined the column : '+ok);
console.log('  did NOT join      : '+missed.length);
const byPct={};missed.forEach(m=>{const b=Math.floor(m.p/10)*10;byPct[b]=(byPct[b]||0)+1;});
console.log('\n  refused drops, by how much of the card was over the column:');
Object.keys(byPct).sort((a,b)=>a-b).forEach(b=>console.log('    '+b+'-'+(+b+9)+'% overlap : '+byPct[b]+' positions refused'));
const worst=missed.sort((a,b)=>b.p-a.p)[0];
if(worst)console.log('\n  worst refusal: '+worst.p+'% of the card was inside the column and it still would not drop');
