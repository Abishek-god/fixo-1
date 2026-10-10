"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowDownLeft, ArrowUpRight, LogOut, RefreshCw, Search, Sparkles, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FIXO_MODELS, type FixoTask } from "@/lib/ai/models";

const SYMBOLS=[
 {symbol:"NIFTY50",company:"NIFTY 50",exchange:"NSE index"},{symbol:"SENSEX",company:"S&P BSE SENSEX",exchange:"BSE index"},
 {symbol:"RELIANCE",company:"Reliance Industries",exchange:"NSE"},{symbol:"TCS",company:"Tata Consultancy Services",exchange:"NSE"},
 {symbol:"INFY",company:"Infosys",exchange:"NSE"},{symbol:"HDFCBANK",company:"HDFC Bank",exchange:"NSE"},
 {symbol:"SBIN",company:"State Bank of India",exchange:"NSE"},{symbol:"ICICIBANK",company:"ICICI Bank",exchange:"NSE"},
 {symbol:"ITC",company:"ITC Limited",exchange:"NSE"},{symbol:"BHARTIARTL",company:"Bharti Airtel",exchange:"NSE"},
];
type Quote={symbol:string;company:string;price:number;change_percent:number|null;updated_at?:string};
type Position={id:string;symbol:string;quantity:number;average_price:number};
type Order={id:string;symbol:string;side:string;quantity:number;price:number;notional:number;created_at:string;status:string};
type Portfolio={portfolio:{id:string;cash_balance:number;currency:string};positions:Position[];orders:Order[]};
const inr=(v:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(v);
const qty=(v:number)=>new Intl.NumberFormat("en-IN",{maximumFractionDigits:4}).format(v);
const API=(process.env.NEXT_PUBLIC_FIXO_API_BASE_URL||"http://localhost:8000").replace(/\/+$/,"");

export default function DashboardPage(){
 const router=useRouter();
 const [supabase]=useState(()=>createClient());
 const [email,setEmail]=useState("");const [token,setToken]=useState("");
 const [quotes,setQuotes]=useState<Quote[]>([]);const [portfolio,setPortfolio]=useState<Portfolio|null>(null);
 const [watchlist,setWatchlist]=useState<string[]>([]);const [query,setQuery]=useState("");
 const [symbol,setSymbol]=useState("RELIANCE");const [side,setSide]=useState<"buy"|"sell">("buy");const [quantity,setQuantity]=useState("1");
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const [tab,setTab]=useState<"positions"|"orders">("positions");
 const [prompt,setPrompt]=useState("Explain the risks I should consider before a simulated trade.");
 const [answer,setAnswer]=useState("");const [aiModel,setAiModel]=useState("qwen3.8-27b");const [aiTask,setAiTask]=useState<FixoTask>("general");const [aiBusy,setAiBusy]=useState(false);

 const load=useCallback(async(accessToken:string)=>{
  setError("");
  try{
   const results=await Promise.all([
    fetch(API+"/api/market/quotes?symbols="+SYMBOLS.map(s=>s.symbol).join(","),{cache:"no-store"}),
    fetch(API+"/api/portfolio",{headers:{Authorization:"Bearer "+accessToken},cache:"no-store"}),
    supabase.from("watchlist_items").select("symbol").order("created_at",{ascending:true})
   ]);
   if(!results[0].ok)throw new Error("Market-data service unavailable. Start FastAPI and check its URL.");
   const marketData=await results[0].json();setQuotes(marketData.quotes||[]);
   if(results[1].ok)setPortfolio(await results[1].json());
   else if(results[1].status===401){await supabase.auth.signOut();router.replace("/auth");return;}
   else {const data=await results[1].json().catch(()=>({}));throw new Error(data.detail||"Could not load paper portfolio.");}
   if(!results[2].error&&results[2].data)setWatchlist(results[2].data.map((x:{symbol:string})=>x.symbol));
  }catch(e){setError(e instanceof Error?e.message:"Unable to load dashboard.");}
 },[router,supabase]);

 useEffect(()=>{
  let alive=true;
  supabase.auth.getSession().then(async({data})=>{
   if(!alive)return;const session=data.session;
   if(!session){router.replace("/auth");return;}
   setEmail(session.user.email||"");setToken(session.access_token);await load(session.access_token);
  });
  const listener=supabase.auth.onAuthStateChange((_event,session)=>{
   if(!alive)return;
   if(!session){router.replace("/auth");return;}
   setEmail(session.user.email||"");setToken(session.access_token);
  });
  return()=>{alive=false;listener.data.subscription.unsubscribe();};
 },[load,router,supabase]);

 const positions=portfolio?.positions||[];const orders=portfolio?.orders||[];
 const quoteMap=useMemo(()=>new Map(quotes.map(q=>[q.symbol,q])),[quotes]);
 const positionValue=positions.reduce((sum,p)=>sum+(quoteMap.get(p.symbol)?.price||Number(p.average_price))*Number(p.quantity),0);
 const costValue=positions.reduce((sum,p)=>sum+Number(p.average_price)*Number(p.quantity),0);const pnl=positionValue-costValue;
 const filtered=SYMBOLS.filter(s=>(s.symbol+" "+s.company).toLowerCase().includes(query.toLowerCase()));

 async function toggleWatch(sym:string){
  const exists=watchlist.includes(sym);
  const result=exists?await supabase.from("watchlist_items").delete().eq("symbol",sym):await supabase.from("watchlist_items").insert({symbol:sym});
  if(result.error){setError(result.error.message);return;}
  setWatchlist(old=>exists?old.filter(x=>x!==sym):old.concat(sym));
 }
 async function placeOrder(){
  if(!token||busy)return;setBusy(true);setError("");setNotice("");
  try{
   const res=await fetch(API+"/api/orders",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({symbol,side,quantity:Number(quantity)})});
   const data=await res.json();if(!res.ok)throw new Error(data.detail||"Order rejected.");
   setNotice(side.toUpperCase()+" filled: "+qty(Number(data.quantity))+" "+data.symbol+" at "+inr(Number(data.price))+".");
   await load(token);setTab("orders");
  }catch(e){setError(e instanceof Error?e.message:"Order failed.");}finally{setBusy(false);}
 }
 async function askAI(){
  if(!prompt.trim()||aiBusy)return;setAiBusy(true);setAnswer("");
  try{
   const {data,error}=await supabase.functions.invoke("fixo-ai",{body:{messages:[{role:"user",content:prompt}],model:aiModel,task:aiTask}});
   if(error)throw new Error(error.message||"AI Edge Function request failed.");
   if(data?.error)throw new Error(data.error);
   setAnswer(data.answer+"\n\nModel: "+data.model+(data.fallbackUsed?" (fallback used)":""));
  }catch(e){setAnswer(e instanceof Error?e.message:"Fixo AI unavailable.");}finally{setAiBusy(false);}
 }
 async function signOut(){await supabase.auth.signOut();router.replace("/auth");router.refresh();}

 return <main className="dashboard-shell">
  <header className="dashboard-topbar"><a className="brand" href="/dashboard"><span className="brand-mark">f.</span>fixo<span style={{color:"var(--green)"}}>.</span></a>
   <nav className="dashboard-nav"><a href="#overview">Overview</a><a href="#market">Markets</a><a href="#trade">Paper trade</a><a href="#ai">Fixo AI</a></nav>
   <div className="account-actions"><span className="pill"><span className="dot"/> Paper trading</span><span className="account-email">{email}</span><button className="secondary" onClick={signOut}><LogOut size={14}/> Sign out</button></div>
  </header>
  <section className="dash-heading" id="overview"><div><div className="eyebrow">Your market workspace</div><h1>Markets, made clearer.</h1><p className="sub">A practice portfolio for learning, research, and simulated trades.</p></div><button className="secondary" onClick={()=>token&&void load(token)}><RefreshCw size={14}/> Refresh data</button></section>
  {error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice success" role="status">{notice}</div>}
  <section className="grid stats">
   <div className="card"><div className="stat-label">Virtual cash <Wallet size={15}/></div><div className="stat-value">{inr(Number(portfolio?.portfolio.cash_balance||0))}</div><div className="small">Available simulated buying power</div></div>
   <div className="card"><div className="stat-label">Position value <Activity size={15}/></div><div className="stat-value">{inr(positionValue)}</div><div className="small">Based on latest fetched quotes</div></div>
   <div className="card"><div className="stat-label">Unrealized P&amp;L <ArrowUpRight size={15}/></div><div className={"stat-value "+(pnl>=0?"positive":"negative")}>{pnl>=0?"+":""}{inr(pnl)}</div><div className="small">Indicative; fees and taxes excluded</div></div>
   <div className="card"><div className="stat-label">Open positions <Wallet size={15}/></div><div className="stat-value">{positions.length.toString().padStart(2,"0")}</div><div className="small">Saved in your account</div></div>
  </section>
  <section className="grid dashboard-columns">
   <div className="card" id="market"><div className="card-head"><div><h2>Markets</h2><p className="sub">Yahoo Finance data · may be delayed</p></div><label className="market-search"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search instruments"/></label></div>
    <div className="market-row market-head"><span>Instrument</span><span className="price">Last price</span><span className="change">Change</span><span>Watch</span></div>
    {filtered.map(s=>{const q=quoteMap.get(s.symbol);const watched=watchlist.includes(s.symbol);return <div className="market-row" key={s.symbol}><div><div className="symbol">{s.company}</div><div className="company">{s.symbol} · {s.exchange}</div></div><div className="price">{q?inr(q.price):"—"}</div><div className={"change "+((q?.change_percent||0)>=0?"positive":"negative")}>{q?.change_percent==null?"—":(q.change_percent>=0?"+":"")+q.change_percent.toFixed(2)+"%"}</div><button className="watch-button" onClick={()=>void toggleWatch(s.symbol)}>{watched?"★":"☆"}</button></div>})}
    <p className="small data-footnote">{quotes[0]?.updated_at?"Last refresh: "+new Date(quotes[0].updated_at).toLocaleString():"No market refresh yet."} · Indicative prices, not executable exchange quotes.</p>
   </div>
   <aside className="card" id="trade"><div className="card-head"><div><h2>Paper order</h2><p className="sub">Simulated order execution</p></div><span className="pill">No real money</span></div>
    <div className="trade-toggle"><button className={side==="buy"?"buy-active":""} onClick={()=>setSide("buy")}><ArrowDownLeft size={15}/> Buy</button><button className={side==="sell"?"sell-active":""} onClick={()=>setSide("sell")}><ArrowUpRight size={15}/> Sell</button></div>
    <label className="field-label">Instrument<select value={symbol} onChange={e=>setSymbol(e.target.value)}>{SYMBOLS.filter(s=>s.symbol!=="NIFTY50"&&s.symbol!=="SENSEX").map(s=><option key={s.symbol} value={s.symbol}>{s.symbol+" — "+s.company}</option>)}</select></label>
    <label className="field-label">Quantity<input type="number" min="0.000001" max="1000000" step="any" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <div className="order-estimate"><span>Indicative price</span><strong>{quoteMap.get(symbol)?inr(quoteMap.get(symbol)!.price):"Refresh to load"}</strong><span>Estimated notional</span><strong>{quoteMap.get(symbol)&&Number(quantity)>0?inr(quoteMap.get(symbol)!.price*Number(quantity)):"—"}</strong></div>
    <button className={"order-submit "+side} onClick={()=>void placeOrder()} disabled={busy||!token||!Number.isFinite(Number(quantity))||Number(quantity)<=0}>{busy?"Submitting…":(side==="buy"?"Buy ":"Sell ")+symbol+" (simulated)"}</button>
    <p className="small risk-note">Orders use a backend-fetched quote and database checks. Yahoo data may be delayed; this is not brokerage execution.</p>
   </aside>
  </section>
  <section className="grid dashboard-columns lower-grid">
   <div className="card"><div className="card-head"><div><h2>Account activity</h2><p className="sub">Positions and completed simulated orders</p></div><div className="tabs"><button className={tab==="positions"?"tab selected":"tab"} onClick={()=>setTab("positions")}>Positions</button><button className={tab==="orders"?"tab selected":"tab"} onClick={()=>setTab("orders")}>Orders</button></div></div>
    <div className="table-scroll"><table><thead>{tab==="positions"?<tr><th>Symbol</th><th>Qty</th><th>Avg cost</th><th>Last price</th><th>Unrealized P&amp;L</th></tr>:<tr><th>Time</th><th>Instrument</th><th>Side</th><th>Qty</th><th>Price</th><th>Status</th></tr>}</thead>
    <tbody>{tab==="positions"?positions.map(p=>{const price=quoteMap.get(p.symbol)?.price||Number(p.average_price);const pl=(price-Number(p.average_price))*Number(p.quantity);return <tr key={p.id}><td>{p.symbol}</td><td>{qty(Number(p.quantity))}</td><td>{inr(Number(p.average_price))}</td><td>{inr(price)}</td><td className={pl>=0?"positive":"negative"}>{inr(pl)}</td></tr>}):orders.map(o=><tr key={o.id}><td>{new Date(o.created_at).toLocaleString()}</td><td>{o.symbol}</td><td className={o.side==="buy"?"positive":"negative"}>{o.side.toUpperCase()}</td><td>{qty(Number(o.quantity))}</td><td>{inr(Number(o.price))}</td><td>{o.status}</td></tr>)}
    {((tab==="positions"&&!positions.length)||(tab==="orders"&&!orders.length))&&<tr><td colSpan={6} className="empty-cell">{tab==="positions"?"No positions yet. Place a simulated buy order to begin.":"No orders recorded yet."}</td></tr>}</tbody></table></div>
   </div>
   <aside className="card ai-card" id="ai"><div className="card-head"><div className="ai-title"><div className="ai-icon"><Sparkles size={18}/></div><div><h2>Ask Fixo AI</h2><p className="sub">Finance research copilot</p></div></div><span className="pill">{aiBusy?"Thinking…":"AI"}</span></div>
    <label className="field-label">Model<select value={aiModel} onChange={e=>setAiModel(e.target.value)}>{FIXO_MODELS.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <label className="field-label">Task<select value={aiTask} onChange={e=>setAiTask(e.target.value as FixoTask)}><option value="fast">Fast response</option><option value="general">General finance</option><option value="reasoning">Deep reasoning</option><option value="character">Character chat</option></select></label>
    <label className="field-label">Your question<textarea rows={3} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Ask about diversification, market concepts, or risk."/></label>
    <button className="primary ai-submit" onClick={()=>void askAI()} disabled={aiBusy||!prompt.trim()}>{aiBusy?"Thinking…":"Ask Fixo AI ↗"}</button>
    {answer&&<div className="ai-answer" role="status">{answer}</div>}<p className="small risk-note">AI can be incorrect. Educational information only; the model does not execute orders.</p>
   </aside>
  </section>
  <footer className="footer"><span>© 2026 Fixo · AI Finance &amp; Paper Trading</span><span>Educational simulation only · No real-money trades</span></footer>
 </main>;
}
