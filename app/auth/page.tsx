"use client";
import { FormEvent,useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
export default function AuthPage(){
 const router=useRouter(); const [mode,setMode]=useState<"signin"|"signup">("signin");
 const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [name,setName]=useState("");
 const [busy,setBusy]=useState(false); const [message,setMessage]=useState(""); const [error,setError]=useState("");
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError("");setMessage("");
  try{
   const supabase=createClient();
   if(mode==="signup"){
    const {data,error:authError}=await supabase.auth.signUp({email:email.trim(),password,options:{data:{display_name:name.trim()}}});
    if(authError)throw authError;
    if(data.session)router.push("/dashboard");else setMessage("Account request created. Check your email to confirm, then sign in.");
   }else{
    const {error:authError}=await supabase.auth.signInWithPassword({email:email.trim(),password});
    if(authError)throw authError;router.push("/dashboard");router.refresh();
   }
  }catch(e){setError(e instanceof Error?e.message:"Authentication failed. Check your Supabase settings.");}
  finally{setBusy(false);}
 }
 return <main className="auth-shell">
  <div className="auth-top"><Link className="brand" href="/"><span className="brand-mark">f.</span>fixo<span style={{color:"var(--green)"}}>.</span></Link><span className="pill">PAPER TRADING ONLY</span></div>
  <section className="auth-card"><div className="eyebrow">Your market workspace</div><h1>{mode==="signin"?"Welcome back.":"Build your first portfolio."}</h1>
   <p className="sub">{mode==="signin"?"Sign in to access your virtual portfolio, watchlist, and research tools.":"Create an account to start with ₹1,00,000 in virtual cash."}</p>
   <div className="auth-switch"><button className={mode==="signin"?"selected":""} onClick={()=>{setMode("signin");setError("");setMessage("");}}>Sign in</button><button className={mode==="signup"?"selected":""} onClick={()=>{setMode("signup");setError("");setMessage("");}}>Create account</button></div>
   <form onSubmit={submit} className="auth-form">
    {mode==="signup"&&<label>Display name<input autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" maxLength={80} required/></label>}
    <label>Email address<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required/></label>
    <label>Password<input type="password" autoComplete={mode==="signin"?"current-password":"new-password"} value={password} onChange={e=>setPassword(e.target.value)} minLength={8} placeholder="At least 8 characters" required/></label>
    {error&&<div className="notice error" role="alert">{error}</div>}{message&&<div className="notice" role="status">{message}</div>}
    <button className="primary auth-submit" disabled={busy}>{busy?"Please wait…":mode==="signin"?"Sign in securely ↗":"Create account ↗"}</button>
   </form><p className="small auth-disclaimer">Fixo uses simulated trades only. Never enter banking credentials or broker passwords here.</p>
  </section><footer className="footer"><span>© 2026 Fixo</span><span>Educational simulation · Not investment advice</span></footer>
 </main>;
}
