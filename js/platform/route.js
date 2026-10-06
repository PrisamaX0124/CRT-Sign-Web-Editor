/** Route hanging sign geometry is measured in the reference's 1536 × 384 content rectangle. */
(function (global) {
  'use strict';
  var Core = global.SignCore, Ref = global.PlatformReference, Q = Math.SQRT1_2;
  function layout(state, output) {
    output = output || state.sizes.route;
    var W = output.width, H = output.height, u = H / 384, count = state.stations.length;
    var current = state.stations.findIndex(function (s) { return s.id === state.currentId; });
    var reference = state.routeLayout === 'reference';
    var guide = Ref.guides[String(state.direction)], first = guide[0] * u;
    // The references have no transfer at their first station. Reserve the same full
    // lower-left transfer assembly when an edited line adds one there.
    if (state.stations[0].transfers.length) first = Math.max(first, (state.stations[0].transfers.length === 1 ? 196 : 220) * u);
    var last = guide[9] * u + W - 1536 * u;
    if (last <= first + 32 * u) { first = W * .25; last = W * .85; }
    var positions = state.stations.map(function (_, i) {
      if (count === 1) return W / 2;
      if (!reference) return first + i * (last-first) / (count-1);
      var t = i * 9 / (count - 1), j = Math.min(8, Math.floor(t)), f = t-j;
      return first + ((guide[j] + (guide[j+1]-guide[j])*f - guide[0]) / (guide[9]-guide[0])) * (last-first);
    });
    var pitch = count > 1 ? Math.min.apply(null, positions.slice(1).map(function (x,i) { return x-positions[i]; })) : W;
    var detail = Math.min(1, pitch / (96*u));
    // One assembly unit drives the bar, marker, notch and transfer junction.
    // Compressing a dense line must never move the branch off its own notch.
    var unit = u * detail, y = 196*u, barH = 45*unit;
    // Responsive positions are visible circle centres, including the current
    // badge. Only the unedited reference keeps its original leftward offset.
    var badgeX = positions[current] - (reference ? 21.584045*unit : 0);
    var anchors = positions.map(function(x,i){return i===current ? badgeX+21.584045*unit : x;});
    return { W:W,H:H,u:u,current:current,reference:reference,positions:positions,pitch:pitch,unit:unit,y:y,barH:barH,badgeX:badgeX,anchors:anchors };
  }
  function metrics(state, measure) {
    var output=state.sizes.route, geo=layout(state), W=geo.W,H=geo.H,u=geo.u,current=geo.current,reference=geo.reference;
    var positions=geo.positions,pitch=geo.pitch,unit=geo.unit,y=geo.y,barH=geo.barH,badgeX=geo.badgeX,anchors=geo.anchors;
    var nodes=[],elements=[],context,count=state.stations.length;
    function mutedInk(factor) { return '#' + state.muted.slice(1).match(/../g).map(function(v){return Math.round(parseInt(v,16)*factor).toString(16).padStart(2,'0');}).join(''); }
    var mutedNumber=mutedInk(.7),mutedName=mutedInk(.8);
    function junctionFor(x) { return { left:x-23.956045*unit, scale:unit }; }
    function node(tag, attrs, value, bounds, matrix) {
      if (context) { attrs['data-element-key']=context.key; attrs['data-station-id']=context.id; }
      var n = { tag:tag, attrs:attrs };
      if (value !== undefined) n.text=value;
      if (bounds) n.bounds=bounds;
      if (matrix) { attrs.transform='matrix('+matrix.join(' ')+')'; n.matrix=matrix; }
      nodes.push(n); return n;
    }
    function rect(x,top,w,h,fill,role) { node('rect',{x:x,y:top,width:w,height:h,fill:fill,'data-role':role}); }
    function polygon(points,fill,role) { node('polygon',{points:points.map(function(p){return p.join(',');}).join(' '),fill:fill,'data-role':role}); }
    function circle(x,top,r,fill,stroke,sw,role) { node('circle',{cx:x,cy:top,r:r,fill:fill,stroke:stroke||'none','stroke-width':sw||0,'data-role':role}); }
    function shapeBounds(n) {
      var a=n.attrs,b=n.bounds;
      if (!b) {
        if(n.tag==='circle'||n.tag==='ellipse') { var rx=a.rx||a.r,ry=a.ry||a.r,sw=(a['stroke-width']||0)/2; b={x:a.cx-rx-sw,y:a.cy-ry-sw,width:2*(rx+sw),height:2*(ry+sw)}; }
        else if(n.tag==='rect') b={x:a.x,y:a.y,width:a.width,height:a.height};
        else { var p=a.points.split(' ').map(function(s){return s.split(',').map(Number);}),xs=p.map(function(v){return v[0];}),ys=p.map(function(v){return v[1];}); b={x:Math.min.apply(null,xs),y:Math.min.apply(null,ys),width:Math.max.apply(null,xs)-Math.min.apply(null,xs),height:Math.max.apply(null,ys)-Math.min.apply(null,ys)}; }
      }
      if(!n.matrix)return b;
      var m=n.matrix,p2=[[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(function(p){return [m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]];}),xx=p2.map(function(p){return p[0];}),yy=p2.map(function(p){return p[1];});
      return {x:Math.min.apply(null,xx),y:Math.min.apply(null,yy),width:Math.max.apply(null,xx)-Math.min.apply(null,xx),height:Math.max.apply(null,yy)-Math.min.apply(null,yy)};
    }
    function begin(s) { context={key:'route:'+s.id,id:s.id,label:s.zh||s.code,start:nodes.length}; }
    function end() {
      var offset=state.adjustments[context.key]||{x:0,y:0}, slice=nodes.slice(context.start), boxes=slice.map(shapeBounds);
      var x=Math.min.apply(null,boxes.map(function(b){return b.x;})),top=Math.min.apply(null,boxes.map(function(b){return b.y;}));
      var right=Math.max.apply(null,boxes.map(function(b){return b.x+b.width;})),bottom=Math.max.apply(null,boxes.map(function(b){return b.y+b.height;}));
      slice.forEach(function(n){if(offset.x||offset.y)n.attrs.transform='translate('+offset.x+' '+offset.y+') '+(n.attrs.transform||'');});
      elements.push({key:context.key,stationId:context.id,label:context.label,kind:'route-station',box:{x:x+offset.x,y:top+offset.y,width:right-x,height:bottom-top}});context=null;
    }
    function ink(value,family,weight,size) {
      var m=measure.ink(value,family,weight,size),a=measure.ascent(value,family,weight,size),d=measure.descent(value,family,weight,size);
      return {abl:m.abl,width:m.abl+m.abr,height:a+d,ascent:a,size:size};
    }
    function fitted(value,family,weight,size,maxWidth,maxHeight) {
      var m=ink(value,family,weight,size);
      for(var j=0;j<5;j++){var k=Math.min(1,maxWidth/Math.max(.001,m.width),maxHeight/Math.max(.001,m.height));if(k>=.9999)break;m=ink(value,family,weight,m.size*k*.999);}
      return m;
    }
    function text(value,left,top,m,family,weight,fill,role,matrix) {
      if(!value)return;
      node('text',{x:left+m.abl,y:top+m.ascent,fill:fill,'font-family':family,'font-weight':weight,'font-size':m.size,'data-role':role},value,{x:left,y:top,width:m.width,height:m.height,maxWidth:m.width},matrix);
    }
    function outlined(asset,fill,role,matrix,label) {
      var n=node('path',{d:asset.d,fill:fill,'fill-rule':'nonzero','data-role':role,'aria-label':label},undefined,asset.bounds,matrix); n.label=label;
      return n;
    }
    function numeral(value,x,top,scale,collection,role,fill,fontSize,maxWidth,maxHeight) {
      var asset=collection[value];
      if(asset) { outlined(asset,fill,role,[scale,0,0,scale,x-asset.center[0]*scale,top-asset.center[1]*scale],value); return; }
      if(role==='station-code' && /^\d+$/.test(value)) {
        var digits=value.split('').map(function(c){return Ref.numbers.stationDigits[c];}), gap=2;
        var width=digits.reduce(function(sum,d){return sum+d.bounds.width;},0)+gap*(digits.length-1);
        var k=Math.min(scale,maxWidth/width),left=x-width*k/2,baseline=top+8.404073*k;
        digits.forEach(function(d,i){
          var n=outlined(d,fill,role,[k,0,0,k,left-d.bounds.x*k,baseline-177.286*k],value[i]);
          left+=(d.bounds.width+gap)*k;
        });
        return;
      }
      var family=/^\d+$/.test(value)?Core.FONT_NUM:Core.FONT_ZH;
      var m=fitted(value,family,400,fontSize,maxWidth,maxHeight);text(value,x-m.width/2,top-m.height/2,m,family,400,fill,role);
    }
    function caption(s,x,isCurrent,paint) {
      var sample=Ref.stations.find(function(item){return item.zh===s.zh;}), model=sample&&(isCurrent?sample.current:sample.normal);
      var originX=x+(isCurrent?12:1.414605)*unit;
      var originY=y-(isCurrent?76:75.603-(s.id===state.stations[count-1].id?.200989:0))*unit;
      // Chinese and English have separate anchors in the reference, both rotated
      // about their own origin. Ink baselines never come from an SVG text line box.
      var offsets=isCurrent?[[0,0],[29,29]]:[[0,0],[25,24.656]];
      ['zh','en'].forEach(function(lang,i){
        var value=s[lang];if(!value)return;
        var ox=originX+offsets[i][0]*unit,oy=originY+offsets[i][1]*unit;
        var weight=isCurrent?600:400, nominal=(lang==='zh'?(isCurrent?32:28):(isCurrent?16:14))*unit;
        var asset=model&&model[lang], match=asset&&(lang==='zh'||s.en===sample.en);
        var bx=asset?asset.bounds.x:(lang==='zh'?1.6:.7),by=asset?asset.bounds.y:(lang==='zh'?5.05:3.725);
        var bottom=asset?asset.bounds.y+asset.bounds.height:(lang==='zh'?(isCurrent?35.53:31.071):(isCurrent?17.305:15.868));
        var maxWidth=Math.max(.1,Math.min((oy-2*u)*Math.SQRT2+(by-bx)*unit,(W-ox-2*u)*Math.SQRT2-(bottom+bx)*unit));
        var maxHeight=Math.min((lang==='zh'?32:16)*unit,pitch*.28);
        var zoom=Math.min(state.fontScale,1);
        if(match) {
          zoom=Math.min(zoom,maxWidth/asset.bounds.width/unit,maxHeight/asset.bounds.height/unit);
          var scale=Math.max(.0001,zoom*unit),dy=(bottom*unit-bottom*scale),dx=bx*unit-bx*scale;
          var label=outlined(asset,paint,'name-'+lang,[Q*scale,-Q*scale,Q*scale,Q*scale,ox+Q*(dx+dy),oy+Q*(-dx+dy)],value);
          if(isCurrent)label.attrs['font-weight']=weight;
          if(isCurrent&&lang==='en') {
            // Keep the reference's letterforms and anchors while giving its
            // originally regular English strokes the same emphasis as Chinese.
            label.attrs.stroke=paint;label.attrs['stroke-width']=.55;label.attrs['stroke-linejoin']='round';
            label.bounds={x:asset.bounds.x-.275,y:asset.bounds.y-.275,width:asset.bounds.width+.55,height:asset.bounds.height+.55};
          }
        } else {
          var m=fitted(value,lang==='zh'?Core.FONT_ZH:Core.FONT_EN,weight,nominal*zoom,maxWidth,maxHeight);
          text(value,bx*unit,bottom*unit-m.height,m,lang==='zh'?Core.FONT_ZH:Core.FONT_EN,weight,paint,'name-'+lang,[Q,-Q,Q,Q,ox,oy]);
        }
      });
    }
    function transfers(s,x,connector) {
      if(!s.transfers.length)return;
      var compact=s.transfers.length>2,scale=connector.scale,circleScale=scale*(compact?.7:1);
      var start=connector.left,primary={x:start-85.628*scale,y:y+98*scale},r=25*circleScale;
      var named=s.transfers.some(function(t){return t.type==='text';});
      function skew(left,width,height,fill,role) { polygon([[left,y],[left+width*scale,y],[left+(width-height*Q)*scale,y+height*Q*scale],[left-height*Q*scale,y+height*Q*scale]],fill,role); }
      skew(start,24,64,state.background,'transfer-clearance');
      skew(start+2*scale,20,128,s.transfers[0].color,'transfer-branch');
      s.transfers.forEach(function(t,i){
        var cx=primary.x+(compact?(i%3)*55-Math.floor(i/3)*40:-i*40)*circleScale;
        var cy=primary.y+(compact?Math.floor(i/3)*55:i*40)*circleScale;
        if(named) {cx=primary.x-(i%3)*110*circleScale;cy=primary.y+Math.floor(i/3)*55*circleScale;}
        if(t.type==='text') {
          node('rect',{x:cx-2*r,y:cy-r,width:4*r,height:2*r,rx:r/3,fill:t.color,'data-role':'transfer-text-badge'});
          var fg=Core.contrastTextColor(t.color);
          [['zh',t.nameZh,t.nameEn?cy-r*.75:cy-r*.45,r*.84,t.nameEn?r*.88:r*.9],['en',t.nameEn,cy+r*.35,r*.5,r*.52]].forEach(function(p){
            if(!p[1])return;
            var m=fitted(p[1],Core.FONT_ZH,400,p[3],r*3.6,p[4]);
            text(p[1],cx-m.width/2,p[2],m,Core.FONT_ZH,400,fg,'transfer-text-'+p[0]);
          });
          return;
        }
        circle(cx,cy,r,t.color,null,0,'transfer-circle');
        numeral(t.number,cx,cy,circleScale,Ref.numbers.transfer,'transfer-number',Core.contrastTextColor(t.color),32*circleScale,40*circleScale,32*circleScale);
      });
      // The double-transfer reference deliberately hides both captions (opacity=0).
      if(s.transfers.length===2||compact||named)return;
      [['zh',-179.584045,135.284],['en',-171.583045,161.284]].forEach(function(p){
        var ox=x+p[1]*scale,oy=y+p[2]*scale;
        outlined(Ref.transfer[p[0]],'#000000','transfer-caption',[Q*scale,-Q*scale,Q*scale,Q*scale,ox,oy],p[0]==='zh'?'换乘':'Transfer');
      });
    }
    rect(0,0,W,H,state.background,'background');
    var junction=badgeX-(state.direction===-1?25:26)*unit,left=(state.direction===-1?32:112)*u,right=W-(state.direction===-1?86:51)*u;
    // Preserve the reference's overlapping rectangles, rather than flattening
    // them into one polygon: flattening changes antialiasing along the shared edge.
    var grayX=(state.direction===-1?122:112)*u,grayRight=W-(state.direction===-1?86:96)*u;
    rect(grayX,y,Math.max(0,grayRight-grayX),barH,state.muted,'passed-line');
    if(state.direction===-1){
      polygon([[left,y+barH],[left+barH,y],[left+2*barH,y],[left+barH,y+barH]],state.color,'active-line');
      rect(left+barH,y,Math.max(0,junction-left-barH),barH,state.color,'active-line-core');
    }else{
      polygon([[right-(45.0119*unit),y],[right-90*unit,y],[right-(44.9881*unit),y+barH],[right,y+barH]],state.color,'active-line');
      rect(junction,y,Math.max(0,right-barH-junction),barH,state.color,'active-line-core');
    }
    state.stations.forEach(function(s,i){
      var x=positions[i],isCurrent=i===current,active=(i-current)*state.direction>=0,connector=junctionFor(anchors[i]);
      begin(s);
      if(!isCurrent){
        var nx=reference&&i===0&&!s.transfers.length ? x-21.957396*unit : connector.left;
        polygon([[nx,y],[nx+24*unit,y],[nx+(24-32*Q)*unit,y+32*Q*unit],[nx-32*Q*unit,y+32*Q*unit]],state.background,'station-notch');
      }
      transfers(s,anchors[i],connector);
      if(isCurrent){
        x=badgeX;var cy=y-11.100937*unit,r=42*unit,fg=Core.contrastTextColor(state.color);
        circle(x,cy,40*unit,state.color,null,0,'badge-fill');
        circle(x,cy,r,'none',state.background,4*unit,'current-badge');
        polygon([[x-37*unit,cy+1.100937*unit],[x+37*unit,cy+1.100937*unit],[x+37*unit,cy+3.100937*unit],[x-37*unit,cy+3.100937*unit]],fg,'badge-divider');
        if(state.line==='2')numeral(state.line,x,cy,unit,Ref.numbers.badge,'badge-line',fg,44*unit,64*unit,32*unit);
        else numeral(state.line,x,cy-17.518*unit,unit,{},'badge-line',fg,44*unit,64*unit,32*unit);
        if(s.code==='06')numeral(s.code,x,cy,unit,Ref.numbers.badge,'badge-code',fg,36*unit,64*unit,26*unit);
        else numeral(s.code,x,cy+20.536*unit,unit,{},'badge-code',fg,36*unit,64*unit,26*unit);
      } else {
        var cy=y-(31.118073-(i===count-1?.200989:0))*unit;
        node('ellipse',{cx:x,cy:cy,rx:21.585743*unit,ry:21*unit,r:21.585743*unit,fill:state.background,stroke:active?state.color:mutedNumber,'stroke-width':2*unit,'data-role':'station-number'});
        numeral(s.code,x,cy,unit,Ref.numbers.station,'station-code',active?state.color:mutedNumber,24*unit,34*unit,22*unit);
      }
      caption(s,x,isCurrent,isCurrent?state.color:active?'#000000':mutedName);end();
    });
    var usedFonts={};nodes.forEach(function(n){if(n.tag!=='text')return;if(n.attrs['font-family']===Core.FONT_NUM){usedFonts.num400=true;if(/[^\x00-\x7F]/.test(n.text))usedFonts.zh400=true;}else usedFonts['zh'+n.attrs['font-weight']]=true;});
    return {width:W,height:H,output:output,background:state.background,frame:{scale:1,x:0,y:0},nodes:nodes,elements:elements,stationIds:state.stations.map(function(s){return s.id;}),usedFonts:usedFonts};
  }
  global.PlatformRoute={metrics:metrics,layout:layout};
})(typeof window!=='undefined'?window:globalThis);
