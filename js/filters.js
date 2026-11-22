/* XO LAB — GPU filter library (GLSL ES 3.0 fragment bodies) + presets.
 * Each filter defines vec4 fx(vec2 uv). Common uniforms: uTex, uRes, uTime,
 * uI (intensity, includes audio), uA (audio energy × amount), uP (params x..w), uC1..uC3 (colours).
 */
(function () {
  'use strict';
  const XO = window.XO;
  const P = (k, label, min, max, def, step, fmt) => ({ k, label, min, max, def, step: step || 1, fmt: fmt || '' });
  const SEG = (k, label, options, def) => ({ k, label, seg: options, def });

  XO.FILTERS = {
    rgbsplit: { name: 'RGB split', params: [P('amount', 'Offset', 0, 100, 40), P('angle', 'Angle', 0, 360, 0, 1, '°')], glsl: `
      vec4 fx(vec2 uv){ float a=radians(uP.y); vec2 d=vec2(cos(a),sin(a))*uP.x*0.0004*uI; vec4 c=S(uv), r=S(uv+d), b=S(uv-d);
        return vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a))); }` },
    glitch: { name: 'Glitch blocks', params: [P('block', 'Block size', 4, 120, 24, 1, 'px'), P('speed', 'Speed', 0, 100, 40), P('rgb', 'Colour split', 0, 100, 50)], glsl: `
      vec4 fx(vec2 uv){ vec2 px=uv*uRes; float bs=max(2.,uP.x); vec2 b=floor(px/vec2(bs*4.,bs)); float t=floor(uTime*(1.+uP.y*.3));
        vec2 u=uv; if(hash(b+t)<uI*.35) u.x+=(hash(b*1.7+t)-.5)*.3*uI;
        vec4 c=S(u); if(hash(vec2(b.y,t*1.3))<uI*.3){ float o=uP.z*.0008; c.r=S(u+vec2(o,0.)).r; c.b=S(u-vec2(o,0.)).b; } return c; }` },
    pixelsort: { name: 'Pixel sort (streaks)', params: [P('length', 'Streak length', 2, 64, 32), P('thr', 'Threshold', 0, 100, 55, 1, '%'), SEG('dir', 'Direction', [['0', 'DOWN'], ['1', 'RIGHT'], ['2', 'UP'], ['3', 'LEFT']], '0')], glsl: `
      vec4 fx(vec2 uv){ vec2 dir = uP.z<0.5?vec2(0.,1.):uP.z<1.5?vec2(-1.,0.):uP.z<2.5?vec2(0.,-1.):vec2(1.,0.);
        vec2 st=dir/uRes*2.; vec4 c=S(uv); vec4 best=c; float bl=luma(c.rgb); float thr=uP.y/100.; float n=clamp(uP.x*uI,1.,64.);
        for(int i=1;i<=64;i++){ if(float(i)>n) break; vec4 s=S(uv+st*float(i)); float l=luma(s.rgb); if(l<thr) break; if(l>bl){best=s;bl=l;} }
        return best; }` },
    halftone: { name: 'Halftone', colors: ['fxc.ink', 'fxc.paper'], params: [P('cell', 'Cell size', 3, 40, 8, 1, 'px'), P('angle', 'Angle', 0, 90, 45, 1, '°'), SEG('mode', 'Pattern', [['0', 'DOTS'], ['1', 'LINES']], '0')], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); float a=radians(uP.y); mat2 R=mat2(cos(a),-sin(a),sin(a),cos(a)); vec2 p=R*(uv*uRes); float cs=max(2.,uP.x);
        vec2 cell=floor(p/cs)*cs+cs*.5; vec2 cuv=(transpose(R)*cell)/uRes; float l=luma(S(cuv).rgb); float d;
        if(uP.z<0.5){ d=length(p-cell)-(1.-l)*cs*.7071; } else { d=abs(p.y-cell.y)-(1.-l)*cs*.5; }
        float ink=1.-smoothstep(-.7,.7,d); return vec4(mix(c.rgb, mix(uC2,uC1,ink), clamp(uI,0.,1.)), c.a); }` },
    dither: { name: 'Dither', colors: ['fxc.ink', 'fxc.paper'], params: [P('scale', 'Pixel size', 1, 8, 2), SEG('mode', 'Pattern', [['0', 'BAYER'], ['1', 'NOISE']], '0'), P('contrast', 'Contrast', 0, 100, 30)], glsl: `
      float bayer4(vec2 p){ ivec2 i=ivec2(mod(p,4.)); int m[16]=int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5); return (float(m[i.y*4+i.x])+.5)/16.; }
      vec4 fx(vec2 uv){ float s=max(1.,uP.x); vec2 px=floor(uv*uRes/s); vec4 c=S((px*s+s*.5)/uRes); float l=(luma(c.rgb)-.5)*(1.+uP.z/50.)+.5;
        float th = uP.y<0.5 ? bayer4(px) : hash(px+floor(uTime*24.)); vec3 col = l>th ? uC2 : uC1; vec4 o0=S(uv); return vec4(mix(o0.rgb,col,clamp(uI,0.,1.)), o0.a); }` },
    ascii: { name: 'ASCII', colors: ['fxc.ascii', 'fxc.asciiBg'], atlas: true, params: [P('cell', 'Cell size', 4, 32, 10, 1, 'px'), SEG('mode', 'Colour', [['0', 'MONO'], ['1', 'SOURCE']], '0')], glsl: `
      vec4 fx(vec2 uv){ float cs=max(3.,uP.x); vec2 csz=vec2(cs*.6,cs); vec2 px=uv*uRes; vec2 cell=floor(px/csz); vec4 c=S((cell*csz+csz*.5)/uRes);
        float idx=floor(clamp(luma(c.rgb),0.,.999)*uAtlasN); vec2 f=fract(px/csz); float m=texture(uAtlas, vec2((idx+f.x)/uAtlasN, 1.-f.y)).r;
        vec3 ink = uP.y<0.5 ? uC1 : c.rgb*1.3; vec4 o0=S(uv); return vec4(mix(o0.rgb, mix(uC2, ink, m), clamp(uI,0.,1.)), o0.a); }` },
    thermal: { name: 'Thermal', colors: ['fxc.t1', 'fxc.t2', 'fxc.t3'], params: [P('contrast', 'Contrast', 0, 100, 30), P('shift', 'Shift', 0, 100, 50)], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); float l=clamp((luma(c.rgb)-.5)*(1.+uP.x/40.)+.5+(uP.y-50.)/100.,0.,1.);
        vec3 col = l<.5 ? mix(uC1,uC2,l*2.) : mix(uC2,uC3,l*2.-1.); return vec4(mix(c.rgb,col,clamp(uI,0.,1.)),c.a); }` },
    duotone: { name: 'Duotone', colors: ['fxc.duoA', 'fxc.duoB'], params: [P('contrast', 'Contrast', 0, 100, 30)], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); float l=clamp((luma(c.rgb)-.5)*(1.+uP.x/40.)+.5,0.,1.); return vec4(mix(c.rgb, mix(uC1,uC2,l), clamp(uI,0.,1.)), c.a); }` },
    posterize: { name: 'Posterize', params: [P('levels', 'Levels', 2, 16, 4)], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); float L=max(2.,uP.x); vec3 q=floor(c.rgb*L)/(L-1.); return vec4(mix(c.rgb,clamp(q,0.,1.),clamp(uI,0.,1.)),c.a); }` },
    threshold: { name: 'Threshold', colors: ['fxc.ink', 'fxc.paper'], params: [P('cut', 'Cut', 0, 100, 50, 1, '%'), P('soft', 'Softness', 0, 50, 4)], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); float l=luma(c.rgb); float s=max(.001,uP.y/100.); float m=smoothstep(uP.x/100.-s,uP.x/100.+s,l);
        return vec4(mix(c.rgb, mix(uC1,uC2,m), clamp(uI,0.,1.)), c.a); }` },
    edge: { name: 'Edge / neon', colors: ['fxc.edge'], params: [P('glow', 'Glow', 0, 100, 40), P('keep', 'Keep image', 0, 100, 20, 1, '%')], glsl: `
      vec4 fx(vec2 uv){ vec2 t=1./uRes; float tl=luma(S(uv+t*vec2(-1,1)).rgb), l=luma(S(uv+t*vec2(-1,0)).rgb), bl=luma(S(uv+t*vec2(-1,-1)).rgb), tt=luma(S(uv+t*vec2(0,1)).rgb),
        b=luma(S(uv+t*vec2(0,-1)).rgb), tr=luma(S(uv+t*vec2(1,1)).rgb), r=luma(S(uv+t*vec2(1,0)).rgb), br=luma(S(uv+t*vec2(1,-1)).rgb);
        float gx=-tl-2.*l-bl+tr+2.*r+br, gy=-tl-2.*tt-tr+bl+2.*b+br; float e=clamp(length(vec2(gx,gy))*(1.+uP.x/25.),0.,1.);
        vec4 c=S(uv); vec3 col=c.rgb*uP.y/100.+uC1*e; return vec4(mix(c.rgb,col,clamp(uI,0.,1.)), c.a); }` },
    bloom: { name: 'Bloom / glow', params: [P('thr', 'Threshold', 0, 100, 60, 1, '%'), P('radius', 'Radius', 1, 40, 14, 1, 'px')], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); vec3 acc=vec3(0.); for(int i=0;i<24;i++){ float a=float(i)*2.39996; float r=sqrt(float(i)+.5)/4.9*uP.y;
        vec3 s=S(uv+vec2(cos(a),sin(a))*r/uRes).rgb; acc+=s*smoothstep(uP.x/100.,uP.x/100.+.2,luma(s)); }
        return vec4(c.rgb+acc/24.*uI*2.5, c.a); }` },
    vhs: { name: 'VHS', params: [P('scan', 'Scanlines', 0, 100, 50), P('wobble', 'Tracking wobble', 0, 100, 40), P('noise', 'Noise', 0, 100, 40)], glsl: `
      vec4 fx(vec2 uv){ float t=uTime; vec2 u=uv; u.x+=(noise(vec2(uv.y*20.,t*2.))-.5)*uP.y*.0008*uI+sin(uv.y*3.+t*1.3)*uP.y*.0002*uI;
        float o=.002*uI; vec4 g=S(u); vec4 c=vec4(S(u+vec2(o,0.)).r, g.g, S(u-vec2(o,0.)).b, g.a);
        float sl=.5+.5*sin(uv.y*uRes.y*1.5708); c.rgb*=1.-uP.x/100.*.35*sl*uI; c.rgb+=(hash(uv*uRes+t*100.)-.5)*uP.z/100.*.35*uI;
        float band=step(.995-uP.z*.0002, hash(vec2(floor(uv.y*60.), floor(t*12.)))); c.rgb=mix(c.rgb, vec3(hash(uv+t)), band*uI*.6); return c; }` },
    crt: { name: 'CRT', params: [P('curve', 'Curvature', 0, 100, 40), P('mask', 'Shadow mask', 0, 100, 50), P('vig', 'Vignette', 0, 100, 50)], glsl: `
      vec4 fx(vec2 uv){ vec2 cc=uv*2.-1.; cc*=1.+uP.x/100.*.25*uI*dot(cc,cc); vec2 u=cc*.5+.5;
        if(any(lessThan(u,vec2(0.)))||any(greaterThan(u,vec2(1.)))) return vec4(0.,0.,0.,1.);
        vec4 c=S(u); float m=mod(floor(uv.x*uRes.x),3.); vec3 mk=m<1.?vec3(1.,.7,.7):m<2.?vec3(.7,1.,.7):vec3(.7,.7,1.);
        c.rgb*=mix(vec3(1.),mk,uP.y/100.*clamp(uI,0.,1.)); c.rgb*=clamp(1.-dot(cc,cc)*uP.z/100.*.6*uI,0.,1.); return c; }` },
    grain: { name: 'Film grain', params: [P('size', 'Grain size', 1, 4, 1, 0.5)], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); vec2 p=floor(uv*uRes/max(1.,uP.x)); float n=hash(p+fract(uTime*7.3)*91.)-.5; return vec4(c.rgb+n*uI*.45, c.a); }` },
    slitscan: { name: 'Slit-scan / time', history: true, params: [P('depth', 'Time depth', 0, 100, 70, 1, '%'), SEG('dir', 'Direction', [['0', 'ROWS'], ['1', 'COLUMNS']], '0')], glsl: `
      vec4 fx(vec2 uv){ float g=uP.y<0.5?uv.y:uv.x; float d=floor(g*uP.x/100.*(uHistN-1.)*clamp(uI,0.,1.)); float layer=mod(uHistHead-d+uHistN,uHistN); return texture(uHist, vec3(uv, layer)); }` },
    feedback: { name: 'Feedback trails', feedback: true, params: [P('trail', 'Trail length', 0, 98, 85, 1, '%'), P('zoom', 'Zoom', 0, 100, 20), P('rot', 'Rotate', 0, 100, 50)], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); vec2 cc=uv-.5; float z=1.-uP.y/100.*.03; float a=radians((uP.z-50.)/50.*2.);
        cc=mat2(cos(a),-sin(a),sin(a),cos(a))*cc*z; vec4 p=texture(uPrev, cc+.5); float dec=uP.x/100.*clamp(uI,0.,1.);
        return vec4(max(c.rgb, p.rgb*dec), max(c.a, p.a*dec)); }` },
    kaleido: { name: 'Kaleidoscope', params: [P('seg', 'Segments', 2, 16, 6), P('rot', 'Rotation', 0, 360, 0, 1, '°'), P('spin', 'Spin', 0, 100, 10)], glsl: `
      vec4 fx(vec2 uv){ float ar=uRes.x/uRes.y; vec2 cc=(uv-.5)*vec2(ar,1.); float r=length(cc); float a=atan(cc.y,cc.x)+radians(uP.y)+uTime*uP.z*.02;
        float sg=6.28318/max(2.,floor(uP.x)); a=mod(a,sg); a=abs(a-sg*.5); vec2 p=vec2(cos(a),sin(a))*r; p.x/=ar; return mix(S(uv),S(p+.5),clamp(uI,0.,1.)); }` },
    mirror: { name: 'Mirror', params: [SEG('mode', 'Mode', [['0', 'LEFT ↔ RIGHT'], ['1', 'TOP ↕ BOTTOM'], ['2', 'QUAD']], '0')], glsl: `
      vec4 fx(vec2 uv){ vec2 u=uv; if(uP.x<0.5||uP.x>1.5) u.x=u.x>.5?1.-u.x:u.x; if(uP.x>0.5) u.y=u.y>.5?1.-u.y:u.y; return mix(S(uv),S(u),clamp(uI,0.,1.)); }` },
    warp: { name: 'Liquid warp', params: [P('scale', 'Scale', 1, 100, 30), P('speed', 'Speed', 0, 100, 30)], glsl: `
      vec4 fx(vec2 uv){ float s=uP.x/10.+.5; float t=uTime*uP.y*.02; vec2 n=vec2(noise(uv*s*4.+t), noise(uv*s*4.+vec2(5.2,1.3)-t))-.5; return S(uv+n*.08*uI); }` },
    pixelate: { name: 'Pixelate', params: [P('size', 'Block size', 2, 80, 16, 1, 'px')], glsl: `
      vec4 fx(vec2 uv){ float s=max(1.,uP.x*clamp(uI,.05,2.)); return S((floor(uv*uRes/s)+.5)*s/uRes); }` },
    led: { name: 'LED matrix', colors: ['fxc.led'], params: [P('cell', 'Cell size', 3, 30, 8, 1, 'px'), P('gap', 'Gap', 0, 80, 30, 1, '%'), SEG('mode', 'Colour', [['0', 'SOURCE'], ['1', 'MONO']], '0')], glsl: `
      vec4 fx(vec2 uv){ float cs=max(2.,uP.x); vec2 px=uv*uRes; vec2 cell=floor(px/cs); vec4 c=S((cell*cs+cs*.5)/uRes); vec2 f=fract(px/cs)-.5;
        float r=.5-uP.y/100.*.45; float m=1.-smoothstep(r-.08,r,length(f)); vec3 col=uP.z<0.5?c.rgb:uC1*luma(c.rgb); vec4 o0=S(uv);
        return vec4(mix(o0.rgb, col*m*1.25, clamp(uI,0.,1.)), o0.a); }` },
    infrared: { name: 'Infrared / X-ray', colors: ['fxc.tint'], params: [SEG('mode', 'Mode', [['0', 'INFRARED'], ['1', 'X-RAY']], '0'), P('contrast', 'Contrast', 0, 100, 40)], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); float l=luma(c.rgb); vec3 col;
        if(uP.x<0.5){ float h=clamp(c.g*1.2-c.b*.3+c.r*.3,0.,1.); h=clamp((h-.5)*(1.+uP.y/50.)+.5,0.,1.); col=mix(vec3(0.),uC1,h); col=mix(col,vec3(1.,.95,.9),smoothstep(.7,1.,h)); }
        else { float x=pow(1.-l,1.+uP.y/50.); col=mix(vec3(.02,.03,.05), uC1*.4+vec3(.6,.8,1.)*.6, x); }
        return vec4(mix(c.rgb,col,clamp(uI,0.,1.)),c.a); }` },
    chroma: { name: 'Chromatic aberration', params: [P('amount', 'Strength', 0, 100, 45), P('fall', 'Edge falloff', 0, 100, 40)], glsl: `
      vec4 fx(vec2 uv){ vec2 c=uv-.5; float d=pow(length(c)*1.41, 1.+uP.y/40.); vec2 o=c*d*uP.x*.0016*uI; vec4 g=S(uv); vec4 r=S(uv+o), b=S(uv-o);
        return vec4(r.r, g.g, b.b, max(g.a,max(r.a,b.a))); }` },
    zoomblur: { name: 'Zoom blur', band: 'bass', params: [P('amount', 'Amount', 0, 100, 40), P('cx', 'Centre X', 0, 100, 50, 1, '%'), P('cy', 'Centre Y', 0, 100, 50, 1, '%')], glsl: `
      vec4 fx(vec2 uv){ vec2 c=vec2(uP.y/100., uP.z/100.); vec2 d=(uv-c)*uP.x*.0045*uI; vec4 acc=vec4(0.);
        for(int i=0;i<16;i++){ acc+=S(uv-d*float(i)); } return acc/16.; }` },
    tunnel: { name: 'Tunnel / infinite zoom', params: [P('speed', 'Speed', 0, 100, 35), P('depth', 'Depth', 0, 100, 40), P('twist', 'Twist', 0, 100, 20)], glsl: `
      vec4 fx(vec2 uv){ float ar=uRes.x/uRes.y; vec2 p=(uv-.5)*vec2(ar,1.); float r=max(length(p),.0005); float a=atan(p.y,p.x)+r*uP.z*.08+uTime*uP.z*.01;
        float z=exp(fract(log(r)*(.4+uP.y/80.)-uTime*uP.x*.012)/(.4+uP.y/80.)); vec2 q=vec2(cos(a),sin(a))*z*.42; q.x/=ar;
        vec4 t=S(q+.5); return mix(S(uv), t, clamp(uI,0.,1.)); }` },
    invert: { name: 'Invert flash', band: 'bass', amt: 80, params: [P('base', 'Always-on amount', 0, 100, 0, 1, '%'), SEG('hard', 'Flash', [['1', 'HARD CUT'], ['0', 'SOFT']], '1')], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); float k=clamp(uP.x/100.+uA*1.6,0.,1.); if(uP.y>.5) k=step(.5,k); return vec4(mix(c.rgb,1.-c.rgb,k*clamp(uI,0.,1.)),c.a); }` },
    vignette: { name: 'Vignette', params: [P('amount', 'Amount', 0, 100, 55), P('soft', 'Softness', 0, 100, 50), P('round', 'Roundness', 0, 100, 70)], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); vec2 p=uv-.5; p.x*=mix(uRes.x/uRes.y,1.,uP.z/100.); float d=length(p)*1.5; float v=1.-smoothstep(1.-uP.y/100.*.9-.05, 1.05, d)*uP.x/100.*clamp(uI,0.,1.5);
        return vec4(c.rgb*v, c.a); }` },
    grade: { name: 'Colour grade (LUT)', params: [SEG('look', 'Look', [['0', 'TEAL/ORANGE'], ['1', 'BLEACH'], ['2', 'CROSS'], ['3', 'NOIR'], ['4', 'NEON'], ['5', 'SEPIA'], ['6', 'ICE']], '0'), P('contrast', 'Contrast', 0, 100, 30)], glsl: `
      vec3 grade(vec3 c, float m){ float l=luma(c);
        if(m<.5){ vec3 sh=vec3(0.,.42,.52), hi=vec3(1.,.62,.28); return mix(c, mix(sh,hi,smoothstep(.15,.85,l))*(.25+l*1.1), .65); }
        if(m<1.5) return mix(c, vec3(l), .55)*vec3(1.05,1.02,1.)+l*l*.15;
        if(m<2.5) return vec3(smoothstep(.05,.95,c.r), c.g*1.1-.03, c.b*.72+.12);
        if(m<3.5){ float k=smoothstep(.08,.92,l); return vec3(k); }
        if(m<4.5) return vec3(c.r*1.15+c.b*.35, c.g*.7, c.b*1.3+c.r*.25);
        if(m<5.5) return vec3(l*1.07, l*.86, l*.62)+.04;
        return vec3(l*.72, l*.95, l*1.18); }
      vec4 fx(vec2 uv){ vec4 c=S(uv); vec3 g=clamp(grade(c.rgb,uP.x),0.,1.); g=clamp((g-.5)*(1.+uP.y/60.)+.5,0.,1.); return vec4(mix(c.rgb,g,clamp(uI,0.,1.)),c.a); }` },
    shake: { name: 'Screen shake / punch', band: 'bass', amt: 70, params: [P('amount', 'Shake', 0, 100, 50), P('punch', 'Zoom punch', 0, 100, 40), P('base', 'Constant shake', 0, 100, 0, 1, '%')], glsl: `
      vec4 fx(vec2 uv){ float s=(uP.z/100.*.5+uA*1.8)*clamp(uI,0.,2.); float t=floor(uTime*30.); vec2 off=(vec2(hash(vec2(t,1.7)),hash(vec2(t,9.2)))-.5)*uP.x*.0016*s;
        float z=1.-uP.y*.0016*s; return S((uv-.5)*z+.5+off); }` },
    solarize: { name: 'Solarize', params: [P('thr', 'Threshold', 0, 100, 55, 1, '%')], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); vec3 s=mix(c.rgb, 1.-c.rgb, step(vec3(uP.x/100.), c.rgb)); return vec4(mix(c.rgb,s,clamp(uI,0.,1.)),c.a); }` },
    datamosh: { name: 'Datamosh smear', feedback: true, params: [P('block', 'Block size', 4, 64, 16, 1, 'px'), P('speed', 'Change rate', 0, 100, 40), P('hold', 'Smear', 0, 98, 85, 1, '%')], glsl: `
      vec4 fx(vec2 uv){ vec4 c=S(uv); vec2 b=floor(uv*uRes/max(4.,uP.x)); float t=floor(uTime*(2.+uP.y*.25)); float m=step(1.-clamp(uI,0.,1.)*.7, hash(b+t));
        vec2 drift=(vec2(hash(b*1.3+t),hash(b*2.1+t))-.5)*.008*uI; vec4 p=texture(uPrev, uv+drift); return mix(c, p, m*uP.z/100.); }` },
    tile: { name: 'Mirror tiles', params: [P('tiles', 'Tiles', 1, 8, 2), SEG('mirror', 'Mode', [['1', 'MIRRORED'], ['0', 'REPEAT']], '1')], glsl: `
      vec4 fx(vec2 uv){ float n=max(1.,floor(uP.x)); vec2 u=uv*n; vec2 f=fract(u); if(uP.y>.5){ vec2 i=floor(u); f=mix(f,1.-f,mod(i,2.)); } return mix(S(uv), S(f), clamp(uI,0.,1.)); }` },
    hexmosaic: { name: 'Hex mosaic', params: [P('size', 'Cell size', 3, 60, 14, 1, 'px')], glsl: `
      vec4 fx(vec2 uv){ float s=max(3.,uP.x*clamp(uI,.1,2.)); vec2 p=uv*uRes/s; vec2 r=vec2(1.,1.7320508), h=r*.5; vec2 a=mod(p,r)-h, b=mod(p-h,r)-h; vec2 g=dot(a,a)<dot(b,b)?a:b;
        return S((p-g)*s/uRes); }` },
    hue: { name: 'Hue cycle / prism', params: [P('speed', 'Cycle speed', 0, 100, 30), P('audio', 'Audio jump', 0, 100, 50), P('spread', 'Prism spread', 0, 100, 0)], glsl: `
      vec3 hueRot(vec3 c,float a){ const vec3 k=vec3(.57735); float ca=cos(a); return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.-ca); }
      vec4 fx(vec2 uv){ vec4 c=S(uv); float a=uTime*uP.x*.05+uA*uP.y*.08+luma(c.rgb)*uP.z*.08; return vec4(mix(c.rgb, hueRot(c.rgb,a), clamp(uI,0.,1.)), c.a); }` },
  };

  XO.FILTER_ORDER = Object.keys(XO.FILTERS);

  let uid = 1;
  XO.makeFilter = function (type, over) {
    const def = XO.FILTERS[type], params = {};
    def.params.forEach((p) => { params[p.k] = p.seg ? p.def : p.def; });
    const f = { id: 'f' + Date.now().toString(36) + (uid++), type, on: true, solo: false, intensity: 100, band: def.band || 'off', amt: def.amt || 50, params };
    if (over) { Object.assign(f, over, { params: Object.assign(params, over.params || {}) }); }
    return f;
  };

  const F = (type, o) => ({ type, ...(o || {}) });
  XO.FX_PRESETS = {
    'RAGE LOOP': [F('glitch', { intensity: 60, band: 'bass', amt: 60 }), F('rgbsplit', { band: 'bass', amt: 70, params: { amount: 45 } }), F('grain', { intensity: 35 })],
    'VOID SIGNAL': [F('threshold', { params: { cut: 45 } }), F('vhs', { params: { scan: 60, wobble: 30, noise: 40 }, band: 'high', amt: 40 })],
    'SYSTEM FAULT': [F('pixelsort', { params: { length: 40, thr: 55 }, band: 'mid', amt: 60 }), F('glitch', { intensity: 50, band: 'bass', amt: 50 }), F('rgbsplit', { params: { amount: 30 } })],
    HEATWAVE: [F('thermal'), F('bloom', { params: { thr: 50, radius: 16 } }), F('warp', { intensity: 30 })],
    BINARY: [F('dither', { params: { scale: 2 } }), F('grain', { intensity: 20 })],
    ACID: [F('duotone'), F('edge', { params: { glow: 50, keep: 30 }, band: 'bass', amt: 50 })],
    INFRARED: [F('infrared'), F('bloom', { intensity: 70 })],
    TERMINAL: [F('ascii', { params: { cell: 10, mode: '0' } }), F('crt')],
    'NEON EDGE': [F('edge', { params: { keep: 0, glow: 60 } }), F('bloom', { params: { thr: 30 } })],
    TUNNEL: [F('kaleido', { params: { seg: 8, spin: 20 } }), F('feedback', { params: { trail: 88, zoom: 40 } })],
    HYPERDRIVE: [F('tunnel', { params: { speed: 45, depth: 40, twist: 25 } }), F('zoomblur', { band: 'bass', amt: 60, params: { amount: 30 } }), F('chroma', { params: { amount: 50 } })],
    DATAMOSH: [F('datamosh', { params: { block: 16, speed: 45, hold: 88 } }), F('rgbsplit', { band: 'bass', amt: 50, params: { amount: 25 } })],
    'NOIR FILM': [F('grade', { params: { look: '3', contrast: 45 } }), F('grain', { intensity: 40 }), F('vignette', { params: { amount: 65 } })],
    'BASS PUNCH': [F('shake', { band: 'bass', amt: 80 }), F('invert', { band: 'bass', amt: 70 }), F('chroma', { band: 'bass', amt: 60, params: { amount: 30 } })],
    'CHROME DREAM': [F('grade', { params: { look: '4', contrast: 25 } }), F('bloom', { params: { thr: 45, radius: 18 } }), F('chroma', { params: { amount: 35 } }), F('vignette', { params: { amount: 40 } })],
    PRISM: [F('hue', { band: 'mid', amt: 60, params: { speed: 20, audio: 60, spread: 40 } }), F('tile', { params: { tiles: 2 } }), F('bloom', { intensity: 60 })],
  };
})();
