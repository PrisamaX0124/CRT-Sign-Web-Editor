/* Modified by PrisamaX0124, 2026-10-06: text lines, railway icon, station glyphs and public release data separation; see docs/fork-changes.md. */
/** Reference-derived vertical maps. Geometry and ink bounds are computed once for preview/export. */
(function(global) {
  'use strict';
  var Core=global.SignCore, Ref=global.PlatformVerticalReference;
  function metrics(state,measure) {
    var count=state.stations.length, current=state.stations.findIndex(function(s){return s.id===state.currentId;});
    var double=state.verticalVariant==='double', geometry=global.PlatformState.verticalGeometry(count,state.verticalVariant,state.sizes.vertical.height), W=geometry.contentWidth, H=geometry.contentHeight,unit=geometry.bodyUnit;
    var nodes=[],elements=[],columns=[],context=null,origin=0,mirror=false;
    var reference=state.verticalLayout==='reference',first=geometry.first,last=geometry.last;
    // Rotate the horizontal reading order: list start is below, list end is above.
    var positions=state.stations.map(function(_,i){return count===1?(72+H)/2:reference?first+(Ref.stations[i].y-144)*(last-first)/645:first+i*(last-first)/(count-1);}).reverse();
    var fg=Core.contrastTextColor(state.color);
    function tint(factor) {return '#'+state.muted.slice(1).match(/../g).map(function(v){return Math.round(parseInt(v,16)*factor).toString(16).padStart(2,'0');}).join('');}
    function x(left,width) {return origin+(mirror?512-left-width:left);}
    function point(left) {return origin+(mirror?512-left:left);}
    function node(tag,attrs,text,bounds,matrix,label) {
      if(context) {attrs['data-element-key']=context.key; if(context.id)attrs['data-station-id']=context.id;}
      var n={tag:tag,attrs:attrs}; if(text!==undefined)n.text=text;if(bounds)n.bounds=bounds;
      if(matrix){n.matrix=matrix;attrs.transform='matrix('+matrix.join(' ')+')';}if(label){n.label=label;attrs['aria-label']=label;}
      nodes.push(n);return n;
    }
    function rect(left,top,width,height,fill,role) {node('rect',{x:left,y:top,width:width,height:height,fill:fill,'data-role':role});}
    function circle(cx,cy,r,fill,stroke,sw,role) {node('circle',{cx:cx,cy:cy,r:r,fill:fill,stroke:stroke||'none','stroke-width':sw||0,'data-role':role});}
    function outline(asset,left,top,k,fill,role,label) {
      var b=asset.bounds, width=b.width*k;
      node('path',{d:asset.d,fill:fill,'fill-rule':'nonzero','data-role':role},undefined,b,[k,0,0,k,x(left,width)-b.x*k,top-b.y*k],label);
    }
    function fitted(value,size,maxWidth,maxHeight,weight,family) {
      var m;
      for(var i=0;i<6;i++) {
        var b=measure.ink(value,family,weight,size),a=measure.ascent(value,family,weight,size),d=measure.descent(value,family,weight,size);
        m={size:size,abl:b.abl,width:b.abl+b.abr,height:a+d,ascent:a};
        var k=Math.min(1,maxWidth/Math.max(.001,m.width),maxHeight/Math.max(.001,m.height));
        if(k>=.9999)break;size*=k*.999;
      }
      return m;
    }
    function text(value,left,top,size,maxWidth,maxHeight,fill,weight,role,align,family,scaleFont) {
      if(!value)return;family=family||Core.FONT_ZH;weight=weight||400;
      var m=fitted(value,size*(scaleFont===false?1:state.fontScale),maxWidth,maxHeight,weight,family);
      if(align==='center')left+=(maxWidth-m.width)/2;
      node('text',{x:x(left,m.width)+m.abl,y:top+m.ascent,fill:fill,'font-size':m.size,'font-family':family,'font-weight':weight,'data-role':role},value,{x:x(left,m.width),y:top,width:m.width,height:m.height,maxWidth:maxWidth});
    }
    function lettering(value,asset,left,top,maxWidth,maxHeight,fill,weight,role,align,size,assetScale) {
      if(!value)return;
      if(asset) {
        var k=Math.min((assetScale||1)*state.fontScale,maxWidth/asset.bounds.width,maxHeight/asset.bounds.height);
        if(align==='center')left+=(maxWidth-asset.bounds.width*k)/2;
        outline(asset,left,top,k,fill,role,value);
      } else text(value,left,top,size||24,maxWidth,maxHeight,fill,weight,role,align);
    }
    function box(n) {
      var a=n.attrs,b=n.bounds,m=n.matrix;
      if(b) {
        if(!m)return b;
        var corners=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]];
        var xs=corners.map(function(p){return p[0]*m[0]+p[1]*m[2]+m[4];}),ys=corners.map(function(p){return p[0]*m[1]+p[1]*m[3]+m[5];});
        return{x:Math.min.apply(null,xs),y:Math.min.apply(null,ys),width:Math.max.apply(null,xs)-Math.min.apply(null,xs),height:Math.max.apply(null,ys)-Math.min.apply(null,ys)};
      }
      if(n.tag==='circle'){var r=a.r+(a['stroke-width']||0)/2;return{x:a.cx-r,y:a.cy-r,width:r*2,height:r*2};}
      if(n.tag==='rect')return{x:a.x,y:a.y,width:a.width,height:a.height};
      if(n.tag==='line'){var s=(a['stroke-width']||0)/2;return{x:Math.min(a.x1,a.x2)-s,y:Math.min(a.y1,a.y2)-s,width:Math.abs(a.x2-a.x1)+s*2,height:Math.abs(a.y2-a.y1)+s*2};}
      var pts=a.points.split(' ').map(function(p){return p.split(',').map(Number);});
      var xx=pts.map(function(p){return p[0];}),yy=pts.map(function(p){return p[1];});
      return{x:Math.min.apply(null,xx),y:Math.min.apply(null,yy),width:Math.max.apply(null,xx)-Math.min.apply(null,xx),height:Math.max.apply(null,yy)-Math.min.apply(null,yy)};
    }
    function placeInk(n,k,dx,dy) {
      // Keep SVG geometry and the ink used by selection/export in the same coordinates.
      if(n.matrix||n.tag==='text') {
        var m=n.matrix||[1,0,0,1,0,0];
        n.matrix=m.map(function(v,i){return v*k+(i===4?dx:i===5?dy:0);});
        n.attrs.transform='matrix('+n.matrix.join(' ')+')';
      } else if(n.tag==='circle') {
        n.attrs.cx=n.attrs.cx*k+dx;n.attrs.cy=n.attrs.cy*k+dy;n.attrs.r*=k;
        n.attrs['stroke-width']*=k;
      } else if(n.tag==='rect') {
        n.attrs.x=n.attrs.x*k+dx;n.attrs.y=n.attrs.y*k+dy;n.attrs.width*=k;n.attrs.height*=k;
        if(n.attrs.rx)n.attrs.rx*=k;
      } else if(n.tag==='line') {
        ['x1','x2'].forEach(function(a){n.attrs[a]=n.attrs[a]*k+dx;});
        ['y1','y2'].forEach(function(a){n.attrs[a]=n.attrs[a]*k+dy;});n.attrs['stroke-width']*=k;
      }
    }
    function begin(key,id,label,kind) {context={key:key,id:id,label:label,kind:kind,start:nodes.length};}
    function end() {
      var slice=nodes.slice(context.start);if(!slice.length){context=null;return;}
      var boxes=slice.map(box),left=Math.min.apply(null,boxes.map(function(b){return b.x;})),top=Math.min.apply(null,boxes.map(function(b){return b.y;}));
      var right=Math.max.apply(null,boxes.map(function(b){return b.x+b.width;})),bottom=Math.max.apply(null,boxes.map(function(b){return b.y+b.height;}));
      var offset=state.adjustments[context.key]||{x:0,y:0};
      slice.forEach(function(n){if(offset.x||offset.y)n.attrs.transform='translate('+offset.x+' '+offset.y+') '+(n.attrs.transform||'');});
      elements.push({key:context.key,stationId:context.id,label:context.label,kind:context.kind,box:{x:left+offset.x,y:top+offset.y,width:right-left,height:bottom-top}});context=null;
    }
    function numeral(value,cx,cy,fill,role,collection,height,width) {
      var asset=collection[value];
      if(asset){var b=asset.bounds,k=Math.min(1,height/b.height,width/b.width);outline(asset,cx+(b.x-asset.center[0])*k,cy+(b.y-asset.center[1])*k,k,fill,role,value);}
      else if(/^\d+$/.test(value)&&(role==='vertical-station-code'||role==='vertical-badge-code')) {
        var digits=value.split('').map(function(c){return Ref.stationDigits[c];}),gap=2;
        var total=digits.reduce(function(w,d){return w+d.bounds.width;},0)+gap*(digits.length-1);
        var normalHeight=Ref.numbers['01'].bounds.height;
        var target=role==='vertical-station-code'?normalHeight:Math.min(height,role==='vertical-badge-code'||role==='vertical-badge-line'?Ref.badge['07'].bounds.height:height);
        var scale=Math.min(target/normalHeight,width/total),left=cx-total*scale/2;
        if(mirror)left=cx+total*scale/2;
        digits.forEach(function(d,i){
          var offset=mirror?left-d.bounds.width*scale:left;
          outline(d,offset,cy+(d.bounds.y-d.baseline+9)*scale,scale,fill,role,value[i]);
          left+=(mirror?-1:1)*(d.bounds.width+gap)*scale;
        });
      }
      else {
        var family=/^\d+$/.test(value)?Core.FONT_NUM:Core.FONT_ZH,m=fitted(value,height/.9,width,height,400,family);
        node('text',{x:point(cx)-m.width/2+m.abl,y:cy-m.height/2+m.ascent,fill:fill,'font-size':m.size,'font-family':family,'font-weight':400,'data-role':role},value,{x:point(cx)-m.width/2,y:cy-m.height/2,width:m.width,height:m.height,maxWidth:width});
      }
    }
    function caption(s,y,isCurrent,paint) {
      var sample=Ref.stations.find(function(r){return r.zh===s.zh;}), assets=sample&&sample.normal;
      var sourceY=sample&&sample.y;
      ['zh','en'].forEach(function(lang) {
        var asset=assets&&(!sample||s[lang]===sample[lang])&&assets[lang];
        var left=asset?asset.bounds.x-4:291, top=asset?y+asset.bounds.y-4-sourceY:y+(lang==='zh'?(isCurrent?-24:-21):(isCurrent?11:9));
        lettering(s[lang],asset,left,top,512-left-8,lang==='zh'?(isCurrent?26:23):(isCurrent?16:15),paint,isCurrent?600:400,'vertical-station-'+lang,null,lang==='zh'?(isCurrent?28:24):16);
      });
    }
    function transfer(s,y,center) {
      if(!s.transfers.length)return;
      // Lay out in positive reading coordinates, then scale the whole secondary assembly.
      var previousOrigin=origin,previousMirror=mirror,start=nodes.length;origin=0;mirror=false;
      ['zh','en'].forEach(function(lang){var a=Ref.transfer[lang];outline(a,a.bounds.x-4,y+a.bounds.y-4-655,1,'#000000','vertical-transfer-'+lang,lang==='zh'?'换乘':'Transfer');});
      var n=s.transfers.length,r=n<=2?20:n===3?16:11;
      var named=s.transfers.some(function(t){return t.type==='text';}),cursor=86;
      s.transfers.forEach(function(t,i) {
        if(i%3===0)cursor=86;
        var w=t.type==='text'?r*4:r*2;
        var cx=named?cursor+w/2:106+(n<=2?48:36)*(i%3),cy=y+(n>3?(Math.floor(i/3)*28-14):0);
        cursor+=w+8;
        if(t.type==='text') {
          node('rect',{x:cx-w/2,y:cy-r,width:w,height:r*2,rx:r/3,fill:t.color,'data-role':'vertical-transfer-text-badge'});
          var fg=Core.contrastTextColor(t.color);
          text(t.nameZh,cx-w/2+r*.2,cy-r+(t.nameEn?r*.25:r*.55),r*.84,w-r*.4,t.nameEn?r*.88:r*.9,fg,400,'vertical-transfer-text-zh','center',Core.FONT_ZH,false);
          if(t.nameEn)text(t.nameEn,cx-w/2+r*.2,cy+r*.35,r*.5,w-r*.4,r*.52,fg,400,'vertical-transfer-text-en','center',Core.FONT_ZH,false);
          return;
        }
        circle(point(cx),cy,r,t.color,null,0,'vertical-transfer-circle');
        numeral(t.number,cx,cy,Core.contrastTextColor(t.color),'vertical-transfer-number',Ref.transferNumbers,r*1.1,r*1.7);
      });
      if(s.transfers.length===1&&!named) ['lineZh','lineEn'].forEach(function(lang){var a=Ref.transfer[lang];outline(a,a.bounds.x-4,y+a.bounds.y-4-655,1,'#000000','vertical-transfer-label',lang==='lineZh'?'号线':'Line');});
      var assembly=nodes.slice(start),boxes=assembly.map(box),k=.75*Math.min(1,state.fontScale);
      var left=Math.min.apply(null,boxes.map(function(b){return b.x;})),right=Math.max.apply(null,boxes.map(function(b){return b.x+b.width;}));
      if(named)k=Math.min(k,200/(right-left));
      var dx=center-(left+right)/2*k,dy=y*(1-k);
      assembly.forEach(function(n){placeInk(n,k,dx,dy);});
      origin=previousOrigin;mirror=previousMirror;
    }
    function column(which,dir,reverse) {
      origin=double&&which==='right'?W-512:0;mirror=reverse;
      var top=positions[count-1],bottom=positions[0],verticalDir=-dir,cy=positions[current],markerX=point(218),barLeft=markerX+(x(218,64)-markerX)*unit;
      // Both ends extend 40 units beyond the outer station centers. Translate
      // the original cap inward, then meet its shorter edge without a ledge.
      var barTop=top-(verticalDir===-1?3.059:40)*unit,barBottom=bottom+(verticalDir===1?3.059:40)*unit;
      columns.push({side:which,direction:dir,verticalDirection:verticalDir,positions:positions.slice(),markerX:markerX,badgeX:markerX+(point(250)-markerX)*unit,unit:unit});
      rect(barLeft,barTop,64*unit,barBottom-barTop,state.muted,'vertical-bar');
      rect(barLeft,verticalDir===1?cy:barTop,64*unit,verticalDir===1?barBottom-cy:cy-barTop,state.color,'vertical-active-bar');
      var endpoint=(dir===1?top:bottom)-verticalDir*25.941*unit;
      var pts=[[218,1.941],[282,-35],[282,29],[218,65.941]].map(function(p,i){var y=endpoint+p[1]*unit*verticalDir;return[markerX+(point(p[0])-markerX)*unit,i<2?Core.clamp(y,barTop,barBottom):y];});
      node('polygon',{points:pts.map(function(p){return p.join(',');}).join(' '),fill:state.color,'data-role':'vertical-tail','data-column-side':which,'data-direction':dir});
      state.stations.forEach(function(s,i) {
        var y=positions[i],active=(i-current)*dir>=0,ink=active?'#000000':tint(.7),marker=active?state.color:tint(.8),start=nodes.length;
        begin('vertical:'+which+':'+s.id,s.id,s.zh||s.code,'vertical-station');
        if(i===current) {
          rect(x(250,262),y-32,262,64,state.color,'vertical-current-band');
          circle(point(250),y,32,state.color,null,0,'vertical-badge');
          circle(point(250),y,31,'none',fg,2,'vertical-badge-ring');
          node('line',{x1:point(222),y1:y,x2:point(278),y2:y,stroke:fg,'stroke-width':2,'stroke-linecap':'square','data-role':'vertical-badge-divider'});
          numeral(state.line,250,y-14,fg,'vertical-badge-line',Ref.badge,24,50);
          numeral(s.code,250,y+14,fg,'vertical-badge-code',Ref.badge,24,50);
          caption(s,y,true,fg);
        } else {
          circle(point(218),y,20,state.background,null,0,'vertical-station-circle');
          circle(point(218),y,21,'none',marker,2,'vertical-station-ring');
          numeral(s.code,218,y,marker,'vertical-station-code',Ref.numbers,18,34);caption(s,y,false,ink);
        }
        // The supplied current-stop transfer assembly sits 3px below its marker.
        if(!double) transfer(s,y+(reference&&s.id===state.currentId?3:0),reverse?406:106);
        if(unit<1)nodes.slice(start).forEach(function(n){placeInk(n,unit,markerX*(1-unit),y*(1-unit));});
        end();
      });
    }
    rect(0,0,W,H,state.background,'vertical-background');rect(0,0,W,72,state.color,'vertical-header');
    var dirs=double?[state.direction*(state.verticalSwapped?-1:1),-state.direction*(state.verticalSwapped?-1:1)]:[state.direction];
    if(double){column('left',dirs[0],true);column('right',dirs[1],false);}
    else column(state.verticalVariant,dirs[0],state.verticalVariant==='right');
    origin=0;mirror=false;
    if(double) {
      state.stations.forEach(function(s,i){
        if(!s.transfers.length)return;
        begin('vertical:transfer:'+s.id,s.id,s.zh+' · 换乘','vertical-transfer');
        var start=nodes.length,y=positions[i];
        transfer(s,y+(reference&&s.id===state.currentId?3:0),W/2);
        if(unit<1)nodes.slice(start).forEach(function(n){placeInk(n,unit,W/2*(1-unit),y*(1-unit));});end();
      });
      [W/3,W*2/3].forEach(function(xx){node('line',{x1:xx,y1:0,x2:xx,y2:72,stroke:fg,'stroke-width':3,'data-role':'vertical-header-divider'});});
    } else node('line',{x1:256,y1:0,x2:256,y2:72,stroke:fg,'stroke-width':3,'data-role':'vertical-header-divider'});
    var here=state.stations[current];
    begin('vertical:title',here.id,here.zh,'vertical-title');
    ['zh','en'].forEach(function(lang) {
      var asset=null;
      var left=double?W/3+8:264, width=double?W/3-16:240, top=lang==='zh'?13.2314:45.8555;
      if(!double&&state.verticalVariant==='right')mirror=true;
      if(asset&&!double&&state.fontScale===1)outline(asset,asset.bounds.x-4,asset.bounds.y-4,1,fg,'vertical-title-'+lang,here[lang]);
      else lettering(here[lang],asset,left,top,width,lang==='zh'?26:16,fg,600,'vertical-title-'+lang,'center',lang==='zh'?28:18);
    });end();mirror=false;
    function directionHeader(which,dir) {
      origin=double&&which==='right'?W-512:0;mirror=which==='right';
      var terminal=state.stations[dir===1?count-1:0];
      begin('vertical:direction:'+which,null,'前往'+terminal.zh,'vertical-direction');
      // Header arrows follow the panel side; the route body uses verticalDir.
      var a=Ref.header.arrow,b=a.bounds,cx=origin+(mirror?488:24),horizontal=mirror?-1:1;
      node('path',{d:a.d,fill:fg,'data-role':'vertical-direction-arrow','data-direction':dir},undefined,b,[horizontal,0,0,1,cx-horizontal*28,-4]);
      var textStart=nodes.length,top=0;
      ['zh','en'].forEach(function(lang) {
        var asset=null,value=lang==='zh'?terminal.zh+'方向':'To '+(terminal.en||terminal.zh);
        var left=50,maxHeight=lang==='zh'?22:14;
        lettering(value,asset,left,top,double?W/3-58:194,maxHeight,fg,400,'vertical-direction-'+lang,null,lang==='zh'?28:18,asset?maxHeight/asset.bounds.height:1);
        top+=box(nodes[nodes.length-1]).height+(lang==='zh'?8:0);
      });
      nodes.slice(textStart).forEach(function(n){placeInk(n,1,0,(72-top)/2);});end();
    }
    if(double){directionHeader('left',dirs[0]);directionHeader('right',dirs[1]);}
    else directionHeader(state.verticalVariant,state.direction);
    var output=state.sizes.vertical,scale=geometry.scale,usedFonts={};
    nodes.forEach(function(n){if(n.tag==='text'){usedFonts[n.attrs['font-family']===Core.FONT_NUM?'num400':'zh'+n.attrs['font-weight']]=true;if(n.attrs['font-family']===Core.FONT_NUM&&/[^\x00-\x7F]/.test(n.text))usedFonts.zh400=true;}});
    return {width:W,height:H,output:output,nodes:nodes,elements:elements,columns:columns,stationIds:state.stations.map(function(s){return s.id;}),usedFonts:usedFonts,background:state.background,frame:{scale:scale,x:(output.width-W*scale)/2,y:(output.height-H*scale)/2}};
  }
  global.PlatformVertical={metrics:metrics};
})(typeof window!=='undefined'?window:globalThis);
