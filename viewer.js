const STNS={"london st pancras int'l":[51.5322,-0.1233],"paris gare du nord":[48.8809,2.3553],"paris montparnasse 1 et 2":[48.8404,2.3208],"bayonne":[43.4929,-1.4749],"lourdes":[43.0957,-0.0514]};

let HD=null,HM=null,HMapReady=false,hGanttCompact=false;

function hfmtD(iso){return new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});}
function hfmtDs(iso){return new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'long'});}
function hfmtMin(m){const h=Math.floor(m/60),mn=m%60;return mn?`${h}h ${mn}m`:`${h}h`;}
function hsegDate(s){return s.type==='accommodation'?s.checkin.date:s.date;}
function hsegTime(s){return s.type==='transport'?s.departs.time:s.type==='accommodation'?'23:59':(s.time||'12:00');}

function hci(s){
  const c=s.cost;if(!c)return null;
  if(c.included_in)return{t:'inc'};
  if(c.status==='not_booked')return{t:'nb'};
  const cur=c.currency||HD.trip.currency_primary,sym=cur==='EUR'?'€':'£';
  if(c.payments){
    const tot=c.total||c.payments.reduce((a,p)=>a+p.amount,0);
    const pd=c.payments.filter(p=>p.status==='paid').reduce((a,p)=>a+p.amount,0);
    const pn=c.payments.filter(p=>p.status==='pending').reduce((a,p)=>a+p.amount,0);
    return{t:'amt',tot,sym,cur,st:pn>0?(pd>0?'partial':'pending'):'paid'};
  }
  return{t:'amt',tot:c.amount||c.total||0,sym,cur,st:c.status,due:c.due};
}

function hbadge(st,txt){return `<span class="hbadge ${st}">${txt||st}</span>`;}

function hcb(ci){
  if(!ci)return'';
  if(ci.t==='inc')return hbadge('included','Included');
  if(ci.t==='nb')return hbadge('not_booked','Not booked');
  return hbadge(ci.st,{paid:'Paid',pending:'Due',partial:'Part paid',free:'Free'}[ci.st]||ci.st);
}

function hpb(s){
  if(!s.proposal)return'';
  const lbl={draft:'Draft',suggested:'Suggested',considering:'Considering',confirmed:'Confirmed',rejected:'Rejected'};
  return hbadge(s.proposal.status,lbl[s.proposal.status]);
}

function hsicon(s){
  if(s.type==='transport')return{train:'ti-train',bus:'ti-bus',ferry:'ti-sailboat',flight:'ti-plane'}[s.mode]||'ti-route';
  if(s.type==='accommodation')return 'ti-home';
  return{festival:'ti-music',gig:'ti-microphone-2',walk:'ti-walk',tour:'ti-flag-2',activity:'ti-activity',other:'ti-calendar-event'}[s.subtype]||'ti-calendar-event';
}

function hrenderTransport(s){
  const seatsLine=s.seats&&s.seats.length?`<div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${s.seats.map(x=>`${x.traveller.split(' ')[0]}: Coach ${x.coach}${x.deck?' ('+x.deck+')':''}, Seat ${x.seat}`).join(' · ')}</div>`:'';
  return `<div style="margin-top:8px;font-size:13px">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="font-weight:500">${s.departs.time}</span>
      <span style="color:var(--color-text-secondary)">${s.departs.station}</span>
      <i class="ti ti-arrow-right" style="color:var(--color-text-secondary);font-size:12px" aria-hidden="true"></i>
      <span style="color:var(--color-text-secondary)">${s.arrives.station}</span>
      <span style="font-weight:500">${s.arrives.time}</span>
      <span style="color:var(--color-text-secondary);font-size:12px">${hfmtMin(s.duration_min)}</span>
    </div>
    <div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px">${s.operator}${s.service?' · '+s.service:''} · ${s.class} · Ref: <code>${s.ref}</code></div>
    ${seatsLine}
  </div>`;
}

function hrenderAccom(s){
  return `<div style="margin-top:8px;font-size:12px;color:var(--color-text-secondary);display:flex;flex-wrap:wrap;gap:8px">
    <span><i class="ti ti-door-enter" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> In after ${s.checkin.from} · ${hfmtDs(s.checkin.date)}</span>
    <span><i class="ti ti-door-exit" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> Out by ${s.checkout.by} · ${hfmtDs(s.checkout.date)}</span>
    <span>${s.nights} night${s.nights!==1?'s':''} · Host: ${s.host}</span>
    ${s.self_checkin?'<span><i class="ti ti-key" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> Self check-in</span>':''}
    ${s.phone?`<span><i class="ti ti-phone" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${s.phone}</span>`:''}
    <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;width:100%">Ref: <code>${s.ref}</code></div>
  </div>`;
}

function hrenderEvent(s){
  let pr='';
  if(s.pricing){pr=Object.entries(s.pricing).map(([k,v])=>{const l=k.replace(/_/g,' ');const val=v.amount!==undefined?`€${v.amount}`:(v.from!==undefined?`€${v.from}–€${v.to}`:'');return `${l}: ${val}`;}).join(' · ');}
  return `<div style="margin-top:8px;font-size:12px;color:var(--color-text-secondary);display:flex;flex-wrap:wrap;gap:8px">
    ${s.venue?`<span><i class="ti ti-map-pin" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${s.venue}</span>`:''}
    ${s.time?`<span><i class="ti ti-clock" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${s.time}</span>`:''}
    ${pr?`<span>${pr}</span>`:''}
    ${s.url?`<span><a href="${s.url}" style="color:var(--color-text-info)">Website <i class="ti ti-external-link" style="font-size:11px" aria-hidden="true"></i></a></span>`:''}
    ${s.tickets_url?`<span><a href="${s.tickets_url}" style="color:var(--color-text-info)">Tickets <i class="ti ti-external-link" style="font-size:11px" aria-hidden="true"></i></a></span>`:''}
  </div>`;
}

function hrenderNotes(s){
  if(!s.notes)return'';
  const parts=s.notes.split('***').map(p=>p.trim()).filter(Boolean);
  if(parts.length<=1)return`<div style="margin-top:6px;font-size:11px;color:var(--color-text-tertiary)">${s.notes}</div>`;
  return parts.map((p,i)=>i%2===1
    ?`<div style="margin-top:6px;background:var(--color-background-warning);color:var(--color-text-warning);border-radius:var(--border-radius-md);padding:5px 8px;font-size:12px"><i class="ti ti-alert-triangle" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${p}</div>`
    :`<div style="margin-top:6px;font-size:11px;color:var(--color-text-tertiary)">${p}</div>`
  ).join('');
}

function hrenderList(){
  const sorted=[...HD.segments].sort((a,b)=>(hsegDate(a).localeCompare(hsegDate(b)))||hsegTime(a).localeCompare(hsegTime(b)));
  const grp={};
  sorted.forEach(s=>{const d=hsegDate(s);(grp[d]=grp[d]||[]).push(s);});
  document.getElementById('hvlist').innerHTML=Object.entries(grp).map(([date,segs])=>`
    <div style="margin-bottom:1.75rem">
      <div style="font-size:11px;font-weight:500;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.625rem;display:flex;align-items:center;gap:8px">
        ${hfmtDs(date)}<span style="flex:1;height:.5px;background:var(--color-border-tertiary);display:block"></span>
      </div>
      ${segs.map(s=>{
        const ci=hci(s),ic=hsicon(s);
        const title=s.name||s.operator||'Segment';
        const sub=s.type==='transport'?`${s.departs.station} → ${s.arrives.station}`:s.type==='accommodation'?s.address:(s.subtype?s.subtype.charAt(0).toUpperCase()+s.subtype.slice(1):'');
        const costStr=ci&&ci.t==='amt'?`${ci.sym}${ci.tot.toFixed(2)}`:'';
        const detail=s.type==='transport'?hrenderTransport(s):s.type==='accommodation'?hrenderAccom(s):hrenderEvent(s);
        return `<div class="hseg">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
            <div style="display:flex;gap:10px;align-items:flex-start;flex:1;min-width:0">
              <i class="ti ${ic}" style="font-size:17px;color:var(--color-text-secondary);flex-shrink:0;margin-top:2px" aria-hidden="true"></i>
              <div><div style="font-size:14px;font-weight:500">${title}</div><div style="font-size:12px;color:var(--color-text-secondary);margin-top:2px">${sub}</div></div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
              <button class="hedit-btn" onclick="hOpenEdit(${HD.segments.indexOf(s)})" style="font-size:11px;padding:1px 5px;line-height:1.5;color:var(--color-text-secondary)" title="Edit segment"><i class="ti ti-pencil" aria-hidden="true"></i></button>
              ${costStr?`<span style="font-size:13px;font-weight:500">${costStr}</span>`:''}
              ${hcb(ci)}${hpb(s)}
            </div>
          </div>
          ${detail}${hrenderNotes(s)}
        </div>`;
      }).join('')}
    </div>`).join('');
}

function hrenderBudget(){
  let pgbp=0,peur=0,pngbp=0,pneur=0;
  const upco=[],nb=[],rows=[];
  for(const s of HD.segments){
    const c=s.cost;if(!c||c.included_in)continue;
    const cur=c.currency||HD.trip.currency_primary,sym=cur==='EUR'?'€':'£',gbp=cur==='GBP';
    if(c.status==='not_booked'){nb.push(s);rows.push({s,st:'not_booked',amt:null,sym});continue;}
    if(c.status==='free'){rows.push({s,st:'free',amt:0,sym});continue;}
    if(c.payments){
      const tot=c.total||c.payments.reduce((a,p)=>a+p.amount,0);
      for(const p of c.payments){
        if(p.status==='paid'){gbp?pgbp+=p.amount:peur+=p.amount;}
        else{gbp?pngbp+=p.amount:pneur+=p.amount;upco.push({n:s.name||s.operator,amt:p.amount,sym,due:p.due});}
      }
      const pd=c.payments.filter(p=>p.status==='paid').reduce((a,p)=>a+p.amount,0);
      const pn=c.payments.filter(p=>p.status==='pending').reduce((a,p)=>a+p.amount,0);
      rows.push({s,st:pn>0?(pd>0?'partial':'pending'):'paid',amt:tot,sym});
    } else {
      const amt=c.amount||c.total||0;
      if(c.status==='paid'){gbp?pgbp+=amt:peur+=amt;}
      else if(c.status==='pending'){gbp?pngbp+=amt:pneur+=amt;upco.push({n:s.name||s.operator,amt,sym,due:c.due});}
      rows.push({s,st:c.status,amt,sym});
    }
  }
  upco.sort((a,b)=>new Date(a.due||'9999')-new Date(b.due||'9999'));
  const f=n=>n.toFixed(2),lbl={paid:'Paid',pending:'Due',partial:'Part paid',not_booked:'Not booked',free:'Free'};
  document.getElementById('hvbudget').innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:1.5rem">
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Paid</div>
        <div style="font-size:21px;font-weight:500;color:var(--color-text-success)">£${f(pgbp)}</div>
        ${peur>0?`<div style="font-size:11px;color:var(--color-text-secondary)">+ €${f(peur)}</div>`:''}
      </div>
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Pending</div>
        <div style="font-size:21px;font-weight:500;color:var(--color-text-warning)">£${f(pngbp)}</div>
        ${pneur>0?`<div style="font-size:11px;color:var(--color-text-secondary)">+ €${f(pneur)}</div>`:''}
      </div>
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Not booked</div>
        <div style="font-size:21px;font-weight:500;color:var(--color-text-secondary)">${nb.length} item${nb.length!==1?'s':''}</div>
      </div>
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Total confirmed</div>
        <div style="font-size:21px;font-weight:500">£${f(pgbp+pngbp)}</div>
        ${(peur+pneur)>0?`<div style="font-size:11px;color:var(--color-text-secondary)">+ €${f(peur+pneur)}</div>`:''}
      </div>
    </div>
    ${upco.length?`<div style="font-size:13px;font-weight:500;margin-bottom:.5rem">Upcoming payments</div>
    <div style="background:var(--color-background-primary);border:.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);padding:0 1rem;margin-bottom:1.5rem">
      ${upco.map(p=>`<div class="hrow"><span>${p.n}</span><div style="display:flex;gap:10px;align-items:center">${p.due?`<span style="font-size:12px;color:var(--color-text-secondary)">${hfmtD(p.due)}</span>`:''}<span style="font-weight:500;color:var(--color-text-warning)">${p.sym}${p.amt.toFixed(2)}</span></div></div>`).join('')}
    </div>`:''}
    <div style="font-size:13px;font-weight:500;margin-bottom:.5rem">All segments</div>
    <div style="background:var(--color-background-primary);border:.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);padding:0 1rem">
      ${rows.map(r=>`<div class="hrow">
        <div><div style="font-weight:500">${r.s.name||r.s.operator||'Segment'}</div>
        <div style="font-size:11px;color:var(--color-text-secondary)">${r.s.type}${r.s.mode?' · '+r.s.mode:''}${r.s.subtype?' · '+r.s.subtype:''}</div></div>
        <div style="display:flex;gap:8px;align-items:center">
          ${hbadge(r.st,lbl[r.st]||r.st)}
          <span style="font-weight:500;min-width:60px;text-align:right">${r.amt!==null?r.sym+r.amt.toFixed(2):'—'}</span>
        </div>
      </div>`).join('')}
    </div>`;
}

function hrenderMap(){
  if(!window.L||!HD)return;
  if(HM){HM.remove();HM=null;}
  HM=L.map('hmap');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:18}).addTo(HM);
  const mpin=(col,lbl)=>L.divIcon({html:`<div style="background:${col};width:22px;height:22px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:white;font-family:sans-serif">${lbl}</div>`,className:'',iconAnchor:[11,11],popupAnchor:[0,-13]});
  const allc=[],route=[],seen=new Set();
  const sorted=[...HD.segments].sort((a,b)=>(hsegDate(a).localeCompare(hsegDate(b)))||hsegTime(a).localeCompare(hsegTime(b)));
  for(const s of sorted){
    if(s.type==='transport'){
      const dk=s.departs.station.toLowerCase(),ak=s.arrives.station.toLowerCase();
      const dc=STNS[dk],ac=STNS[ak];
      if(dc){route.push(dc);if(!seen.has(dk)){seen.add(dk);allc.push(dc);L.marker(dc,{icon:mpin('#4b5563','T')}).addTo(HM).bindPopup(`<strong>${s.departs.station}</strong><br>${s.operator}${s.service?' · '+s.service:''}<br>Departs ${s.departs.time}`);}}
      if(ac){route.push(ac);if(!seen.has(ak)){seen.add(ak);allc.push(ac);L.marker(ac,{icon:mpin('#4b5563','T')}).addTo(HM).bindPopup(`<strong>${s.arrives.station}</strong>`);}}
    } else if(s.type==='accommodation'){
      const c=[s.lat,s.lng];route.push(c);allc.push(c);
      L.marker(c,{icon:mpin('#b45309','H')}).addTo(HM).bindPopup(`<strong>${s.name}</strong><br>${s.host}<br>${s.address}<br>Check-in: ${hfmtD(s.checkin.date)}`);
    } else if(s.type==='event'&&s.lat){
      const c=[s.lat,s.lng];allc.push(c);
      L.marker(c,{icon:mpin('#15803d','E')}).addTo(HM).bindPopup(`<strong>${s.name}</strong><br>${s.venue||''}<br>${hfmtD(s.date)}`);
    }
  }
  if(route.length>1)L.polyline(route,{color:'#6366f1',weight:2,opacity:0.55,dashArray:'6 8'}).addTo(HM);
  if(allc.length>0)HM.fitBounds(L.latLngBounds(allc).pad(0.18));
  document.getElementById('hmaplist').innerHTML=HD.segments.filter(s=>s.lat).map(s=>`
    <div onclick="if(window.HM)HM.setView([${s.lat},${s.type==='accommodation'?s.lng:s.lng}],13)" style="background:var(--color-background-primary);border:.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:.55rem .75rem;cursor:pointer;font-size:12px" onmouseover="this.style.background='var(--color-background-secondary)'" onmouseout="this.style.background='var(--color-background-primary)'">
      <div style="font-weight:500;margin-bottom:2px">${s.name||s.venue}</div>
      <div style="color:var(--color-text-secondary)">${hfmtD(hsegDate(s))}</div>
    </div>`).join('');
}

function hrenderGantt(){
  if(!HD)return;
  const PX_PER_MIN=0.25;
  const tripStartMs=new Date(HD.trip.start+'T00:00:00').getTime();
  const tripEndMs=new Date(HD.trip.end+'T23:59:59').getTime();
  const totalMins=(tripEndMs-tripStartMs)/60000;
  const tripStartDate=new Date(HD.trip.start+'T00:00:00');
  const tripEndDate=new Date(HD.trip.end+'T00:00:00');
  const numDays=Math.round((tripEndDate-tripStartDate)/86400000)+1;
  // msToIso: convert a ms timestamp to {date,time} strings for toPx
  function msToIso(ms){const d=new Date(ms);const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const time=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;return{date,time};}
  let totalPx,toPx;
  if(hGanttCompact){
    const pts=new Set([tripStartMs,tripEndMs]);
    for(let d=0;d<numDays;d++)pts.add(tripStartDate.getTime()+d*86400000);
    for(const s of HD.segments){
      if(s.type==='accommodation'){
        pts.add(new Date(s.checkin.date+'T'+(s.checkin.from||'14:00')+':00').getTime());
        pts.add(new Date(s.checkout.date+'T'+(s.checkout.by||'11:00')+':00').getTime());
      } else if(s.type==='transport'){
        const dep=new Date(s.date+'T'+s.departs.time+':00').getTime();
        pts.add(dep);pts.add(dep+s.duration_min*60000);
      } else if(s.type==='event'){
        const ev=new Date(s.date+'T'+(s.time||'10:00')+':00').getTime();
        pts.add(ev);pts.add(ev+(s.duration_min||120)*60000);
      }
    }
    const sorted=Array.from(pts).sort((a,b)=>a-b);
    const SLOT=36;
    const cmap=new Map(sorted.map((t,i)=>[t,i*SLOT]));
    totalPx=(sorted.length-1)*SLOT;
    toPx=(dateStr,timeStr)=>{
      const ms=new Date(dateStr+'T'+(timeStr||'00:00')+':00').getTime();
      if(cmap.has(ms))return cmap.get(ms);
      for(let i=0;i<sorted.length-1;i++){
        if(sorted[i]<=ms&&ms<=sorted[i+1])
          return i*SLOT+(ms-sorted[i])/(sorted[i+1]-sorted[i])*SLOT;
      }
      return(sorted.length-1)*SLOT;
    };
  } else {
    totalPx=totalMins*PX_PER_MIN;
    toPx=(dateStr,timeStr)=>(new Date(dateStr+'T'+(timeStr||'00:00')+':00').getTime()-tripStartMs)/60000*PX_PER_MIN;
  }
  const TRANSPORT_COLOR={train:'#f59e0b',bus:'#10b981',ferry:'#06b6d4',flight:'#8b5cf6'};
  const EVENT_COLOR={festival:'#ec4899',gig:'#f97316',walk:'#22c55e',tour:'#6366f1',activity:'#14b8a6',other:'#64748b'};
  const ACCOM_COLOR='#3b82f6';
  const accomBlocks=[],travelBlocks=[],eventBlocks=[];
  for(const s of HD.segments){
    if(s.type==='accommodation'){
      const top=toPx(s.checkin.date,s.checkin.from||'14:00');
      const bot=toPx(s.checkout.date,s.checkout.by||'11:00');
      accomBlocks.push({top,h:Math.max(bot-top,28),color:ACCOM_COLOR,label:s.name,sub:`${s.checkin.from||'?'} → ${s.checkout.by||'?'}`});
    } else if(s.type==='transport'){
      const depMs=new Date(s.date+'T'+s.departs.time+':00').getTime();
      const arr=msToIso(depMs+s.duration_min*60000);
      const top=toPx(s.date,s.departs.time);
      const bot=toPx(arr.date,arr.time);
      travelBlocks.push({top,h:Math.max(bot-top,28),color:TRANSPORT_COLOR[s.mode]||'#64748b',
        label:s.operator+(s.service?' · '+s.service:''),
        times:`${s.departs.time} → ${arr.time} (${hfmtMin(s.duration_min)})`,
        sub:`${s.departs.station} → ${s.arrives.station}`});
    } else if(s.type==='event'){
      const evMs=new Date(s.date+'T'+(s.time||'10:00')+':00').getTime();
      const end=msToIso(evMs+(s.duration_min||120)*60000);
      const top=toPx(s.date,s.time||'10:00');
      const bot=toPx(end.date,end.time);
      eventBlocks.push({top,h:Math.max(bot-top,28),color:EVENT_COLOR[s.subtype]||EVENT_COLOR.other,label:s.name,times:`${s.time||'10:00'} → ${end.time} (${hfmtMin(s.duration_min||120)})`,sub:s.subtype||'event'});
    }
  }
  const coveredIntervals=HD.segments.filter(s=>s.type==='accommodation').map(s=>({
    startMs:new Date(s.checkin.date+'T'+(s.checkin.from||'14:00')+':00').getTime(),
    endMs:new Date(s.checkout.date+'T'+(s.checkout.by||'11:00')+':00').getTime()
  })).sort((a,b)=>a.startMs-b.startMs);
  const gapBlocks=[];let cursorMs=tripStartMs;
  for(const iv of coveredIntervals){
    if(cursorMs<iv.startMs){const a=msToIso(cursorMs),b=msToIso(iv.startMs);gapBlocks.push({top:toPx(a.date,a.time),bot:toPx(b.date,b.time)});}
    cursorMs=Math.max(cursorMs,iv.endMs);
  }
  if(cursorMs<tripEndMs){const a=msToIso(cursorMs),b=msToIso(tripEndMs);gapBlocks.push({top:toPx(a.date,a.time),bot:toPx(b.date,b.time)});}
  let axisHtml='',bodyLines='';
  for(let d=0;d<numDays;d++){
    const dayDate=new Date(tripStartDate.getTime()+d*86400000);
    const dayIso=`${dayDate.getFullYear()}-${String(dayDate.getMonth()+1).padStart(2,'0')}-${String(dayDate.getDate()).padStart(2,'0')}`;
    const dayPx=toPx(dayIso,'00:00');
    const dayLabel=dayDate.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
    bodyLines+=`<div class="hgt-day" style="top:${dayPx.toFixed(1)}px"></div>`;
    axisHtml+=`<div class="hgt-day-lbl" style="top:${(dayPx+2).toFixed(1)}px">${dayLabel}</div>`;
    if(!hGanttCompact){
      for(const hr of[6,12,18]){
        const tickPx=d*1440*PX_PER_MIN+hr*60*PX_PER_MIN;
        bodyLines+=`<div class="hgt-tick" style="top:${tickPx}px"></div>`;
        axisHtml+=`<div class="hgt-tick-lbl" style="top:${tickPx+2}px">${String(hr).padStart(2,'0')}:00</div>`;
      }
    }
  }
  function blkHtml(blocks){
    return blocks.map(b=>`<div class="hgt-blk" style="top:${b.top.toFixed(1)}px;height:${b.h.toFixed(1)}px;background:${b.color}" title="${b.label}${b.times?' — '+b.times:''}${b.sub?' · '+b.sub:''}">
      <div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${b.label}</div>
      ${b.times&&b.h>=28?`<div style="font-weight:600;opacity:.9;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:9px">${b.times}</div>`:''}
      ${b.sub&&b.h>=44?`<div style="font-weight:400;opacity:.75;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:9px">${b.sub}</div>`:''}
    </div>`).join('');
  }
  const gapHtml=gapBlocks.map(g=>`<div class="hgt-gap" style="top:${g.top.toFixed(1)}px;height:${Math.max(g.bot-g.top,4).toFixed(1)}px" title="No accommodation booked"></div>`).join('');
  const toggleBtn=`<button onclick="hGanttCompact=!hGanttCompact;hrenderGantt()" style="font-size:10px;padding:2px 6px;line-height:1.4" title="${hGanttCompact?'Switch to proportional time':'Switch to compact view'}">${hGanttCompact?'<i class="ti ti-clock" aria-hidden="true"></i> Time':'<i class="ti ti-layout-list" aria-hidden="true"></i> Compact'}</button>`;
  document.getElementById('hvgantt').innerHTML=`
    <div class="hgt-wrap">
      <div class="hgt-head">
        <div class="hgt-head-axis" style="display:flex;align-items:flex-end;padding-bottom:4px">${toggleBtn}</div>
        <div class="hgt-col-hd"><i class="ti ti-home" aria-hidden="true"></i> Accommodation</div>
        <div class="hgt-col-hd"><i class="ti ti-train" aria-hidden="true"></i> Travel</div>
        <div class="hgt-col-hd"><i class="ti ti-calendar-event" aria-hidden="true"></i> Events</div>
      </div>
      <div class="hgt-scroll">
        <div class="hgt-axis" style="height:${totalPx.toFixed(0)}px">${axisHtml}</div>
        <div class="hgt-body" style="height:${totalPx.toFixed(0)}px">
          ${bodyLines}
          <div class="hgt-col">${gapHtml}${blkHtml(accomBlocks)}</div>
          <div class="hgt-col">${blkHtml(travelBlocks)}</div>
          <div class="hgt-col">${blkHtml(eventBlocks)}</div>
        </div>
      </div>
    </div>`;
}

let _editTarget=null;

function hToggleEdit(){
  const on=document.getElementById('happ').classList.toggle('hedit-on');
  document.getElementById('hedit-toggle').style.color=on?'var(--color-text-primary)':'';
}

function hOpenEdit(idx){
  _editTarget={type:'segment',idx};
  const seg=HD.segments[idx];
  document.getElementById('hedit-title').textContent='Edit: '+(seg.name||seg.operator||'Segment');
  document.getElementById('hedit-ta').value=JSON.stringify(seg,null,2);
  document.getElementById('hedit-err').textContent='';
  document.getElementById('hedit-modal').classList.add('on');
}

function hOpenEditTrip(){
  _editTarget={type:'trip'};
  document.getElementById('hedit-title').textContent='Edit: Trip details';
  document.getElementById('hedit-ta').value=JSON.stringify(HD.trip,null,2);
  document.getElementById('hedit-err').textContent='';
  document.getElementById('hedit-modal').classList.add('on');
}

function hCloseEdit(){
  document.getElementById('hedit-modal').classList.remove('on');
  _editTarget=null;
}

function hSaveEdit(){
  let val;
  try{val=JSON.parse(document.getElementById('hedit-ta').value);}
  catch(e){document.getElementById('hedit-err').textContent='Invalid JSON: '+e.message;return;}
  if(_editTarget.type==='segment'){
    HD.segments[_editTarget.idx]=val;
  } else {
    HD.trip=val;
    hUpdateHeader();
  }
  localStorage.setItem('hItinerary',JSON.stringify(HD));
  hCloseEdit();
  hrenderList();hrenderBudget();hrenderGantt();
  if(document.getElementById('hvmap').classList.contains('on')){hrenderMap();}
  else{if(HM){HM.remove();HM=null;}HMapReady=false;}
}

function hDownload(){
  const blob=new Blob([JSON.stringify(HD,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=(HD.trip.name||'itinerary').replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'_').toLowerCase()+'.json';
  a.click();URL.revokeObjectURL(url);
}

function hUpdateHeader(){
  document.getElementById('htname').innerHTML=`${HD.trip.name} <button class="hedit-btn" onclick="hOpenEditTrip()" style="font-size:11px;padding:1px 5px;line-height:1.5;color:var(--color-text-secondary);vertical-align:middle" title="Edit trip details"><i class="ti ti-pencil" aria-hidden="true"></i></button>`;
  document.getElementById('htmeta').innerHTML=`
    <span><i class="ti ti-calendar" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${hfmtD(HD.trip.start)} – ${hfmtD(HD.trip.end)}</span>
    <span><i class="ti ti-users" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${HD.trip.travellers.join(' & ')}</span>`;
}

function hload(data){
  HD=typeof data==='string'?JSON.parse(data):data;
  localStorage.setItem('hItinerary',JSON.stringify(HD));
  document.getElementById('hupl').style.display='none';
  document.getElementById('happ').style.display='block';
  hUpdateHeader();
  hrenderList();hrenderBudget();hrenderGantt();
}

function hreset(){
  HD=null;localStorage.removeItem('hItinerary');if(HM){HM.remove();HM=null;}HMapReady=false;
  document.getElementById('hupl').style.display='block';
  document.getElementById('happ').style.display='none';
  hsw('list');
}

function hsw(v){
  document.querySelectorAll('.htab').forEach(t=>t.classList.toggle('on',t.dataset.v===v));
  document.getElementById('hvlist').className='hv'+(v==='list'?' on':'');
  document.getElementById('hvbudget').className='hv'+(v==='budget'?' on':'');
  document.getElementById('hvmap').className='hv'+(v==='map'?' on':'');
  document.getElementById('hvgantt').className='hv'+(v==='gantt'?' on':'');
  if(v==='map'&&!HMapReady&&HD){HMapReady=true;setTimeout(hrenderMap,120);}
}

document.getElementById('hfile').addEventListener('change',e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{try{hload(JSON.parse(ev.target.result));}catch(err){alert('Invalid JSON: '+err.message);}};
  r.readAsText(f);e.target.value='';
});
const dz=document.getElementById('hdz');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('over');});
dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
dz.addEventListener('drop',e=>{
  e.preventDefault();dz.classList.remove('over');
  const f=e.dataTransfer.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{try{hload(JSON.parse(ev.target.result));}catch(err){alert('Invalid JSON: '+err.message);}};
  r.readAsText(f);
});
const _saved=localStorage.getItem('hItinerary');
if(_saved){try{hload(JSON.parse(_saved));}catch(e){localStorage.removeItem('hItinerary');}}
