import { useState, useEffect, useCallback } from "react";

const MOCK_NSE_DATA = {
  spot: 23612, high: 23741, low: 23498, vix: 15.82,
  optionChain: {
    23300: { ce: { ltp: 312, oi: 8.2,  oiChange: 12.4,  iv: 14.2 }, pe: { ltp: 18,  oi: 42.1, oiChange: -8.2,  iv: 16.1 } },
    23400: { ce: { ltp: 218, oi: 12.4, oiChange: 18.6,  iv: 13.8 }, pe: { ltp: 28,  oi: 38.4, oiChange: -5.1,  iv: 15.4 } },
    23500: { ce: { ltp: 142, oi: 28.6, oiChange: 32.1,  iv: 13.2 }, pe: { ltp: 48,  oi: 52.8, oiChange: 9.4,   iv: 14.8 } },
    23550: { ce: { ltp: 108, oi: 18.2, oiChange: 24.8,  iv: 13.0 }, pe: { ltp: 68,  oi: 44.2, oiChange: 14.2,  iv: 14.6 } },
    23600: { ce: { ltp: 78,  oi: 22.4, oiChange: 44.2,  iv: 12.8 }, pe: { ltp: 92,  oi: 31.6, oiChange: 6.8,   iv: 14.2 } },
    23650: { ce: { ltp: 54,  oi: 16.8, oiChange: 38.6,  iv: 12.6 }, pe: { ltp: 122, oi: 24.8, oiChange: 4.2,   iv: 14.0 } },
    23700: { ce: { ltp: 36,  oi: 39.8, oiChange: 64.3,  iv: 12.4 }, pe: { ltp: 158, oi: 18.2, oiChange: 2.1,   iv: 13.8 } },
    23750: { ce: { ltp: 22,  oi: 28.4, oiChange: 52.1,  iv: 12.2 }, pe: { ltp: 198, oi: 14.4, oiChange: 1.2,   iv: 13.6 } },
    23800: { ce: { ltp: 14,  oi: 44.2, oiChange: 78.4,  iv: 12.0 }, pe: { ltp: 244, oi: 10.8, oiChange: 0.8,   iv: 13.4 } },
  },
  maxPain: 23600, pcr: 0.74, fiiNet: "short",
};

function normCDF(x){const t=1/(1+0.2316419*Math.abs(x));const d=0.3989422820*Math.exp(-0.5*x*x);const p=d*t*(0.3193815+t*(-0.3565638+t*(1.7814779+t*(-1.8212560+t*1.3302744))));return x>=0?1-p:p;}
function normPDF(x){return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);}
function bs(S,K,T,r,sig,type){
  if(T<=0.00001||sig<=0.001){const ci=Math.max(S-K,0),pi=Math.max(K-S,0);return{p:type==="call"?ci:pi,delta:type==="call"?(ci>0?1:0):(pi>0?-1:0),gamma:0,theta:0,vega:0,Nd2:ci>0?1:0,Nnd2:pi>0?1:0};}
  const sq=Math.sqrt(T);const d1=(Math.log(S/K)+(r+sig*sig/2)*T)/(sig*sq);const d2=d1-sig*sq;
  const Nd1=normCDF(d1),Nd2=normCDF(d2),Nnd1=normCDF(-d1),Nnd2=normCDF(-d2);
  const nd1=normPDF(d1),eRT=Math.exp(-r*T);
  const call=S*Nd1-K*eRT*Nd2;const put=K*eRT*Nnd2-S*Nnd1;
  const p=type==="call"?call:put;const delta=type==="call"?Nd1:Nd1-1;
  const gamma=nd1/(S*sig*sq);
  const tC=(-(S*nd1*sig)/(2*sq)-r*K*eRT*Nd2)/365;const tP=(-(S*nd1*sig)/(2*sq)+r*K*eRT*Nnd2)/365;
  const theta=type==="call"?tC:tP;const vega=S*nd1*sq/100;
  return{p,delta,gamma,theta,vega,Nd2,Nnd2};
}
function impliedVol(S,K,T,r,mkt,type){
  let sig=0.18;
  for(let i=0;i<200;i++){const res=bs(S,K,T,r,sig,type);const diff=res.p-mkt;if(Math.abs(diff)<0.005)break;const v=res.vega*100;if(Math.abs(v)<0.0001)break;sig-=diff/v;sig=Math.max(0.01,Math.min(5,sig));}
  return sig;
}

function scoreDirection(data,indicators,dte){
  const{spot,maxPain,pcr,fiiNet,optionChain}=data;
  let indRaw=0;
  const{rsi,ema20,ema200,macd,vwap,supertrend,trend}=indicators;
  if(rsi<35)indRaw+=1;else if(rsi>65)indRaw-=1;else if(rsi<45)indRaw-=0.5;else if(rsi>55)indRaw+=0.5;
  indRaw+=(ema20==="above"?1:ema20==="below"?-1:0);
  indRaw+=(ema200==="above"?1:ema200==="below"?-1:0);
  indRaw+=(macd==="bull"?0.5:macd==="bear"?-0.5:macd==="cross_bull"?1:-1);
  indRaw+=(vwap==="above"?1:-1);
  indRaw+=(supertrend==="bull"?1:-1);
  indRaw+=(trend==="uptrend"?1:trend==="downtrend"?-1:0);
  const l2Score=Math.max(0,Math.min(10,Math.round(((indRaw+8)/16)*10)));
  const totalCOI=Object.values(optionChain).reduce((s,v)=>s+v.ce.oi,0);
  const totalPOI=Object.values(optionChain).reduce((s,v)=>s+v.pe.oi,0);
  const oiPCR=totalPOI/totalCOI;
  const mpDiff=spot-maxPain;
  let oiScore=5;
  oiScore+=(pcr<0.7?-1.5:pcr>1.2?1.5:0);
  oiScore+=(Math.abs(mpDiff)>100?(mpDiff>0?-2:2):0);
  oiScore+=(fiiNet==="long"?2:fiiNet==="short"?-2:0);
  oiScore+=(oiPCR<0.7?-1:oiPCR>1.2?1:0);
  oiScore=Math.max(0,Math.min(10,Math.round(oiScore)));
  const finalScore=l2Score*0.55+oiScore*0.45;
  const l2l3agree=Math.abs(l2Score-oiScore)<=2.5;
  const confluence=l2l3agree&&(finalScore>=6.5||finalScore<=3.5);
  let direction,cls;
  if(finalScore>=7){direction="STRONGLY BULLISH";cls="bull";}
  else if(finalScore>=5.5){direction="CAUTIOUS BULLISH";cls="bull";}
  else if(finalScore<=3){direction="STRONGLY BEARISH";cls="bear";}
  else if(finalScore<=4.5){direction="CAUTIOUS BEARISH";cls="bear";}
  else{direction="NEUTRAL";cls="neutral";}
  return{finalScore,l2Score,oiScore,direction,cls,confluence,mpDiff,oiPCR};
}

function findBestStrikes(data,scoring,dte,role,risk,vixDecimal){
  const{spot,optionChain}=data;
  const r=0.065;const T=dte/365;const friT=Math.max(dte-1,0.25)/365;const lotSize=75;
  const results={ce:null,pe:null};
  for(const typeKey of["call","put"]){
    const side=typeKey==="call"?"ce":"pe";
    const strikes=Object.keys(optionChain).map(Number).sort((a,b)=>a-b);
    const candidates=[];
    for(const K of strikes){
      const mkt=optionChain[K][side].ltp;if(mkt<=0)continue;
      const iv=impliedVol(spot,K,T,r,mkt,typeKey);
      const res=bs(spot,K,T,r,iv,typeKey);
      const nextIV=vixDecimal+Math.max(iv-vixDecimal,0)*0.55;
      const nextRes=bs(spot,K,friT,r,nextIV,typeKey);
      const pITM=typeKey==="call"?res.Nd2:res.Nnd2;
      const theta=Math.abs(res.theta);const thetaPct=mkt>0?theta/mkt:0;
      const beMove=typeKey==="call"?Math.max(K+mkt-spot,0):Math.max(spot-(K-mkt),0);
      const exp1sig=spot*iv*Math.sqrt(1/252);
      const premLot=mkt*lotSize;
      const buyerTarget=mkt*(risk==="conservative"?1.5:risk==="moderate"?2.0:2.5);
      candidates.push({K,mkt,iv,nextIV,pITM,theta,thetaPct,beMove,exp1sig,premLot,sellerWins:(1-pITM)*100,buyerTarget,nextPITM:typeKey==="call"?nextRes.Nd2:nextRes.Nnd2,oiData:optionChain[K][side]});
    }
    const isBullish=scoring.cls==="bull";
    if(role==="seller"){
      const pool=candidates.filter(c=>typeKey==="call"?c.K>spot:c.K<spot).filter(c=>c.pITM>=0.15&&c.pITM<=0.40&&c.premLot>=2000);
      pool.sort((a,b)=>b.thetaPct-a.thetaPct);
      results[side]=pool[0]||candidates.filter(c=>c.premLot>=1500).sort((a,b)=>Math.abs(a.pITM-0.25)-Math.abs(b.pITM-0.25))[0];
    } else {
      const pool=candidates.filter(c=>typeKey==="call"?(isBullish?(c.K>=spot&&c.K<=spot+100):c.K>spot+50):(!isBullish?(c.K<=spot&&c.K>=spot-100):c.K<spot-50)).filter(c=>c.premLot>=1000&&c.pITM>=0.20);
      pool.sort((a,b)=>b.pITM-a.pITM);
      results[side]=pool[0]||candidates.sort((a,b)=>Math.abs(a.K-spot)-Math.abs(b.K-spot))[0];
    }
  }
  return results;
}

export default function PredictionEngine(){
  const[liveData,setLiveData]=useState(null);
  const[fetching,setFetching]=useState(false);
  const[dte,setDte]=useState(2);
  const[role,setRole]=useState("seller");
  const[risk,setRisk]=useState("moderate");
  const[lots,setLots]=useState(1);
  const[result,setResult]=useState(null);
  const[showChain,setShowChain]=useState(false);
  const[ind,setInd]=useState({rsi:48,ema20:"below",ema200:"below",macd:"bear",vwap:"above",supertrend:"bear",trend:"downtrend"});
  const updInd=(k,v)=>setInd(p=>({...p,[k]:v}));

  const fetchData=useCallback(async()=>{
    setFetching(true);
    await new Promise(r=>setTimeout(r,1100));
    setLiveData({...MOCK_NSE_DATA,ts:new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})});
    setFetching(false);
  },[]);

  useEffect(()=>{fetchData();},[]);

  const run=()=>{
    if(!liveData)return;
    const vixD=liveData.vix/100;
    const scoring=scoreDirection(liveData,ind,dte);
    const strikes=findBestStrikes(liveData,scoring,dte,role,risk,vixD);
    setResult({scoring,strikes,spot:liveData.spot,vix:liveData.vix,dte});
    setShowChain(false);
  };

  const ce=result?.strikes?.ce;
  const pe=result?.strikes?.pe;
  const sc=result?.scoring;
  const C={bg:"#04060d",s1:"#080d18",s2:"#0d1322",b1:"#1c2840",b2:"#253352",gold:"#c8981a",gold2:"#e8b830",green:"#00d484",red:"#f03858",blue2:"#60a0ff",purple2:"#b080ff",cyan:"#00c8f0",orange2:"#ffaa50",text:"#c8d8f0",text2:"#7888a8",text3:"#3a4860"};
  const clsColor=(cls)=>cls==="bull"?C.green:cls==="bear"?C.red:C.gold2;

  return(
    <div style={{background:C.bg,minHeight:"100vh",fontFamily:"'JetBrains Mono',monospace",color:C.text,fontSize:13,padding:"24px 16px 48px"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}select option{background:#0d1322}*{box-sizing:border-box}`}</style>
      <div style={{maxWidth:900,margin:"0 auto"}}>

        {/* HEADER */}
        <div style={{marginBottom:24,borderBottom:`1px solid ${C.b1}`,paddingBottom:20}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,background:"rgba(200,152,26,0.08)",border:"1px solid rgba(200,152,26,0.2)",borderRadius:4,padding:"4px 12px",fontSize:9,letterSpacing:"2.5px",textTransform:"uppercase",color:C.gold,marginBottom:12}}>
            <div style={{width:5,height:5,background:C.green,borderRadius:"50%",animation:"blink 1.4s infinite"}}/>
            Live Engine · Dual CE+PE · NSE Auto-Fetch
          </div>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:"clamp(22px,4vw,38px)",fontWeight:800,letterSpacing:-1,marginBottom:6}}>
            Nifty <span style={{color:C.gold2}}>Prediction Engine</span> <span style={{color:C.text2,fontSize:"50%",fontWeight:400}}>v2.0</span>
          </div>
          <div style={{fontSize:11,color:C.text2,lineHeight:1.8}}>Auto-fetches spot, option chain, OI & VIX from NSE. Only indicators need manual input. Outputs both CE + PE strikes simultaneously.</div>
        </div>

        {/* LIVE DATA BAR */}
        <div style={{background:C.s1,border:`1px solid ${C.b1}`,borderRadius:8,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
          {liveData?(<>
            {[
              {lbl:"Nifty Spot",val:`₹${liveData.spot.toLocaleString()}`,c:C.gold2,big:true},
              {lbl:"Day High",val:`₹${liveData.high}`,c:C.green},
              {lbl:"Day Low",val:`₹${liveData.low}`,c:C.red},
              {lbl:"India VIX",val:liveData.vix,c:liveData.vix>20?C.red:C.green},
              {lbl:"Max Pain",val:`₹${liveData.maxPain}`,c:C.purple2},
              {lbl:"PCR",val:liveData.pcr,c:liveData.pcr<0.7?C.red:liveData.pcr>1.2?C.green:C.gold2},
              {lbl:"FII",val:liveData.fiiNet.toUpperCase(),c:liveData.fiiNet==="long"?C.green:C.red},
            ].map((item,i)=>(
              <div key={i} style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontSize:8,letterSpacing:"1.5px",textTransform:"uppercase",color:C.text2}}>{item.lbl}</span>
                <span style={{fontSize:item.big?18:14,fontWeight:700,color:item.c}}>{item.val}</span>
              </div>
            ))}
            <div style={{marginLeft:"auto",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
              <button onClick={fetchData} disabled={fetching} style={{padding:"7px 14px",background:`linear-gradient(135deg,${C.gold},${C.orange2})`,border:"none",borderRadius:5,color:"#000",fontFamily:"'JetBrains Mono',monospace",fontSize:10,fontWeight:700,letterSpacing:"1.5px",cursor:"pointer",opacity:fetching?0.6:1}}>
                {fetching?"Fetching...":"↻ Refresh"}
              </button>
              <span style={{fontSize:9,color:C.text3}}>Updated {liveData.ts} · Simulated NSE</span>
            </div>
          </>):(
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:14,height:14,border:`2px solid ${C.gold}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
              <span style={{fontSize:12,color:C.text2}}>Fetching NSE data...</span>
            </div>
          )}
        </div>

        {/* INDICATORS */}
        <div style={{background:C.s1,border:`1px solid ${C.b1}`,borderTop:`2px solid ${C.gold}`,borderRadius:10,padding:20,marginBottom:16}}>
          <div style={{fontSize:9,letterSpacing:"2.5px",textTransform:"uppercase",color:C.gold,marginBottom:16,display:"flex",alignItems:"center",gap:8}}>
            Technical Indicators
            <span style={{flex:1,height:1,background:"rgba(200,152,26,0.2)"}}/>
            <span style={{fontSize:9,color:C.text2,fontWeight:400}}>From TradingView EOD</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:12,marginBottom:14}}>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              <label style={{fontSize:8,letterSpacing:"1.5px",textTransform:"uppercase",color:C.text2}}>RSI (14)</label>
              <input type="number" value={ind.rsi} onChange={e=>updInd("rsi",+e.target.value)} style={{background:C.s2,border:`1px solid ${C.b2}`,borderRadius:5,color:C.text,fontFamily:"'JetBrains Mono',monospace",fontSize:13,padding:"8px 10px",outline:"none",width:"100%"}} min="0" max="100" step="0.1"/>
              <span style={{fontSize:9,color:C.text3}}>&lt;40 oversold · &gt;60 overbought</span>
            </div>
            {[
              {id:"ema20",lbl:"EMA 20 vs Spot",opts:[["above","Above EMA20 (Bull)"],["below","Below EMA20 (Bear)"],["at","At EMA20"]]},
              {id:"ema200",lbl:"EMA 200 vs Spot",opts:[["above","Above EMA200 (Bull)"],["below","Below EMA200 (Bear)"],["at","At EMA200"]]},
              {id:"macd",lbl:"MACD",opts:[["bull","Above Signal (Bull)"],["bear","Below Signal (Bear)"],["cross_bull","Bullish Crossover"],["cross_bear","Bearish Crossover"]]},
              {id:"vwap",lbl:"VWAP vs Close",opts:[["above","Above VWAP (Bull)"],["below","Below VWAP (Bear)"]]},
              {id:"supertrend",lbl:"Supertrend",opts:[["bull","GREEN (Buy)"],["bear","RED (Sell)"]]},
              {id:"trend",lbl:"Daily Trend",opts:[["uptrend","Uptrend"],["downtrend","Downtrend"],["sideways","Sideways"]]},
            ].map(f=>(
              <div key={f.id} style={{display:"flex",flexDirection:"column",gap:4}}>
                <label style={{fontSize:8,letterSpacing:"1.5px",textTransform:"uppercase",color:C.text2}}>{f.lbl}</label>
                <select value={ind[f.id]} onChange={e=>updInd(f.id,e.target.value)} style={{background:C.s2,border:`1px solid ${C.b2}`,borderRadius:5,color:C.text,fontFamily:"'JetBrains Mono',monospace",fontSize:12,padding:"8px 10px",outline:"none",width:"100%"}}>
                  {f.opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* TRADE PREFS */}
        <div style={{background:C.s1,border:`1px solid ${C.b1}`,borderTop:`2px solid ${C.gold}`,borderRadius:10,padding:20,marginBottom:16}}>
          <div style={{fontSize:9,letterSpacing:"2.5px",textTransform:"uppercase",color:C.gold,marginBottom:16,display:"flex",alignItems:"center",gap:8}}>
            Trade Preference <span style={{flex:1,height:1,background:"rgba(200,152,26,0.2)"}}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:14}}>
            {[
              {lbl:"Your Role",type:"select",val:role,set:setRole,opts:[["seller","SELL Premium (Theta)"],["buyer","BUY Premium (Direction)"]]},
              {lbl:"Risk Appetite",type:"select",val:risk,set:setRisk,opts:[["conservative","Conservative"],["moderate","Moderate"],["aggressive","Aggressive"]]},
            ].map(f=>(
              <div key={f.lbl} style={{display:"flex",flexDirection:"column",gap:4}}>
                <label style={{fontSize:8,letterSpacing:"1.5px",textTransform:"uppercase",color:C.text2}}>{f.lbl}</label>
                <select value={f.val} onChange={e=>f.set(e.target.value)} style={{background:C.s2,border:`1px solid ${C.b2}`,borderRadius:5,color:C.text,fontFamily:"'JetBrains Mono',monospace",fontSize:12,padding:"8px 10px",outline:"none",width:"100%"}}>
                  {f.opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            ))}
            {[
              {lbl:"Number of Lots",val:lots,set:setLots,min:1,max:50},
              {lbl:"DTE (Days to Expiry)",val:dte,set:setDte,min:1,max:30,hint:"Include expiry day"},
            ].map(f=>(
              <div key={f.lbl} style={{display:"flex",flexDirection:"column",gap:4}}>
                <label style={{fontSize:8,letterSpacing:"1.5px",textTransform:"uppercase",color:C.text2}}>{f.lbl}</label>
                <input type="number" value={f.val} onChange={e=>f.set(Math.max(f.min,+e.target.value||f.min))} style={{background:C.s2,border:`1px solid ${C.b2}`,borderRadius:5,color:C.text,fontFamily:"'JetBrains Mono',monospace",fontSize:13,padding:"8px 10px",outline:"none",width:"100%"}} min={f.min} max={f.max}/>
                {f.hint&&<span style={{fontSize:9,color:C.text3}}>{f.hint}</span>}
              </div>
            ))}
          </div>
          <button onClick={run} disabled={!liveData||fetching} style={{width:"100%",padding:14,background:`linear-gradient(135deg,${C.gold} 0%,#f87820 100%)`,border:"none",borderRadius:8,color:"#000",fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,letterSpacing:"2.5px",cursor:"pointer",textTransform:"uppercase",opacity:(!liveData||fetching)?0.5:1}}>
            → &nbsp; ANALYSE BOTH CE + PE NOW
          </button>
        </div>

        {/* OUTPUT */}
        {result&&sc&&(
          <div style={{animation:"fadeUp 0.3s ease"}}>

            {/* DIRECTION BANNER */}
            <div style={{borderRadius:10,padding:"20px 24px",marginBottom:16,background:sc.cls==="bull"?"linear-gradient(135deg,rgba(0,212,132,0.09),rgba(0,200,240,0.04))":sc.cls==="bear"?"linear-gradient(135deg,rgba(240,56,88,0.09),rgba(248,120,32,0.05))":"linear-gradient(135deg,rgba(200,152,26,0.09),rgba(40,120,240,0.05))",border:`1px solid ${sc.cls==="bull"?"rgba(0,212,132,0.3)":sc.cls==="bear"?"rgba(240,56,88,0.3)":"rgba(200,152,26,0.3)"}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:14}}>
                <div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:"clamp(22px,4vw,36px)",fontWeight:800,color:clsColor(sc.cls),letterSpacing:-0.5,lineHeight:1}}>{sc.direction}</div>
                  <div style={{fontSize:11,color:C.text2,marginTop:5}}>
                    Nifty ₹{result.spot.toLocaleString()} · VIX {result.vix} · DTE {result.dte} · Max Pain ₹{liveData.maxPain}
                    {sc.confluence&&<span style={{color:C.gold2,marginLeft:8}}>⚡ L2+L3 Confluence</span>}
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:42,fontWeight:700,color:clsColor(sc.cls),lineHeight:1}}>{Math.round(sc.finalScore*10)}%</div>
                  <div style={{fontSize:9,letterSpacing:"1.5px",textTransform:"uppercase",color:C.text2}}>Confidence</div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
                {[
                  {lbl:"Indicators (L2)",val:sc.l2Score.toFixed(1)+"/10",c:sc.l2Score>=6?C.green:sc.l2Score<=4?C.red:C.gold2},
                  {lbl:"OI + PCR (L3)",val:sc.oiScore.toFixed(1)+"/10",c:sc.oiScore>=6?C.green:sc.oiScore<=4?C.red:C.gold2},
                  {lbl:"Max Pain Gap",val:(sc.mpDiff>0?"+":"")+sc.mpDiff.toFixed(0)+" pts",c:Math.abs(sc.mpDiff)>100?C.red:C.gold2},
                ].map((item,i)=>(
                  <div key={i} style={{background:"rgba(0,0,0,0.25)",border:`1px solid ${C.b1}`,borderRadius:6,padding:"10px 12px",textAlign:"center"}}>
                    <div style={{fontSize:20,fontWeight:700,color:item.c,marginBottom:2}}>{item.val}</div>
                    <div style={{fontSize:8,letterSpacing:"2px",textTransform:"uppercase",color:C.text2}}>{item.lbl}</div>
                  </div>
                ))}
              </div>

              {/* MASTER REC */}
              <div style={{background:"rgba(0,0,0,0.25)",border:`1px solid ${C.b1}`,borderRadius:8,padding:"14px 16px"}}>
                <div style={{fontSize:9,letterSpacing:"2px",textTransform:"uppercase",color:C.gold,marginBottom:10}}>Primary Recommendation</div>
                {sc.cls==="bull"&&(
                  <div style={{display:"flex",flexWrap:"wrap",gap:16,alignItems:"center"}}>
                    <div style={{fontSize:14,color:C.green,fontWeight:700}}>✦ {role==="seller"?`SELL ${pe?.K} PE`:`BUY ${ce?.K} CE`}<span style={{color:C.text2,fontWeight:400,marginLeft:8}}>(Primary — market is going UP)</span></div>
                    <div style={{fontSize:12,color:C.text2}}>{role==="seller"?`Also consider: SELL ${ce?.K} CE`:`Also: BUY ${pe?.K} PE as hedge`}<span style={{color:C.text3,marginLeft:8}}>(Optional)</span></div>
                  </div>
                )}
                {sc.cls==="bear"&&(
                  <div style={{display:"flex",flexWrap:"wrap",gap:16,alignItems:"center"}}>
                    <div style={{fontSize:14,color:C.red,fontWeight:700}}>✦ {role==="seller"?`SELL ${ce?.K} CE`:`BUY ${pe?.K} PE`}<span style={{color:C.text2,fontWeight:400,marginLeft:8}}>(Primary — market is going DOWN)</span></div>
                    <div style={{fontSize:12,color:C.text2}}>{role==="seller"?`Also consider: SELL ${pe?.K} PE`:`Also: BUY ${ce?.K} CE as hedge`}<span style={{color:C.text3,marginLeft:8}}>(Optional)</span></div>
                  </div>
                )}
                {sc.cls==="neutral"&&(
                  <div style={{fontSize:13,color:C.gold2}}>⚠ No strong direction. Iron Condor: SELL {ce?.K} CE + SELL {pe?.K} PE &nbsp;·&nbsp; Collect from both sides</div>
                )}
              </div>
            </div>

            {/* DUAL TRADE CARDS */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              {[{side:"ce",typeKey:"call",label:"CALL (CE)",col:C.green},{side:"pe",typeKey:"put",label:"PUT (PE)",col:C.red}].map(({side,typeKey,label,col})=>{
                const data=result.strikes[side];if(!data)return null;
                const lotSize=75;const totalPrem=(data.mkt*lotSize*lots).toFixed(0);
                const sellerSL=(data.mkt*2*lotSize*lots).toFixed(0);
                const buyerTgt=(data.buyerTarget*lotSize*lots).toFixed(0);
                const isBullPrimary=(sc.cls==="bull"&&side==="ce")||(sc.cls==="bear"&&side==="pe");
                return(
                  <div key={side} style={{borderRadius:10,padding:"18px 20px",background:side==="ce"?"linear-gradient(135deg,rgba(0,212,132,0.06),rgba(0,200,240,0.03))":"linear-gradient(135deg,rgba(240,56,88,0.06),rgba(248,120,32,0.03))",border:`2px solid ${side==="ce"?"rgba(0,212,132,0.3)":"rgba(240,56,88,0.3)"}`,position:"relative"}}>
                    {isBullPrimary&&<div style={{position:"absolute",top:12,right:12,background:"rgba(200,152,26,0.15)",border:"1px solid rgba(200,152,26,0.3)",borderRadius:4,padding:"2px 8px",fontSize:8,letterSpacing:"1.5px",textTransform:"uppercase",color:C.gold2}}>PRIMARY</div>}
                    <div style={{fontSize:9,letterSpacing:"2.5px",textTransform:"uppercase",color:col,marginBottom:8}}>{label} · Strike Analysis</div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:"clamp(18px,3vw,28px)",fontWeight:800,letterSpacing:-0.5,marginBottom:4}}>
                      <span style={{color:role==="seller"?C.red:C.green,marginRight:8}}>{role==="seller"?"SELL":"BUY"}</span>
                      <span style={{color:C.gold2}}>{data.K}</span>
                      <span style={{color:C.text,fontSize:"60%"}}> {side.toUpperCase()}</span>
                    </div>
                    <div style={{fontSize:12,color:C.text2,marginBottom:14}}>
                      Entry <strong style={{color:C.gold2,fontSize:15}}>₹{data.mkt.toFixed(1)}</strong> /share · ₹{totalPrem} total
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:12}}>
                      {[
                        {lbl:role==="seller"?"Max Profit":"Premium Paid",val:`${role==="seller"?"+":"−"}₹${totalPrem}`,c:role==="seller"?C.green:C.red},
                        {lbl:role==="seller"?"Win Probability":"Break-even",val:role==="seller"?data.sellerWins.toFixed(0)+"%":"+"+data.beMove.toFixed(0)+" pts",c:role==="seller"?C.green:C.gold2},
                        {lbl:"P(ITM)",val:(data.pITM*100).toFixed(0)+"%",c:data.pITM>0.5?C.green:data.pITM<0.25?C.red:C.gold2},
                        {lbl:"IV",val:(data.iv*100).toFixed(1)+"%",c:C.blue2},
                        {lbl:role==="seller"?"Stop Loss":"Target",val:`₹${role==="seller"?sellerSL:buyerTgt}`,c:role==="seller"?C.red:C.green},
                        {lbl:"OI Change",val:`${data.oiData.oiChange>0?"+":""}${data.oiData.oiChange}%`,c:data.oiData.oiChange>30?C.red:data.oiData.oiChange<-10?C.green:C.gold2},
                      ].map((s,i)=>(
                        <div key={i} style={{background:"rgba(0,0,0,0.3)",border:`1px solid ${C.b1}`,borderRadius:6,padding:"8px 10px"}}>
                          <div style={{fontSize:7,letterSpacing:"1.5px",textTransform:"uppercase",color:C.text2,marginBottom:3}}>{s.lbl}</div>
                          <div style={{fontSize:15,fontWeight:700,color:s.c}}>{s.val}</div>
                        </div>
                      ))}
                    </div>
                    {[
                      {type:"entry",icon:"✅",text:role==="seller"?`Sell ${data.K} ${side.toUpperCase()} @ ₹${data.mkt.toFixed(0)}. Min receive ₹${(data.mkt*0.85).toFixed(0)}.`:`Buy ${data.K} ${side.toUpperCase()} @ ₹${data.mkt.toFixed(0)}. Skip if above ₹${(data.mkt*1.1).toFixed(0)}.`},
                      {type:"exit",icon:"🎯",text:role==="seller"?`Buy back at ₹${(data.mkt*0.25).toFixed(0)} (75% profit) or hold to expiry.`:`Exit at ₹${data.buyerTarget.toFixed(0)}/share (+${((data.buyerTarget/data.mkt-1)*100).toFixed(0)}%).`},
                      {type:"stop",icon:"🛑",text:role==="seller"?`Exit if doubles to ₹${(data.mkt*2).toFixed(0)}.`:`Exit if falls to ₹${(data.mkt*0.4).toFixed(0)} (-60%).`},
                    ].map((r,i)=>(
                      <div key={i} style={{display:"flex",gap:8,padding:"7px 10px",borderRadius:5,fontSize:11,lineHeight:1.5,marginBottom:5,background:r.type==="entry"?"rgba(0,212,132,0.06)":r.type==="exit"?"rgba(200,152,26,0.06)":"rgba(240,56,88,0.06)",border:`1px solid ${r.type==="entry"?"rgba(0,212,132,0.2)":r.type==="exit"?"rgba(200,152,26,0.2)":"rgba(240,56,88,0.2)"}`}}>
                        <span>{r.icon}</span><span style={{color:C.text2}}><strong style={{color:C.text}}>{r.type==="entry"?"Entry:":r.type==="exit"?"Target:":"Stop:"}</strong> {r.text}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* OPTION CHAIN TOGGLE */}
            <button onClick={()=>setShowChain(p=>!p)} style={{background:C.s2,border:`1px solid ${C.b1}`,borderRadius:6,padding:"8px 18px",color:C.text2,fontFamily:"'JetBrains Mono',monospace",fontSize:10,letterSpacing:"1px",cursor:"pointer",width:"100%",marginBottom:12}}>
              {showChain?"▲ HIDE OPTION CHAIN":"▼ SHOW LIVE OPTION CHAIN"}
            </button>

            {showChain&&liveData&&(
              <div style={{animation:"fadeUp 0.2s ease",background:C.s1,border:`1px solid ${C.b1}`,borderRadius:8,overflow:"hidden",marginBottom:16}}>
                <div style={{background:C.s2,padding:"10px 14px",fontSize:9,letterSpacing:"2px",textTransform:"uppercase",color:C.text2,display:"grid",gridTemplateColumns:"1fr 1fr 1fr 70px 1fr 1fr 1fr",gap:8}}>
                  <span style={{color:C.green}}>CE OI (L)</span><span style={{color:C.green}}>CE OI Chg%</span><span style={{color:C.green}}>CE LTP</span>
                  <span style={{color:C.gold2,textAlign:"center"}}>STRIKE</span>
                  <span style={{color:C.red}}>PE LTP</span><span style={{color:C.red}}>PE OI Chg%</span><span style={{color:C.red}}>PE OI (L)</span>
                </div>
                {Object.entries(liveData.optionChain).sort((a,b)=>+a[0]-+b[0]).map(([strike,d])=>{
                  const isATM=Math.abs(+strike-liveData.spot)<=50;
                  const isCeRec=ce?.K===+strike;const isPeRec=pe?.K===+strike;
                  return(
                    <div key={strike} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 70px 1fr 1fr 1fr",gap:8,padding:"7px 14px",borderBottom:`1px solid ${C.b1}`,background:isATM?"rgba(200,152,26,0.05)":"transparent",fontSize:12}}>
                      <span style={{color:C.green}}>{d.ce.oi}L</span>
                      <span style={{color:d.ce.oiChange>0?C.green:C.red}}>{d.ce.oiChange>0?"+":""}{d.ce.oiChange}%</span>
                      <span style={{color:isCeRec?C.gold2:C.text,fontWeight:isCeRec?700:400}}>₹{d.ce.ltp}{isCeRec?" ◄":""}</span>
                      <span style={{color:isATM?C.gold2:C.text2,textAlign:"center",fontWeight:isATM?700:400}}>{strike}</span>
                      <span style={{color:isPeRec?C.gold2:C.text,fontWeight:isPeRec?700:400}}>{isPeRec?"► ":""}₹{d.pe.ltp}</span>
                      <span style={{color:d.pe.oiChange>0?C.green:C.red}}>{d.pe.oiChange>0?"+":""}{d.pe.oiChange}%</span>
                      <span style={{color:C.red}}>{d.pe.oi}L</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{textAlign:"center",fontSize:10,color:C.text3,marginTop:16,padding:"12px",borderTop:`1px solid ${C.b1}`}}>
              ⚠ Demo uses simulated NSE data · Production connects to live NSE proxy · Not SEBI registered · Paper trade first
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
