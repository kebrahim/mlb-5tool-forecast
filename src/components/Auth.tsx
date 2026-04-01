import React, { useState } from 'react';
import { auth, db } from '../firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { toast } from 'react-hot-toast';
import { LogIn, UserPlus, LogOut } from 'lucide-react';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        toast.success('Welcome back!');
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Initialize user profile
        const role = email === 'kebrahim@gmail.com' ? 'admin' : 'player';
        await setDoc(doc(db, 'users', user.uid), {
          display_name: displayName,
          email: email,
          total_cp: 0,
          role: role
        });
        toast.success('Account created successfully!');
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-field p-4 relative overflow-hidden">
      {/* Decorative Stitches */}
      <div className="absolute -top-20 -left-20 w-64 h-64 border-8 border-dashed border-[var(--color-stitch-red)] rounded-full opacity-20" />
      <div className="absolute -bottom-20 -right-20 w-64 h-64 border-8 border-dashed border-[var(--color-stitch-red)] rounded-full opacity-20" />
      
      <div className="w-full max-w-md bg-white p-6 md:p-8 rounded-2xl border-4 border-stitch shadow-2xl relative z-10">
        <div className="mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-varsity text-slate-900 uppercase tracking-tighter leading-none">
            MLB 5-TOOL <br/>
            <span className="text-[var(--color-stitch-red)]">FORECAST</span>
          </h1>
          <div className="mt-2 h-1 w-24 bg-[var(--color-stitch-red)] mx-auto rounded-full" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {!isLogin && (
            <div>
              <label className="block text-xs font-varsity text-slate-500 mb-1 uppercase tracking-widest">Player Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-[var(--color-stitch-red)] transition-colors font-scorebook"
                placeholder="ROOKIE NAME"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-varsity text-slate-500 mb-1 uppercase tracking-widest">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-[var(--color-stitch-red)] transition-colors font-scorebook"
              placeholder="PLAYER@BALLPARK.COM"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-varsity text-slate-500 mb-1 uppercase tracking-widest">Secret Code</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-[var(--color-stitch-red)] transition-colors font-scorebook"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-varsity uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg active:transform active:scale-95"
          >
            {loading ? 'WARMING UP...' : isLogin ? <><LogIn size={20} /> STEP TO THE PLATE</> : <><UserPlus size={20} /> SIGN THE CONTRACT</>}
          </button>
        </form>

        <div className="mt-8 text-center border-t-2 border-slate-100 pt-6">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-[var(--color-stitch-red)] hover:text-red-700 text-xs font-varsity uppercase tracking-widest transition-colors"
          >
            {isLogin ? "Need a roster spot? Sign Up" : "Already on the team? Login"}
          </button>
        </div>
      </div>
      
      <p className="mt-8 text-white/60 font-varsity text-[10px] uppercase tracking-[0.3em]">Official Forecast System v2026</p>
    </div>
  );
}
