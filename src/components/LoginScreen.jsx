import { useState } from 'react';
import { C } from '../utils/constants.js';
import { supabase } from '../utils/supabase.js';
import { Btn, Spinner } from './ui/index.js';

export default function LoginScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const inp = (val, set, type = "text", placeholder = "") => (
    <input type={type} value={val} onChange={e => set(e.target.value)} placeholder={placeholder}
      style={{width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: "10px 14px", color: C.text, fontSize: 14, boxSizing: "border-box", marginBottom: 12, outline: "none"}}/>
  );

  const submit = async () => {
    setError(""); setLoading(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setDone(true);
    }
    setLoading(false);
  };

  return (
    <div style={{background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI',system-ui,sans-serif"}}>
      <div style={{width: "100%", maxWidth: 400, padding: 16}}>
        <div style={{textAlign: "center", marginBottom: 32}}>
          <div style={{fontSize: 10, color: C.accent, textTransform: "uppercase", letterSpacing: 3, marginBottom: 6}}>OBEL \u00B7 UWaterloo</div>
          <div style={{fontSize: 24, fontWeight: 700, color: C.text, marginBottom: 6}}>Biomechanics Dashboard</div>
          <div style={{fontSize: 13, color: C.muted}}>MVNX \u00B7 CSV \u00B7 LoadSOL \u00B7 WiDACS \u00B7 Cycle Analysis</div>
        </div>
        <div style={{background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28}}>
          {done ? (
            <div style={{textAlign: "center", color: C.accent}}>
              <div style={{fontSize: 30, marginBottom: 12}}>{"\u2713"}</div>
              <div style={{fontSize: 14, fontWeight: 600, marginBottom: 8}}>Check your email</div>
              <div style={{fontSize: 12, color: C.muted}}>A confirmation link has been sent to {email}.</div>
              <div style={{marginTop: 18}}><Btn active onClick={() => { setMode("login"); setDone(false); }}>Back to Sign In</Btn></div>
            </div>
          ) : (
            <>
              <div style={{display: "flex", gap: 4, marginBottom: 22, background: C.bg, borderRadius: 8, padding: 3}}>
                {["login", "register"].map(m => (
                  <button key={m} onClick={() => { setMode(m); setError(""); }}
                    style={{flex: 1, padding: "7px", borderRadius: 6, border: "none", cursor: "pointer",
                      background: mode === m ? C.card : "transparent", color: mode === m ? C.accent : C.muted,
                      fontSize: 12, fontWeight: mode === m ? 600 : 400}}>
                    {m === "login" ? "Sign In" : "Register"}
                  </button>
                ))}
              </div>
              {inp(email, setEmail, "email", "Email address")}
              {inp(password, setPassword, "password", "Password")}
              {error && <div style={{fontSize: 12, color: C.red, marginBottom: 12, padding: "8px 12px", background: C.red + "15", borderRadius: 6}}>{error}</div>}
              <button onClick={submit} disabled={loading || !email || !password}
                style={{width: "100%", padding: "11px", borderRadius: 8, border: "none", cursor: loading ? "wait" : "pointer",
                  background: C.accent, color: C.bg, fontSize: 14, fontWeight: 700, opacity: (loading || !email || !password) ? 0.6 : 1}}>
                {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
