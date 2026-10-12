/* A small REAL-ENOUGH DOM for the Production Ops shell tests and its layout fragment (not a *.test.js; the runner skips it).

   tests/harness.js's element stub is a bag of properties: appendChild pushes, but textContent is a plain field, there is no
   removeChild, no parent, no way to read back a tree. js/ph-ui.js builds EVERYTHING with createElement/textContent/appendChild (it
   never parses a string as HTML), so its tests need a tree they can walk. This gives them one:
     · nodes with a parent, children, firstChild, removeChild, a textContent that really aggregates and really replaces
     · classList over className, attributes, listeners (dispatch() fires them), closest('#id' | '.class')
     · getElementById that only finds nodes that are ATTACHED under document.body (so "mounted" means mounted)
     · toHtml(node): serialises a tree with escaping, for the smoke-layout fragment and for XSS assertions.
   What it cannot do: layout. Geometry is held by the stylesheet assertions and the smoke-layout fragment in real Chromium. */
'use strict';

function install(ctx,opts){
  opts=opts||{};
  const doc=ctx.document;
  let seq=0;
  function classes(n){return String(n.className||'').split(/\s+/).filter(Boolean);}
  function setClasses(n,list){n.className=list.join(' ');}
  function mk(tag){
    const n={
      nodeType:1,tagName:String(tag).toUpperCase(),id:'',className:'',children:[],parentNode:null,_attrs:{},_ls:{},_text:'',style:{},dataset:{},seq:++seq,
      get firstChild(){return this.children[0]||null;},
      get lastChild(){return this.children[this.children.length-1]||null;},
      get childNodes(){return this.children;},
      get textContent(){return this._text+this.children.map(c=>c.nodeType===3?c.nodeValue:c.textContent).join('');},
      set textContent(v){this.children.forEach(c=>{c.parentNode=null;});this.children=[];this._text=v==null?'':String(v);},
      appendChild(c){
        if(c.parentNode)c.parentNode.removeChild(c);
        c.parentNode=this;this.children.push(c);return c;
      },
      removeChild(c){const i=this.children.indexOf(c);if(i<0)throw new Error('not a child');this.children.splice(i,1);c.parentNode=null;return c;},
      setAttribute(k,v){this._attrs[k]=String(v);if(k==='id')this.id=String(v);if(k==='class')this.className=String(v);},
      getAttribute(k){if(k==='id'&&this.id)return this.id;if(k==='class')return this.className||null;return Object.prototype.hasOwnProperty.call(this._attrs,k)?this._attrs[k]:null;},
      removeAttribute(k){delete this._attrs[k];},
      hasAttribute(k){return this.getAttribute(k)!==null;},
      classList:{
        _n:null,
        contains(c){return classes(this._n).indexOf(c)>-1;},
        add(c){const l=classes(this._n);if(l.indexOf(c)<0){l.push(c);setClasses(this._n,l);}},
        remove(c){setClasses(this._n,classes(this._n).filter(x=>x!==c));},
        toggle(c,f){const has=this.contains(c);const want=f===undefined?!has:!!f;if(want&&!has)this.add(c);else if(!want&&has)this.remove(c);return want;}
      },
      addEventListener(t,fn){(this._ls[t]=this._ls[t]||[]).push(fn);},
      removeEventListener(t,fn){if(this._ls[t])this._ls[t]=this._ls[t].filter(f=>f!==fn);},
      closest(sel){
        for(let p=this;p;p=p.parentNode){
          if(p.nodeType!==1)continue;
          if(sel.charAt(0)==='#'&&p.id===sel.slice(1))return p;
          if(sel.charAt(0)==='.'&&classes(p).indexOf(sel.slice(1))>-1)return p;
        }
        return null;
      },
      focus(){doc.__active=this;},
      scrollTop:0
    };
    n.classList._n=n;
    return n;
  }
  const text=v=>({nodeType:3,nodeValue:String(v),parentNode:null,children:[]});
  const body=mk('body');body.id='';
  const main=mk('div');main.id='main-content';body.appendChild(main);
  function find(root,id){
    if(root.id===id)return root;
    for(const c of root.children){if(c.nodeType===1){const r=find(c,id);if(r)return r;}}
    return null;
  }
  doc.createElement=mk;
  doc.createTextNode=text;
  doc.body=body;
  doc.getElementById=id=>find(body,id);
  Object.defineProperty(doc,'activeElement',{get(){return doc.__active||null;},configurable:true});
  // html: a node of its own (classList over className)
  const html=mk('html');
  doc.documentElement=html;
  // keydown etc. registered on document are recorded by the harness in state.listeners
  return{
    body,main,html,mk,find:id=>find(body,id),
    walk(root,fn){(function w(n){if(n.nodeType===1){fn(n);n.children.forEach(w);}})(root);},
    all(root,pred){const out=[];(function w(n){if(n.nodeType===1){if(pred(n))out.push(n);n.children.forEach(w);}})(root);return out;},
    byClass(root,c){return this.all(root,n=>classes(n).indexOf(c)>-1);},
    /** fire the listeners a node registered; returns the event */
    dispatch(node,type,ev){
      const e=Object.assign({type,target:node,currentTarget:node,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}},ev||{});
      (node._ls[type]||[]).slice().forEach(f=>f(e));
      return e;
    },
    click(node){return this.dispatch(node,'click');}
  };
}

const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function toHtml(n){
  if(n.nodeType===3)return esc(n.nodeValue);
  const t=n.tagName.toLowerCase();
  let a='';
  if(n.id)a+=' id="'+esc(n.id)+'"';
  if(n.className)a+=' class="'+esc(n.className)+'"';
  Object.keys(n._attrs).forEach(k=>{if(k!=='id'&&k!=='class')a+=' '+k+'="'+esc(n._attrs[k])+'"';});
  return'<'+t+a+'>'+esc(n._text)+n.children.map(toHtml).join('')+'</'+t+'>';
}

module.exports={install,toHtml};
