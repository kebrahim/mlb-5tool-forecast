import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from '../firebase';
import { doc, getDoc, collection, onSnapshot, query, where, getDocs, updateDoc, setDoc } from 'firebase/firestore';
import { UserProfile, TeamLine, Contest, Entry, Selection } from '../types';
import { Trophy, Users, LayoutDashboard, Settings, ChevronRight, ChevronLeft, BarChart3, Lock, LogOut, Menu, EyeOff, Play, Calendar } from 'lucide-react';
import Drafting from './Drafting';
import Admin from './Admin';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'react-hot-toast';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const parseDate = (date: any): Date => {
  if (!date) return new Date();
  if (date.toDate && typeof date.toDate === 'function') return date.toDate();
  return new Date(date);
};

export default function Dashboard() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamLine[]>([]);
  const [contests, setContests] = useState<Contest[]>([]);
  const [activeContest, setActiveContest] = useState<Contest | null>(null);
  const [userEntry, setUserEntry] = useState<Entry | null>(null);
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);
  const [view, setView] = useState<'dashboard' | 'drafting' | 'admin'>('dashboard');
  const [dashboardView, setDashboardView] = useState<'overview' | 'detail'>('overview');
  const [selectedRival, setSelectedRival] = useState<{ user: UserProfile, entry: Entry } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!auth.currentUser) return;
    setCurrentUserEmail(auth.currentUser.email);

    // User Profile
    const unsubUser = onSnapshot(doc(db, 'users', auth.currentUser.uid), async (snap) => {
      try {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setUser({ uid: snap.id, ...data });
          
          // Auto-promote admin
          const isAdminEmail = auth.currentUser?.email?.toLowerCase() === 'kebrahim@gmail.com';
          if (isAdminEmail && data.role !== 'admin') {
            await updateDoc(doc(db, 'users', auth.currentUser!.uid), { role: 'admin' });
          }
        } else {
          // Initialize profile if missing
          const isAdminEmail = auth.currentUser?.email?.toLowerCase() === 'kebrahim@gmail.com';
          const role = isAdminEmail ? 'admin' : 'player';
          await setDoc(doc(db, 'users', auth.currentUser!.uid), {
            display_name: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'New Player',
            email: auth.currentUser?.email || '',
            total_cp: 0,
            role: role
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${auth.currentUser?.uid}`);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${auth.currentUser?.uid}`);
    });

    // Teams
    const unsubTeams = onSnapshot(collection(db, 'team_lines'), (snap) => {
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() } as TeamLine)).sort((a, b) => a.team_name.localeCompare(b.team_name)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'team_lines');
    });

    // Contests
    const unsubContests = onSnapshot(collection(db, 'contests'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Contest));
      setContests(list);
      
      setActiveContest(prev => {
        if (prev) {
          const current = list.find(c => c.id === prev.id);
          if (current && current.is_active) {
            return current;
          }
        }
        const defaultContest = list.find(c => c.id === 'april_2026' && c.is_active) || list.find(c => c.is_active) || null;
        return defaultContest;
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'contests');
    });

    // Leaderboard
    const unsubLeaderboard = onSnapshot(collection(db, 'users'), (snap) => {
      setLeaderboard(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)).sort((a, b) => b.total_cp - a.total_cp));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return () => {
      unsubUser();
      unsubTeams();
      unsubContests();
      unsubLeaderboard();
    };
  }, []);

  useEffect(() => {
    if (!auth.currentUser || !activeContest) return;
    setUserEntry(null);
    const unsubEntry = onSnapshot(doc(db, 'contests', activeContest.id, 'entries', auth.currentUser.uid), (snap) => {
      if (snap.exists()) setUserEntry(snap.data() as Entry);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `contests/${activeContest.id}/entries/${auth.currentUser?.uid}`);
    });
    return () => unsubEntry();
  }, [activeContest?.id]);

  const showRival = async (rival: UserProfile) => {
    if (!activeContest) return;
    
    const isAdminUser = user?.role === 'admin' || currentUserEmail?.toLowerCase() === 'kebrahim@gmail.com';
    const contestLocked = parseDate(activeContest.start_time).getTime() < Date.now();

    if (!contestLocked && !isAdminUser && rival.uid !== auth.currentUser?.uid) {
      toast.error("Rival picks are hidden until the contest starts!", {
        icon: <EyeOff className="text-rose-500" />,
        style: {
          borderRadius: '12px',
          background: '#0f172a',
          color: '#fff',
          border: '1px solid #1e293b'
        }
      });
      return;
    }

    try {
      const entryRef = doc(db, 'contests', activeContest.id, 'entries', rival.uid);
      const snap = await getDoc(entryRef);
      if (snap.exists()) {
        setSelectedRival({ user: rival, entry: snap.data() as Entry });
      } else {
        toast.error(`${rival.display_name} hasn't saved a slip yet.`);
      }
    } catch (error) {
      console.error("Error fetching rival entry:", error);
      toast.error("Unable to view rival picks at this time.");
    }
  };

  const isLocked = activeContest ? parseDate(activeContest.start_time).getTime() < Date.now() : false;

  const formatMetric = (key: string) => {
    if (key.toLowerCase() === 'hrs') return 'Home Runs';
    return key.toUpperCase();
  };

  const contestsWithMyTurn = useMemo(() => {
    return contests.filter(c => {
      if (!c.is_active || !c.is_draft || c.draft_status !== 'in_progress' || !c.draft_order) return false;
      const numPlayers = c.draft_order.length;
      const currentTurnIndex = c.current_turn_index || 0;
      const round = Math.floor(currentTurnIndex / (numPlayers || 1));
      const indexInRound = currentTurnIndex % (numPlayers || 1);
      const isSnakeRound = round % 2 === 1;
      const activePlayerUid = isSnakeRound 
          ? c.draft_order[numPlayers - 1 - indexInRound]
          : c.draft_order[indexInRound];
      return activePlayerUid === auth.currentUser?.uid;
    });
  }, [contests]);

  const isMyTurn = contestsWithMyTurn.length > 0;

  const getContestStatus = (c: Contest) => {
    const now = new Date();
    const start = parseDate(c.start_time);
    const end = parseDate(c.end_time);

    if (c.is_draft) {
      if (c.draft_status === 'completed') {
        if (now > end) return { label: 'Completed', color: 'text-slate-500 bg-slate-500/10' };
        if (now > start) return { label: 'Live', color: 'text-emerald-500 bg-emerald-500/10' };
        return { label: 'Drafted', color: 'text-blue-500 bg-blue-500/10' };
      }
      if (c.draft_status === 'in_progress') return { label: 'Drafting', color: 'text-amber-500 bg-amber-500/10' };
      return { label: 'Upcoming', color: 'text-slate-400 bg-slate-400/10' };
    } else {
      if (now > end) return { label: 'Completed', color: 'text-slate-500 bg-slate-500/10' };
      if (now > start) return { label: 'Live', color: 'text-emerald-500 bg-emerald-500/10' };
      return { label: 'Open', color: 'text-amber-500 bg-amber-500/10' };
    }
  };

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col lg:flex-row overflow-hidden">
      {/* Mobile Top Bar */}
      <div className="lg:hidden bg-slate-900 border-b border-slate-800 p-4 flex items-center justify-between z-50">
        <div className="flex items-center gap-3">
          <span className="text-xl">⚾</span>
          <span className="font-black text-sm bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
            MLB 5-TOOL
          </span>
        </div>
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"
        >
          <Menu size={24} />
        </button>
      </div>

      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[60] lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ 
          width: isMobile ? 280 : (isCollapsed ? 80 : 256),
          x: isMobile ? (isSidebarOpen ? 0 : -280) : 0
        }}
        className={`bg-slate-900 border-r border-slate-800 flex flex-col p-4 fixed lg:sticky top-0 left-0 h-screen z-[70] ${isMobile ? 'shadow-2xl' : ''}`}
      >
        <div className="mb-8 lg:mb-12 flex items-center justify-between px-2">
          {!isCollapsed && (
            <motion.h1 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-lg font-black flex items-center gap-3 leading-tight"
            >
              <span className="text-2xl drop-shadow-lg">⚾</span>
              <span className="bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
                MLB 5-TOOL<br />FORECAST
              </span>
            </motion.h1>
          )}
          {isCollapsed && (
            <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center font-black shrink-0 text-white">5TF</div>
          )}
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
          >
            {isCollapsed ? <Menu size={20} /> : <ChevronLeft size={20} />}
          </button>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden p-2 hover:bg-slate-800 rounded-lg text-slate-400"
          >
            <ChevronLeft size={24} />
          </button>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto no-scrollbar">
          <button 
            onClick={() => {
              setView('dashboard');
              setDashboardView('overview');
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all ${view === 'dashboard' && dashboardView === 'overview' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
            title="Dashboard"
          >
            <LayoutDashboard size={24} className="shrink-0" />
            {!isCollapsed && <span className="font-bold truncate">Dashboard</span>}
          </button>
          <button 
            onClick={() => {
              setView('drafting');
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all ${view === 'drafting' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
            title="Drafting Room"
          >
            <BarChart3 size={24} className="shrink-0" />
            {!isCollapsed && <span className="font-bold truncate">Drafting Room</span>}
          </button>
          {(user?.role === 'admin' || currentUserEmail?.toLowerCase() === 'kebrahim@gmail.com') && (
            <button 
              onClick={() => {
                setView('admin');
                setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all ${view === 'admin' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
              title="Admin Panel"
            >
              <Settings size={24} className="shrink-0" />
              {!isCollapsed && <span className="font-bold truncate">Admin Panel</span>}
            </button>
          )}

          {!isCollapsed && contests.length > 0 && (
            <div className="mt-8 px-2">
              <h3 className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 mb-4 px-2">Active Contests</h3>
              <div className="space-y-2">
                {contests.filter(c => c.is_active).map(contest => (
                  <button
                    key={contest.id}
                    onClick={() => {
                      setActiveContest(contest);
                      setDashboardView('detail');
                      setView('dashboard');
                      setIsSidebarOpen(false);
                    }}
                    className={`w-full text-left p-3 rounded-xl transition-all border ${
                      activeContest?.id === contest.id && dashboardView === 'detail' && view === 'dashboard'
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-500 shadow-lg shadow-emerald-500/5' 
                        : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-bold truncate">{contest.theme_name}</div>
                      <div className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest shrink-0 ${getContestStatus(contest).color}`}>
                        {getContestStatus(contest).label}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="text-[9px] uppercase tracking-widest opacity-50 font-mono">{formatMetric(contest.metric_key)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>

        <div className="mt-auto space-y-4">
          <button 
            onClick={() => auth.signOut()}
            className="w-full flex items-center gap-4 p-3 rounded-xl text-rose-500 hover:bg-rose-500/10 transition-all"
            title="Logout"
          >
            <LogOut size={24} className="shrink-0" />
            {!isCollapsed && <span className="font-bold truncate">Logout</span>}
          </button>

          <div className="p-2 bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center font-bold text-emerald-500 shrink-0">
                {user?.display_name?.[0]}
              </div>
              {!isCollapsed && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="overflow-hidden"
                >
                  <div className="text-sm font-bold truncate">{user?.display_name}</div>
                  <div className="text-[10px] text-slate-500 truncate">{currentUserEmail}</div>
                  <div className="text-[10px] text-emerald-500 uppercase tracking-widest font-bold">{user?.role}</div>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative h-full">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full h-full"
            >
              <div className="w-full h-full overflow-y-auto no-scrollbar">
                <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-12">
                  {dashboardView === 'overview' ? (
                    <>
                      {/* Your Turn Banner */}
                      {isMyTurn && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="bg-amber-500 p-4 md:p-6 rounded-[1.5rem] md:rounded-[2rem] border border-amber-400 shadow-xl shadow-amber-500/20 flex flex-col sm:flex-row items-center justify-between gap-4 md:gap-6"
                        >
                          <div className="flex items-center gap-4 md:gap-6">
                            <div className="w-12 h-12 md:w-16 md:h-16 bg-slate-950/20 rounded-xl md:rounded-2xl flex items-center justify-center text-slate-950 shrink-0">
                              <Play size={24} className="md:w-8 md:h-8" />
                            </div>
                            <div>
                              <div className="text-[8px] md:text-[10px] font-black text-slate-950/60 uppercase tracking-[0.2em]">Action Required</div>
                              <h3 className="text-lg md:text-2xl font-black text-slate-950 leading-tight">IT'S YOUR TURN TO PICK!</h3>
                              <p className="text-slate-950/70 text-xs md:text-sm font-bold">You are on the clock in {contestsWithMyTurn[0].theme_name}</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => {
                              setActiveContest(contestsWithMyTurn[0]);
                              setView('drafting');
                            }}
                            className="w-full sm:w-auto px-6 md:px-8 py-3 md:py-4 bg-slate-950 text-white text-xs md:text-sm font-black rounded-xl hover:bg-slate-800 transition-all active:scale-95 whitespace-nowrap"
                          >
                            GO TO DRAFT ROOM
                          </button>
                        </motion.div>
                      )}

                      {/* No Contests Found State */}
                      {contests.filter(c => c.is_active).length === 0 && (
                        <div className="bg-slate-900 p-12 rounded-[2.5rem] border border-dashed border-slate-800 text-center max-w-2xl mx-auto">
                          <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center text-emerald-500 mx-auto mb-6">
                            <Trophy size={40} />
                          </div>
                          <h2 className="text-3xl font-black text-white mb-4">No Contests Found</h2>
                          <p className="text-slate-400 mb-8 leading-relaxed">
                            It looks like the database hasn't been initialized yet. 
                            { (user?.role === 'admin' || currentUserEmail?.toLowerCase() === 'kebrahim@gmail.com') ? 
                              " As an admin, you can seed the initial data (including the April Sprint) right now." : 
                              " Please wait for an administrator to initialize the season." }
                          </p>
                          { (user?.role === 'admin' || currentUserEmail?.toLowerCase() === 'kebrahim@gmail.com') && (
                            <button 
                              onClick={() => setView('admin')}
                              className="px-10 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl shadow-lg shadow-emerald-900/40 transition-all active:scale-95 flex items-center justify-center gap-3 mx-auto"
                            >
                              <Settings size={20} />
                              GO TO ADMIN PANEL
                            </button>
                          )}
                        </div>
                      )}

                      {/* Championship Standings */}
                      <section className="space-y-4 md:space-y-6">
                        <div className="flex items-center justify-between">
                          <h2 className="text-xl md:text-2xl font-black text-white flex items-center gap-3">
                            <Trophy className="text-amber-500" size={24} />
                            CHAMPIONSHIP STANDINGS
                          </h2>
                          <div className="hidden sm:block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Season 2026</div>
                        </div>
                        
                        <div className="bg-slate-900 rounded-[1.5rem] md:rounded-[2.5rem] border border-slate-800 overflow-hidden shadow-2xl">
                          <div className="grid grid-cols-12 px-4 md:px-8 py-3 md:py-4 bg-slate-950/50 border-b border-slate-800 text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest">
                            <div className="col-span-2 md:col-span-1">Rank</div>
                            <div className="col-span-6 md:col-span-7">Contestant</div>
                            <div className="col-span-4 text-right">Total CP</div>
                          </div>
                          <div className="divide-y divide-slate-800/50">
                            {leaderboard.map((player, idx) => {
                              const rank = leaderboard.findIndex(p => p.total_cp === player.total_cp) + 1;
                              return (
                                <div 
                                  key={player.uid}
                                  className="grid grid-cols-12 px-4 md:px-8 py-3 md:py-5 items-center hover:bg-slate-800/30 transition-colors group"
                                >
                                  <div className="col-span-2 md:col-span-1 font-mono text-slate-500 text-xs md:text-sm">{rank}</div>
                                  <div className="col-span-6 md:col-span-7 flex items-center gap-3 md:gap-4">
                                    <div className="w-8 h-8 md:w-10 md:h-10 bg-slate-950 rounded-xl md:rounded-2xl flex items-center justify-center font-black text-emerald-500 border border-slate-800 group-hover:border-emerald-500/50 transition-colors shrink-0 text-xs md:text-base">
                                      {player.display_name?.[0]}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                      <span className="font-black text-white group-hover:text-emerald-500 transition-colors truncate text-xs md:text-base">{player.display_name}</span>
                                      <span className="text-[8px] md:text-[10px] text-slate-500 uppercase tracking-widest font-bold truncate">{player.role}</span>
                                    </div>
                                  </div>
                                  <div className="col-span-4 text-right">
                                    <span className="text-lg md:text-2xl font-black text-emerald-500 tabular-nums tracking-tighter">{player.total_cp}</span>
                                    <span className="text-[8px] md:text-[10px] font-black text-slate-500 ml-1 md:ml-2">CP</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </section>

                      {/* Contest List */}
                      <section className="space-y-4 md:space-y-6">
                        <div className="flex items-center justify-between">
                          <h2 className="text-xl md:text-2xl font-black text-white flex items-center gap-3">
                            <LayoutDashboard className="text-blue-500" size={24} />
                            AVAILABLE CONTESTS
                          </h2>
                          <div className="hidden sm:block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Active & Upcoming</div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                          {contests.filter(c => c.is_active).map(contest => {
                            const status = getContestStatus(contest);
                            return (
                              <button
                                key={contest.id}
                                onClick={() => {
                                  setActiveContest(contest);
                                  setDashboardView('detail');
                                }}
                                className="p-4 md:p-6 bg-slate-900 rounded-[1.5rem] md:rounded-[2rem] border border-slate-800 hover:border-emerald-500/50 transition-all text-left group relative overflow-hidden shadow-xl"
                              >
                                <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <div className="relative z-10 flex flex-col h-full">
                                  <div className="flex justify-between items-start mb-3 md:mb-4">
                                    <div className={`px-2 md:px-3 py-0.5 md:py-1 rounded-lg md:rounded-xl text-[8px] md:text-[10px] font-black uppercase tracking-widest ${status.color}`}>
                                      {status.label}
                                    </div>
                                    <div className="w-8 h-8 md:w-10 md:h-10 bg-slate-950 rounded-lg md:rounded-xl flex items-center justify-center text-slate-500 group-hover:text-emerald-500 transition-colors">
                                      <ChevronRight size={16} className="md:w-5 md:h-5" />
                                    </div>
                                  </div>
                                  <h3 className="text-lg md:text-xl font-black text-white mb-2 group-hover:text-emerald-500 transition-colors">{contest.theme_name}</h3>
                                  
                                  <div className="flex flex-col gap-1 mb-3 md:mb-4">
                                    <div className="flex items-center gap-2 text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                      <Calendar size={10} className="text-emerald-500 md:w-3 md:h-3" />
                                      <span>Starts: {parseDate(contest.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                      <Calendar size={10} className="text-rose-500 md:w-3 md:h-3" />
                                      <span>Ends: {parseDate(contest.end_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                    </div>
                                  </div>

                                  <div className="mt-auto flex items-center gap-3 md:gap-4 text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                    <span>{formatMetric(contest.metric_key)}</span>
                                    <span className="w-1 h-1 bg-slate-700 rounded-full" />
                                    <span>{contest.selection_limit} Teams</span>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    </>
                  ) : (
                    <div className="space-y-8">
                      <button 
                        onClick={() => setDashboardView('overview')}
                        className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-white uppercase tracking-[0.2em] transition-colors"
                      >
                        <ChevronLeft size={16} />
                        Back to Overview
                      </button>

                      {activeContest && (
                        <>
                          <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl relative overflow-hidden">
                            <div className="absolute inset-0 bg-emerald-500/5" />
                            <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-8">
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-4">
                                  <div className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest ${getContestStatus(activeContest).color}`}>
                                    {getContestStatus(activeContest).label}
                                  </div>
                                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                                    {activeContest.is_draft ? 'Snake Draft' : 'Selection Room'}
                                  </span>
                                </div>
                                <h1 className="text-4xl font-black text-white mb-4">{activeContest.theme_name}</h1>
                                {activeContest.description && (
                                  <p className="text-slate-400 text-sm mb-6 max-w-2xl leading-relaxed">
                                    {activeContest.description}
                                  </p>
                                )}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                                  <div>
                                    <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Metric</div>
                                    <div className="text-xs font-bold text-emerald-500 uppercase">{formatMetric(activeContest.metric_key)}</div>
                                  </div>
                                  <div>
                                    <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Limit</div>
                                    <div className="text-xs font-bold text-white">{activeContest.selection_limit} Teams</div>
                                  </div>
                                  <div>
                                    <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Starts</div>
                                    <div className="text-xs font-bold text-white">{parseDate(activeContest.start_time).toLocaleDateString()}</div>
                                  </div>
                                  <div>
                                    <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Ends</div>
                                    <div className="text-xs font-bold text-white">{parseDate(activeContest.end_time).toLocaleDateString()}</div>
                                  </div>
                                </div>
                              </div>

                              {!isLocked && (
                                <button 
                                  onClick={() => setView('drafting')}
                                  className="w-full md:w-auto px-10 py-5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl shadow-lg shadow-emerald-900/40 transition-all active:scale-95 flex items-center justify-center gap-3"
                                >
                                  <Play size={20} />
                                  {userEntry ? 'EDIT PICKS' : 'ENTER CONTEST'}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            <div className="lg:col-span-2 space-y-6">
                              <h2 className="text-xl font-black text-white flex items-center gap-3">
                                <ChevronRight className="text-emerald-500" size={20} />
                                MY ACTIVE SLIP
                              </h2>
                              
                              {userEntry ? (
                                <div className="space-y-4">
                                  {[...userEntry.selections].sort((a, b) => b.chips - a.chips).map(sel => {
                                    const team = teams.find(t => t.id === sel.team_id);
                                    if (!team) return null;
                                    
                                    if (activeContest.metric_key !== 'wins') {
                                      const metricValue = team.stats[activeContest.metric_key as keyof typeof team.stats] || 0;
                                      return (
                                        <div key={sel.team_id} className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-lg flex justify-between items-center">
                                          <div>
                                            <h3 className="font-black text-lg text-white">{team.team_name}</h3>
                                            <div className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black">
                                              {activeContest.is_draft ? 'Draft Pick' : 'Selection'}
                                            </div>
                                          </div>
                                          <div className="text-right">
                                            <div className="text-3xl font-black text-emerald-500 tabular-nums">
                                              {metricValue}
                                            </div>
                                            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-black">
                                              {formatMetric(activeContest.metric_key)}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    }

                                    const progress = (team.stats.wins / team.ou_line) * 100;
                                    const isWinning = sel.side === 'over' ? team.stats.wins > team.ou_line : team.stats.wins < team.ou_line;

                                    return (
                                      <div key={sel.team_id} className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-lg">
                                        <div className="flex justify-between items-center mb-4">
                                          <div>
                                            <h3 className="font-black text-lg text-white">{team.team_name}</h3>
                                            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-black">
                                              {sel.side} {team.ou_line} • {sel.chips} Chips
                                            </div>
                                          </div>
                                          <div className="text-right">
                                            <div className={`text-2xl font-black tabular-nums ${isWinning ? 'text-emerald-500' : 'text-rose-500'}`}>
                                              {team.stats.wins} - {team.stats.losses}
                                            </div>
                                            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Current Record</div>
                                          </div>
                                        </div>
                                        <div className="relative h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                                          <div 
                                            className={`absolute top-0 left-0 h-full transition-all duration-1000 ${isWinning ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`}
                                            style={{ width: `${Math.min(progress, 100)}%` }}
                                          />
                                          <div 
                                            className="absolute top-0 h-full border-r-2 border-white/20 z-10"
                                            style={{ left: '50%' }}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="bg-slate-900 p-12 rounded-[2rem] border border-dashed border-slate-800 text-center">
                                  <p className="text-slate-500 mb-6 text-sm">No active entry found for this contest.</p>
                                  {!isLocked && (
                                    <button 
                                      onClick={() => setView('drafting')}
                                      className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-black rounded-xl transition-all"
                                    >
                                      Enter Contest
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="space-y-6">
                              <h2 className="text-xl font-black text-white flex items-center gap-3">
                                <Users className="text-emerald-500" size={20} />
                                CONTESTANTS
                              </h2>
                              <div className="bg-slate-900 rounded-[2rem] border border-slate-800 overflow-hidden shadow-2xl">
                                {leaderboard.map((player, idx) => (
                                  <button
                                    key={player.uid}
                                    onClick={() => showRival(player)}
                                    className="w-full flex items-center justify-between p-4 hover:bg-slate-800 transition-colors border-b border-slate-800/50 last:border-0 group"
                                  >
                                    <div className="flex items-center gap-4">
                                      <span className="text-[10px] font-mono text-slate-500 w-4">{idx + 1}</span>
                                      <div className="w-8 h-8 bg-slate-950 rounded-xl flex items-center justify-center text-[10px] font-black text-emerald-500 border border-slate-800 group-hover:border-emerald-500/50 transition-colors">
                                        {player.display_name?.[0]}
                                      </div>
                                      <span className="font-bold text-sm text-slate-200 group-hover:text-white transition-colors">{player.display_name}</span>
                                    </div>
                                    <ChevronRight size={14} className="text-slate-600 group-hover:text-emerald-500 transition-colors" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'drafting' && activeContest && (
            <div key="drafting" className="w-full h-full">
              <Drafting 
                contest={activeContest} 
                contests={contests}
                onContestChange={setActiveContest}
              />
            </div>
          )}

          {view === 'admin' && (
            <motion.div 
              key="admin"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full h-full"
            >
              <div className="w-full h-full overflow-y-auto">
                <div className="p-4 md:p-8">
                  <Admin />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rival Modal */}
        <AnimatePresence>
          {selectedRival && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="w-full max-w-2xl bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden"
              >
                <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-emerald-600 rounded-full flex items-center justify-center font-bold text-xl">
                      {selectedRival.user.display_name?.[0]}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">{selectedRival.user.display_name}'s Slip</h3>
                      <p className="text-xs text-slate-500 uppercase tracking-widest">Locked Entry</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedRival(null)}
                    className="p-2 hover:bg-slate-800 rounded-full text-slate-400"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                  {[...selectedRival.entry.selections].sort((a, b) => b.chips - a.chips).map(sel => {
                    const team = teams.find(t => t.id === sel.team_id);
                    if (!team) return null;
                    
                    if (activeContest.metric_key !== 'wins') {
                      const metricValue = team.stats[activeContest.metric_key as keyof typeof team.stats] || 0;
                      return (
                        <div key={sel.team_id} className="flex justify-between items-center p-4 bg-slate-950 rounded-xl border border-slate-800">
                          <div>
                            <div className="font-bold">{team.team_name}</div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-widest">
                              {activeContest.is_draft ? 'Draft Pick' : 'Selection'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-black text-emerald-500">{metricValue} {formatMetric(activeContest.metric_key)}</div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={sel.team_id} className="flex justify-between items-center p-4 bg-slate-950 rounded-xl border border-slate-800">
                        <div>
                          <div className="font-bold">{team.team_name}</div>
                          <div className="text-[10px] text-slate-500 uppercase tracking-widest">
                            {sel.side} {team.ou_line} • {sel.chips} Chips
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-black text-emerald-500">{team.stats.wins}W</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
