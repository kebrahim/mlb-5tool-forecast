import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from '../firebase';
import { doc, getDoc, collection, onSnapshot, query, where, getDocs, updateDoc, setDoc, writeBatch, Timestamp } from 'firebase/firestore';
import { UserProfile, TeamLine, Contest, Entry, Selection } from '../types';
import { Trophy, Users, LayoutDashboard, Settings, ChevronRight, ChevronLeft, BarChart3, Lock, LogOut, Menu, EyeOff, Play, Calendar, AlertTriangle } from 'lucide-react';
import { MLB_TEAMS, DEFAULT_LINES } from '../mlbData';
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
  if (date instanceof Date) return date;
  if (typeof date.toDate === 'function') return date.toDate();
  if (date && typeof date === 'object') {
    if (typeof date.seconds === 'number') {
      return new Date(date.seconds * 1000);
    }
    if (typeof date._seconds === 'number') {
      return new Date(date._seconds * 1000);
    }
    if ('seconds' in date && typeof date.seconds === 'number') {
      return new Date(date.seconds * 1000);
    }
  }
  if (typeof date === 'string' || typeof date === 'number') {
    const d = new Date(date);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
};

export default function Dashboard() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamLine[]>([]);
  const [contests, setContests] = useState<Contest[]>([]);
  const [activeContest, setActiveContest] = useState<Contest | null>(null);
  const isBigBet = activeContest?.id === 'big-bet' || activeContest?.theme_name?.toLowerCase().includes('big bet');
  const [userEntry, setUserEntry] = useState<Entry | null>(null);
  const [allEntries, setAllEntries] = useState<Entry[]>([]);
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);
  const [view, setView] = useState<'dashboard' | 'drafting' | 'admin' | 'standings'>('dashboard');
  const [dashboardView, setDashboardView] = useState<'overview' | 'detail'>('overview');
  const [detailTab, setDetailTab] = useState<'my_slip' | 'standings'>('standings');
  const [selectedRival, setSelectedRival] = useState<{ user: UserProfile, entry: Entry } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [autoSeeding, setAutoSeeding] = useState(false);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [contestsLoaded, setContestsLoaded] = useState(false);

  useEffect(() => {
    const isAdmin = user?.role === 'admin' || currentUserEmail?.toLowerCase() === 'kebrahim@gmail.com';
    if (
      isAdmin &&
      teamsLoaded &&
      contestsLoaded &&
      teams.length === 0 &&
      contests.length === 0 &&
      !autoSeeding
    ) {
      const runAutoSeed = async () => {
        setAutoSeeding(true);
        const toastId = toast.loading('Database is empty. Automatically seeding MLB teams and contests...');
        try {
          const batch = writeBatch(db);

          // 1. Seed Teams
          MLB_TEAMS.forEach((team) => {
            const teamRef = doc(db, 'team_lines', team.id);
            batch.set(teamRef, {
              team_name: team.name,
              abbreviation: team.abbr,
              ou_line: DEFAULT_LINES[team.id] || 81.0,
              stats: { wins: 0, losses: 0, hrs: 0, ks: 0, stolenBases: 0, doublePlays: 0, caughtStealing: 0, errors: 0, defense: 0 },
              last_sync: new Date().toISOString()
            });
          });

          // 2. Seed Initial Season-Long Contest
          const seasonRef = doc(db, 'contests', 'season_2026');
          batch.set(seasonRef, {
            theme_name: 'Season 2026: Big Bet',
            description: 'Pick 5 teams to go OVER or UNDER their projected win totals. Use 100 confidence chips to weigh your picks.',
            metric_key: 'wins',
            start_time: Timestamp.fromDate(new Date('2026-03-25T20:00:00-04:00')),
            end_time: Timestamp.fromDate(new Date('2026-10-01T00:00:00Z')),
            is_active: true,
            selection_limit: 5,
            use_chips: true,
            is_draft: false
          }, { merge: true });

          // 3. Seed Monthly Sprints
          const monthlySprints = [
            { 
              id: 'april_2026', 
              name: 'April Sprint: HR Derby', 
              description: 'Draft 3 teams in a snake draft. The total home runs hit by your teams in April determines your score.',
              metric: 'hrs', 
              start: '2026-04-01T00:00:00-04:00', 
              end: '2026-05-01T00:00:00-04:00', 
              limit: 3, 
              chips: false, 
              draft: true 
            },
            { 
              id: 'may_2026', 
              name: 'May Strikeout King', 
              description: 'Draft 3 teams. Total strikeouts thrown by your pitching staff in May decides the winner!',
              metric: 'ks', 
              start: '2026-05-01T00:00:00-04:00', 
              end: '2026-06-01T00:00:00-04:00', 
              limit: 3, 
              chips: false, 
              draft: true 
            },
            { 
              id: 'june_2026', 
              name: 'June Sprint: Stolen Base Summer', 
              description: 'Draft 3 teams. Total Stolen Bases in June decides the winner!',
              metric: 'stolenBases', 
              start: '2026-06-01T00:00:00-04:00', 
              end: '2026-07-01T00:00:00-04:00', 
              limit: 3, 
              chips: false, 
              draft: true 
            },
            { 
              id: 'july_2026', 
              name: 'July Monthly Contest: Defensive Showdown', 
              description: 'Draft 3 teams. Total Defensive Score (Double Plays + Caught Stealing - Errors) in July decides the winner!',
              metric: 'defense', 
              start: '2026-07-01T00:00:00-04:00', 
              end: '2026-08-01T00:00:00-04:00', 
              limit: 3, 
              chips: false, 
              draft: true 
            },
          ];

          monthlySprints.forEach(sprint => {
            const sprintRef = doc(db, 'contests', sprint.id);
            batch.set(sprintRef, {
              theme_name: sprint.name,
              metric_key: sprint.metric,
              start_time: Timestamp.fromDate(new Date(sprint.start)),
              end_time: Timestamp.fromDate(new Date(sprint.end)),
              is_active: true,
              selection_limit: sprint.limit,
              use_chips: sprint.chips,
              is_draft: sprint.draft,
              draft_status: 'pending',
              current_turn_index: 0
            }, { merge: true });
          });

          // 4. Seed Settings
          const syncRef = doc(db, 'settings', 'mlb_sync');
          batch.set(syncRef, {
            enabled: false,
            last_updated: new Date().toISOString(),
            updated_by: auth.currentUser?.uid || 'system'
          }, { merge: true });

          await batch.commit();
          toast.success('Database initialized successfully!', { id: toastId });
        } catch (err: any) {
          console.error('Auto-seed failed:', err);
          toast.error(`Auto-seed failed: ${err.message}`, { id: toastId });
        } finally {
          setAutoSeeding(false);
        }
      };
      runAutoSeed();
    }
  }, [user, currentUserEmail, teamsLoaded, contestsLoaded, teams.length, contests.length, autoSeeding]);

  useEffect(() => {
    if (view === 'standings' && !activeContest && contests.length > 0) {
      const firstActive = contests.find(c => c.is_active);
      if (firstActive) setActiveContest(firstActive);
    }
  }, [view, activeContest, contests]);

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
      setTeamsLoaded(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'team_lines');
      setTeamsLoaded(true);
    });

    // Contests
    const unsubContests = onSnapshot(collection(db, 'contests'), (snap) => {
      const mlbContestIds = ['season_2026', 'april_2026', 'may_2026', 'june_2026', 'july_2026'];
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Contest))
        .filter(c => mlbContestIds.includes(c.id));
      const sortedList = [...list].sort((a, b) => parseDate(a.end_time).getTime() - parseDate(b.end_time).getTime());
      setContests(sortedList);
      
      setActiveContest(prev => {
        if (prev) {
          const current = sortedList.find(c => c.id === prev.id);
          if (current) {
            return current;
          }
        }
        const defaultContest = sortedList.find(c => c.id === 'april_2026' && c.is_active) || sortedList.find(c => c.is_active) || null;
        return defaultContest;
      });
      setContestsLoaded(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'contests');
      setContestsLoaded(true);
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

  useEffect(() => {
    if (!activeContest) return;
    const unsubEntries = onSnapshot(collection(db, 'contests', activeContest.id, 'entries'), (snap) => {
      setAllEntries(snap.docs.map(d => ({ uid: d.id, ...d.data() } as Entry)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `contests/${activeContest.id}/entries`);
    });
    return () => unsubEntries();
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
    switch (key.toLowerCase()) {
      case 'hrs': return 'Home Runs';
      case 'ks': return 'Pitching Ks';
      case 'wins': return 'CP';
      case 'stolenbases': return 'Stolen Bases';
      case 'rbi': return 'RBIs';
      case 'avg': return 'Avg';
      case 'defense': return 'Defensive Score';
      case 'doubleplays': return 'Double Plays';
      case 'caughtstealing': return 'Caught Stealing';
      case 'errors': return 'Errors';
      default: return key.toUpperCase();
    }
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

  const ongoingDrafts = useMemo(() => {
    return contests.filter(c => c.is_active && c.is_draft && c.draft_status === 'in_progress');
  }, [contests]);
  
  const sortedEntries = useMemo(() => {
    if (!activeContest || teams.length === 0) return [];
    
    const scored = allEntries.map(entry => {
      let score = 0;
      const now = new Date();
      const isStarted = parseDate(activeContest.start_time) <= now;

      entry.selections.forEach(sel => {
        const team = teams.find(t => t.id === sel.team_id);
        if (team) {
          if (activeContest.metric_key === 'wins') {
            const endVal = activeContest.ending_stats?.[team.id];
            const wins = endVal !== undefined ? endVal : team.stats.wins;
            
            // For O/U, score is sum of chips for mathematically clinched picks
            const gamesRemaining = 162 - (team.stats.wins + team.stats.losses);
            const isClinched = sel.side === 'over' 
              ? wins > team.ou_line 
              : (wins + gamesRemaining) < team.ou_line;
            if (isClinched) {
              score += (activeContest.use_chips ? (sel.chips || 0) : 1);
            }
          } else {
            // For total count contests (drafts), score is sum of metric values
            const endVal = activeContest.ending_stats?.[team.id];
            const val = endVal !== undefined ? endVal : (team.stats[activeContest.metric_key as keyof typeof team.stats] || 0);
            const startVal = activeContest.starting_stats?.[team.id] || 0;
            score += isStarted ? Math.max(0, val - startVal) : 0;
          }
        }
      });
      return { ...entry, score };
    }).sort((a, b) => b.score - a.score);

    // Calculate ranks with ties
    let currentRank = 0;
    return scored.map((entry, index) => {
      if (index > 0 && entry.score < scored[index - 1].score) {
        currentRank = index;
      }
      return { ...entry, rank: currentRank };
    });
  }, [allEntries, teams, activeContest]);

  const getContestStatus = (c: Contest) => {
    const now = new Date();
    const start = parseDate(c.start_time);
    const end = parseDate(c.end_time);

    let statusIdentifier: 'completed' | 'live' | 'drafted' | 'drafting' | 'upcoming' | 'open' = 'upcoming';

    if (now > end) {
      statusIdentifier = 'completed';
    } else if (c.is_draft) {
      if (c.draft_status === 'completed') {
        if (now > start) statusIdentifier = 'live';
        else statusIdentifier = 'drafted';
      } else if (c.draft_status === 'in_progress') {
        statusIdentifier = 'drafting';
      } else {
        if (now > start) statusIdentifier = 'live';
        else statusIdentifier = 'upcoming';
      }
    } else {
      if (now > start) statusIdentifier = 'live';
      else statusIdentifier = 'open';
    }

    const configs = {
      completed: { label: 'Completed', color: 'text-slate-500 bg-slate-500/10' },
      live: { label: 'In Progress', color: 'text-emerald-500 bg-emerald-500/10' },
      drafted: { label: 'Drafted', color: 'text-blue-500 bg-blue-500/10' },
      drafting: { label: 'Drafting', color: 'text-amber-500 bg-amber-500/10' },
      upcoming: { label: 'Upcoming', color: 'text-slate-400 bg-slate-400/10' },
      open: { label: 'Open', color: 'text-amber-500 bg-amber-500/10' },
    };

    return { ...configs[statusIdentifier], statusType: statusIdentifier };
  };

  const getCPForRank = (rank: number) => {
    const points = [9, 6, 3, 0, 0];
    return points[rank] || 0;
  };

  return (
    <div className="h-screen bg-[var(--color-leather-white)] text-slate-900 flex flex-col lg:flex-row overflow-hidden font-sans">
      {/* Mobile Top Bar */}
      <div className="lg:hidden bg-white border-b-4 border-stitch p-4 flex items-center justify-between z-50 shadow-md">
        <div className="flex items-center gap-3">
          <span className="text-xl">⚾</span>
          <span className="font-varsity text-sm text-slate-900 uppercase tracking-tighter">
            MLB 5-TOOL
          </span>
        </div>
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"
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
        className={`bg-slate-900 border-r-4 border-stitch flex flex-col p-4 fixed lg:sticky top-0 left-0 h-screen z-[70] ${isMobile ? 'shadow-2xl' : ''}`}
      >
        <div className="mb-8 lg:mb-12 flex items-center justify-between px-2">
          {!isCollapsed && (
            <motion.h1 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-lg font-varsity flex items-center gap-3 leading-tight"
            >
              <span className="text-2xl drop-shadow-lg">⚾</span>
              <span className="text-white uppercase tracking-tighter">
                MLB 5-TOOL<br />FORECAST
              </span>
            </motion.h1>
          )}
          {isCollapsed && (
            <div className="w-10 h-10 bg-[var(--color-stitch-red)] rounded-lg flex items-center justify-center font-varsity shrink-0 text-white shadow-lg">5T</div>
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
          <div 
            onClick={() => {
              setView('dashboard');
              setDashboardView('overview');
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all cursor-pointer font-varsity uppercase tracking-widest text-[10px] ${view === 'dashboard' && dashboardView === 'overview' ? 'bg-[var(--color-stitch-red)] text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}
            title="Dashboard"
          >
            <LayoutDashboard size={20} className="shrink-0" />
            {!isCollapsed && <span className="truncate">Dashboard</span>}
          </div>
          <div 
            onClick={() => {
              setView('drafting');
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all cursor-pointer font-varsity uppercase tracking-widest text-[10px] ${view === 'drafting' ? 'bg-[var(--color-stitch-red)] text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}
            title="Drafting Room"
          >
            <BarChart3 size={20} className="shrink-0" />
            {!isCollapsed && <span className="truncate">Drafting Room</span>}
          </div>
          <div 
            onClick={() => {
              setView('standings');
              setIsSidebarOpen(false);
              if (activeContest) setDetailTab('standings');
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all cursor-pointer font-varsity uppercase tracking-widest text-[10px] ${view === 'standings' ? 'bg-[var(--color-stitch-red)] text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}
            title="Full Standings"
          >
            <Trophy size={20} className="shrink-0" />
            {!isCollapsed && <span className="truncate">Standings</span>}
          </div>
          {(user?.role === 'admin' || currentUserEmail?.toLowerCase() === 'kebrahim@gmail.com') && (
            <div 
              onClick={() => {
                setView('admin');
                setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all cursor-pointer font-varsity uppercase tracking-widest text-[10px] ${view === 'admin' ? 'bg-[var(--color-stitch-red)] text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}
              title="Admin Panel"
            >
              <Settings size={20} className="shrink-0" />
              {!isCollapsed && <span className="truncate">Admin Panel</span>}
            </div>
          )}

          {!isCollapsed && contests.length > 0 && (
            <div className="mt-8 px-2">
              <h3 className="text-[9px] uppercase tracking-[0.2em] font-varsity text-slate-500 mb-4 px-2">Active Contests</h3>
              <div className="space-y-2">
                {contests.filter(c => c.is_active).map(contest => (
                    <div
                      key={contest.id}
                      onClick={() => {
                        setActiveContest(contest);
                        setDashboardView('detail');
                        setView('dashboard');
                        setIsSidebarOpen(false);
                      }}
                      className={`w-full text-left p-3 rounded-xl transition-all border-2 cursor-pointer ${
                        activeContest?.id === contest.id && dashboardView === 'detail' && view === 'dashboard'
                          ? 'bg-white/10 border-[var(--color-stitch-red)] text-white shadow-lg' 
                          : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                    <div className="flex items-center justify-between gap-2">
                       <div className="text-[10px] font-varsity truncate uppercase tracking-tight">{contest.theme_name}</div>
                       {(() => {
                         const statusObj = getContestStatus(contest);
                         return (
                           <div className={`px-1.5 py-0.5 rounded text-[7px] font-varsity uppercase tracking-widest shrink-0 ${
                             statusObj.statusType === 'live' ? 'bg-emerald-500 text-white font-bold' :
                             statusObj.statusType === 'drafting' ? 'bg-amber-500 text-amber-950 font-black shadow-sm' :
                             'bg-slate-700 text-white'
                           }`}>
                             {statusObj.statusType === 'drafting' ? 'DRAFTING' : statusObj.label}
                           </div>
                         );
                       })()}
                    </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </nav>

        <div className="mt-auto space-y-4">
          <button 
            onClick={() => auth.signOut()}
            className="w-full flex items-center gap-4 p-3 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-all font-varsity uppercase tracking-widest text-[10px]"
            title="Logout"
          >
            <LogOut size={20} className="shrink-0" />
            {!isCollapsed && <span className="truncate">Logout</span>}
          </button>

          <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center font-varsity text-[var(--color-stitch-red)] border-2 border-stitch shrink-0 shadow-inner">
                {user?.display_name?.[0]}
              </div>
              {!isCollapsed && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="overflow-hidden"
                >
                  <div className="text-xs font-varsity text-white truncate uppercase tracking-tight">{user?.display_name}</div>
                  <div className="text-[9px] text-slate-500 truncate font-scorebook">{currentUserEmail}</div>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative h-full flex flex-col">
        {/* Global Turn Alert - Visible everywhere in Dashboard if it's user's turn */}
        <AnimatePresence>
          {isMyTurn && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-amber-500 border-b-4 border-amber-600 shadow-lg relative z-40 overflow-hidden"
            >
              <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 bg-amber-950 rounded-full flex items-center justify-center text-amber-500 animate-pulse">
                    <Play size={12} fill="currentColor" />
                  </div>
                  <p className="text-[10px] font-varsity text-amber-950 uppercase tracking-widest font-black">
                    Action Required: It's your turn in <span className="underline">{contestsWithMyTurn[0].theme_name}</span>
                  </p>
                </div>
                <button 
                  onClick={() => {
                    setActiveContest(contestsWithMyTurn[0]);
                    setView('drafting');
                  }}
                  className="px-4 py-1 bg-amber-950 text-white text-[9px] font-varsity uppercase tracking-widest rounded-lg hover:bg-black transition-all"
                >
                  Draft Now
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
                <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
                  <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-2 h-2 bg-[var(--color-stitch-red)] rounded-full animate-pulse" />
                        <span className="text-[10px] font-varsity text-slate-500 uppercase tracking-[0.3em]">Live Ballpark Platform</span>
                      </div>
                      <h1 className="text-3xl md:text-5xl font-varsity text-slate-900 tracking-tighter uppercase leading-none">
                        {dashboardView === 'overview' ? 'THE DUGOUT' : activeContest?.theme_name}
                      </h1>
                    </div>
                    
                    <div className="flex items-center gap-2 bg-white p-1 rounded-2xl border-2 border-slate-200 shadow-sm">
                      <button 
                        onClick={() => setDashboardView('overview')}
                        className={`px-6 py-2.5 rounded-xl text-[10px] font-varsity uppercase tracking-widest transition-all ${dashboardView === 'overview' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                      >
                        Overview
                      </button>
                      {activeContest && (
                        <button 
                          onClick={() => {
                            setDashboardView('detail');
                            setDetailTab('standings');
                          }}
                          className={`px-6 py-2.5 rounded-xl text-[10px] font-varsity uppercase tracking-widest transition-all ${dashboardView === 'detail' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          Standings
                        </button>
                      )}
                    </div>
                  </div>

                  {dashboardView === 'overview' ? (
                    <>
                      {/* Ongoing Drafts Global Alert */}
                      {ongoingDrafts.length > 0 && (
                        <div className="space-y-4">
                          {ongoingDrafts.map(c => {
                            const isMyActiveTurn = contestsWithMyTurn.some(ct => ct.id === c.id);
                            return (
                              <motion.div
                                key={`ongoing-${c.id}`}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className={`relative overflow-hidden p-4 rounded-2xl border-2 flex items-center justify-between gap-4 shadow-lg ${
                                  isMyActiveTurn 
                                    ? 'bg-amber-500 border-amber-300 text-amber-950 animate-pulse' 
                                    : 'bg-slate-900 border-slate-800 text-white'
                                }`}
                              >
                                <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -mr-12 -mt-12" />
                                <div className="flex items-center gap-4 relative z-10">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isMyActiveTurn ? 'bg-amber-900/20' : 'bg-amber-500/20'}`}>
                                    <AlertTriangle className={isMyActiveTurn ? 'text-amber-950' : 'text-amber-500'} size={20} />
                                  </div>
                                  <div>
                                    <div className={`text-[8px] font-varsity uppercase tracking-[0.2em] ${isMyActiveTurn ? 'text-amber-900/60' : 'text-slate-500'}`}>
                                      {isMyActiveTurn ? 'URGENT: YOU ARE ON THE CLOCK' : 'LIVE DRAFT IN PROGRESS'}
                                    </div>
                                    <h3 className="text-sm font-varsity uppercase tracking-tight leading-none mt-1">
                                      {c.theme_name}
                                    </h3>
                                  </div>
                                </div>
                                <button
                                  onClick={() => {
                                    setActiveContest(c);
                                    setView('drafting');
                                  }}
                                  className={`px-4 py-2 rounded-xl text-[10px] font-varsity uppercase tracking-widest transition-all font-bold ${
                                    isMyActiveTurn 
                                      ? 'bg-amber-950 text-white hover:bg-black' 
                                      : 'bg-emerald-600 text-white hover:bg-emerald-500'
                                  }`}
                                >
                                  {isMyActiveTurn ? 'ENTER DRAFT NOW' : 'VIEW DRAFT'}
                                </button>
                              </motion.div>
                            );
                          })}
                        </div>
                      )}

                      {/* Your Turn Banner (Simplified/Removed in favor of unified ongoing drafts above) */}
                      {/* isMyTurn section kept but moved/integrated above if needed */}

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
                          <h2 className="text-xl md:text-2xl font-varsity text-slate-900 flex items-center gap-3 uppercase tracking-tighter">
                            <Trophy className="text-[var(--color-stitch-red)]" size={24} />
                            LEAGUE STANDINGS
                          </h2>
                          <div className="hidden sm:block text-[10px] font-varsity text-slate-500 uppercase tracking-[0.2em]">Season 2026</div>
                        </div>
                        
                        <div className="bg-scorebook rounded-[1.5rem] md:rounded-[2.5rem] border-4 border-stitch overflow-hidden shadow-xl">
                          <div className="grid grid-cols-12 px-4 md:px-6 py-2 md:py-2 bg-slate-100/50 border-b-2 border-slate-200 text-[8px] md:text-[10px] font-varsity text-slate-500 uppercase tracking-widest">
                            <div className="col-span-2 md:col-span-1">Rank</div>
                            <div className="col-span-6 md:col-span-7">Contestant</div>
                            <div className="col-span-4 text-right">Total CP</div>
                          </div>
                          <div className="divide-y-2 divide-slate-200/80">
                            {leaderboard.map((player, idx) => {
                              const rank = leaderboard.findIndex(p => p.total_cp === player.total_cp) + 1;
                              return (
                                <div 
                                  key={player.uid}
                                  onClick={() => showRival(player)}
                                  className="grid grid-cols-12 px-4 md:px-6 py-2 md:py-3 items-center hover:bg-blue-50/50 transition-colors group cursor-pointer"
                                >
                                  <div className="col-span-2 md:col-span-1 font-scorebook text-slate-500 text-xs md:text-sm">{rank}</div>
                                  <div className="col-span-6 md:col-span-7 flex items-center gap-3 md:gap-4">
                                    <div className="w-8 h-8 md:w-10 md:h-10 bg-white rounded-full flex items-center justify-center font-varsity text-[var(--color-stitch-red)] border-2 border-stitch group-hover:scale-110 transition-transform shrink-0 text-xs md:text-base shadow-sm">
                                      {player.display_name?.[0]}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                      <span className="font-varsity text-slate-900 group-hover:text-[var(--color-stitch-red)] transition-colors truncate text-xs md:text-base uppercase tracking-tight">{player.display_name}</span>
                                      <span className="text-[8px] md:text-[10px] text-slate-500 uppercase tracking-widest font-varsity truncate">{player.role}</span>
                                    </div>
                                  </div>
                                  <div className="col-span-4 text-right">
                                    <span className="text-lg md:text-2xl font-varsity text-slate-900 tabular-nums tracking-tighter">{player.total_cp}</span>
                                    <span className="text-[8px] md:text-[10px] font-varsity text-slate-500 ml-1 md:ml-2 uppercase">CP</span>
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
                          <h2 className="text-xl md:text-2xl font-varsity text-slate-900 flex items-center gap-3 uppercase tracking-tighter">
                            <LayoutDashboard className="text-blue-600" size={24} />
                            BALLPARK CONTESTS
                          </h2>
                          <div className="hidden sm:block text-[10px] font-varsity text-slate-500 uppercase tracking-[0.2em]">Active & Upcoming</div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                          {contests.filter(c => c.is_active).map(contest => {
                            const status = getContestStatus(contest);
                            return (
                              <div
                                key={contest.id}
                                onClick={() => {
                                  setActiveContest(contest);
                                  setDashboardView('detail');
                                }}
                                className="p-4 md:p-6 bg-white rounded-[1.5rem] md:rounded-[2rem] border-2 border-slate-200 hover:border-[var(--color-stitch-red)] transition-all text-left group relative overflow-hidden shadow-lg cursor-pointer"
                              >
                                <div className="absolute inset-0 bg-[var(--color-stitch-red)]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <div className="relative z-10 flex flex-col h-full">
                                  <div className="flex justify-between items-start mb-3 md:mb-4">
                                    <div className={`px-2 md:px-3 py-0.5 md:py-1 rounded-lg md:rounded-xl text-[8px] md:text-[10px] font-varsity uppercase tracking-widest font-black shadow-sm ${
                                      contest.draft_status === 'in_progress' || status.statusType === 'drafting'
                                        ? 'bg-amber-500 text-amber-950 animate-pulse'
                                        : status.statusType === 'live'
                                        ? 'bg-emerald-600 text-white border border-emerald-400/30'
                                        : status.statusType === 'drafted'
                                        ? 'bg-blue-600 text-white border border-blue-400/30'
                                        : status.statusType === 'completed'
                                        ? 'bg-slate-500 text-white'
                                        : 'bg-slate-200 text-slate-600'
                                    }`}>
                                      {contest.draft_status === 'in_progress' ? 'LIVE DRAFT' : status.label}
                                    </div>
                                    <div className="w-8 h-8 md:w-10 md:h-10 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 group-hover:text-[var(--color-stitch-red)] transition-colors border border-slate-200">
                                      <ChevronRight size={16} className="md:w-5 md:h-5" />
                                    </div>
                                  </div>
                                  <h3 className="text-lg md:text-xl font-varsity text-slate-900 mb-2 group-hover:text-[var(--color-stitch-red)] transition-colors uppercase tracking-tight">{contest.theme_name}</h3>
                                  
                                  <div className="flex flex-col gap-1 mb-3 md:mb-4">
                                    <div className="flex items-center gap-2 text-[8px] md:text-[10px] font-varsity text-slate-500 uppercase tracking-widest">
                                      <Calendar size={10} className="text-[var(--color-stitch-red)] md:w-3 md:h-3" />
                                      <span>Starts: {parseDate(contest.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[8px] md:text-[10px] font-varsity text-slate-500 uppercase tracking-widest">
                                      <Calendar size={10} className="text-slate-400 md:w-3 md:h-3" />
                                      <span>Ends: {parseDate(contest.end_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 mt-4">
                                    <div 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveContest(contest);
                                        setDashboardView('detail');
                                        setDetailTab('my_slip');
                                      }}
                                      className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-varsity rounded-xl transition-all uppercase tracking-widest text-center cursor-pointer"
                                    >
                                      My Slip
                                    </div>
                                    <div 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveContest(contest);
                                        setDashboardView('detail');
                                        setDetailTab('standings');
                                      }}
                                      className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-varsity rounded-xl transition-all uppercase tracking-widest shadow-md text-center cursor-pointer"
                                    >
                                      Standings
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    </>
                  ) : (
                    <div className="space-y-8">
                      <button 
                        onClick={() => setDashboardView('overview')}
                        className="flex items-center gap-2 text-[10px] font-varsity text-slate-500 hover:text-slate-900 uppercase tracking-[0.2em] transition-colors"
                      >
                        <ChevronLeft size={16} />
                        Back to Dugout
                      </button>

                      {activeContest && (
                        <>
                          <div className="bg-white p-8 rounded-[2.5rem] border-4 border-stitch shadow-xl relative overflow-hidden">
                            <div className="absolute inset-0 bg-blue-50/30" />
                            <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-8">
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-4">
                                  {(() => {
                                    const statusObj = getContestStatus(activeContest);
                                    return (
                                      <div className={`px-4 py-1.5 rounded-xl text-[11px] font-varsity uppercase tracking-[0.15em] font-black shadow-lg border-2 border-white/20 transition-all ${
                                        statusObj.statusType === 'live' ? 'bg-emerald-600 text-white shadow-emerald-500/20 border-emerald-400' :
                                        statusObj.statusType === 'drafting' ? 'bg-amber-500 text-amber-950 shadow-amber-500/10' :
                                        statusObj.statusType === 'completed' ? 'bg-slate-600 text-white' :
                                        'bg-blue-600 text-white'
                                      }`}>
                                        {statusObj.statusType === 'drafting' ? 'DRAFTING NOW' : statusObj.label}
                                      </div>
                                    );
                                  })()}
                                  <span className="text-[10px] font-varsity text-slate-500 uppercase tracking-[0.2em] font-bold">
                                    {activeContest.is_draft ? 'Snake Draft' : 'Selection Room'}
                                  </span>
                                </div>
                                <h1 className="text-4xl md:text-5xl font-varsity text-slate-900 mb-4 uppercase tracking-tighter leading-none">{activeContest.theme_name}</h1>
                                {activeContest.description && (
                                  <p className="text-slate-700 text-base mb-6 max-w-2xl leading-relaxed font-sans font-medium">
                                    {activeContest.description}
                                  </p>
                                )}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                                  <div>
                                    <div className="text-[8px] font-varsity text-slate-500 uppercase tracking-widest mb-1">Metric</div>
                                    <div className="text-xs font-varsity text-blue-600 uppercase">{formatMetric(activeContest.metric_key)}</div>
                                  </div>
                                  <div>
                                    <div className="text-[8px] font-varsity text-slate-500 uppercase tracking-widest mb-1">Limit</div>
                                    <div className="text-xs font-varsity text-slate-900">{activeContest.selection_limit} Teams</div>
                                  </div>
                                  <div>
                                    <div className="text-[8px] font-varsity text-slate-500 uppercase tracking-widest mb-1">Starts</div>
                                    <div className="text-xs font-varsity text-slate-900">{parseDate(activeContest.start_time).toLocaleDateString()}</div>
                                  </div>
                                  <div>
                                    <div className="text-[8px] font-varsity text-slate-500 uppercase tracking-widest mb-1">Ends</div>
                                    <div className="text-xs font-varsity text-slate-900">{parseDate(activeContest.end_time).toLocaleDateString()}</div>
                                  </div>
                                </div>
                              </div>

                              {!isLocked && (
                                <button 
                                  onClick={() => setView('drafting')}
                                  className="w-full md:w-auto px-10 py-5 bg-slate-900 hover:bg-slate-800 text-white font-varsity uppercase tracking-widest rounded-2xl shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3"
                                >
                                  <Play size={20} />
                                  {userEntry ? 'EDIT PICKS' : 'STEP TO THE PLATE'}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            <div className="md:col-span-2 lg:col-span-3 space-y-6">
                              <div className="flex items-center gap-4 border-b-2 border-slate-200 pb-4">
                                <button 
                                  onClick={() => setDetailTab('my_slip')}
                                  className={`px-6 py-2 rounded-xl text-[10px] font-varsity uppercase tracking-widest transition-all ${detailTab === 'my_slip' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                  My Slip
                                </button>
                                <button 
                                  onClick={() => setDetailTab('standings')}
                                  className={`px-6 py-2 rounded-xl text-[10px] font-varsity uppercase tracking-widest transition-all ${detailTab === 'standings' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                  Full Standings
                                </button>
                              </div>

                              {detailTab === 'my_slip' ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                  <div className="md:col-span-2 lg:col-span-2 space-y-6">
                                    <h2 className="text-xl font-varsity text-slate-900 flex items-center gap-3 uppercase tracking-tighter">
                                      <ChevronRight className="text-[var(--color-stitch-red)]" size={20} />
                                      MY ACTIVE SLIP
                                    </h2>
                                    
                                    {userEntry ? (
                                      <div className="space-y-4">
                                        {[...userEntry.selections].sort((a, b) => b.chips - a.chips).map(sel => {
                                          const team = teams.find(t => t.id === sel.team_id);
                                          if (!team) return null;
                                          
                                          if (activeContest.metric_key !== 'wins') {
                                            const endVal = activeContest.ending_stats?.[team.id];
                                            const rawValue = endVal !== undefined ? endVal : (team.stats[activeContest.metric_key as keyof typeof team.stats] || 0);
                                            const startValue = activeContest.starting_stats?.[team.id] || 0;
                                            const isStarted = parseDate(activeContest.start_time) <= new Date();
                                            const metricValue = isStarted ? Math.max(0, rawValue - startValue) : 0;

                                            if (activeContest.metric_key === 'defense') {
                                              const startDP = (activeContest as any).starting_doublePlays?.[team.id] || 0;
                                              const startCS = (activeContest as any).starting_caughtStealing?.[team.id] || 0;
                                              const startErr = (activeContest as any).starting_errors?.[team.id] || 0;

                                              const rawDP = (activeContest as any).ending_doublePlays?.[team.id] !== undefined 
                                                ? (activeContest as any).ending_doublePlays[team.id] 
                                                : (team.stats.doublePlays || 0);
                                              const rawCS = (activeContest as any).ending_caughtStealing?.[team.id] !== undefined 
                                                ? (activeContest as any).ending_caughtStealing[team.id] 
                                                : (team.stats.caughtStealing || 0);
                                              const rawErr = (activeContest as any).ending_errors?.[team.id] !== undefined 
                                                ? (activeContest as any).ending_errors[team.id] 
                                                : (team.stats.errors || 0);

                                              const dpVal = isStarted ? Math.max(0, rawDP - startDP) : 0;
                                              const csVal = isStarted ? Math.max(0, rawCS - startCS) : 0;
                                              const errVal = isStarted ? Math.max(0, rawErr - startErr) : 0;
                                              const defVal = dpVal + csVal - errVal;

                                              return (
                                                <div key={sel.team_id} className="bg-scorebook p-6 rounded-2xl border-2 border-slate-200 shadow-md flex flex-col gap-4 group hover:border-[var(--color-stitch-red)] transition-all">
                                                  <div className="flex justify-between items-center">
                                                    <div>
                                                      <h3 className="font-varsity text-lg text-slate-900 uppercase tracking-tight">{team.team_name}</h3>
                                                      <div className="text-[10px] text-slate-500 uppercase tracking-widest font-varsity">
                                                        {activeContest.is_draft ? 'Draft Pick' : 'Selection'}
                                                      </div>
                                                    </div>
                                                    <div className="text-right">
                                                      <div className="text-3xl font-varsity text-blue-600 tabular-nums tracking-tighter">
                                                        {defVal}
                                                      </div>
                                                      <div className="text-[10px] text-slate-500 uppercase tracking-widest font-varsity">
                                                        Defensive Score
                                                      </div>
                                                    </div>
                                                  </div>

                                                  <div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200 text-[11px] space-y-2 font-varsity uppercase tracking-wider text-slate-600">
                                                    <div className="flex justify-between items-center">
                                                      <span>Double Plays Turned:</span>
                                                      <span className="font-mono text-emerald-600 font-bold">+{dpVal} <span className="text-[8px] text-slate-400">({startDP} → {rawDP})</span></span>
                                                    </div>
                                                    <div className="flex justify-between items-center">
                                                      <span>Caught Stealing:</span>
                                                      <span className="font-mono text-emerald-600 font-bold">+{csVal} <span className="text-[8px] text-slate-400">({startCS} → {rawCS})</span></span>
                                                    </div>
                                                    <div className="flex justify-between items-center">
                                                      <span>Errors Committed:</span>
                                                      <span className="font-mono text-rose-500 font-bold">-{errVal} <span className="text-[8px] text-slate-400">({startErr} → {rawErr})</span></span>
                                                    </div>
                                                    <div className="h-px bg-slate-200 my-1" />
                                                    <div className="flex justify-between items-center text-xs font-black text-slate-800">
                                                      <span>Calculation:</span>
                                                      <span>{dpVal} + {csVal} - {errVal} = {defVal}</span>
                                                    </div>
                                                  </div>
                                                </div>
                                              );
                                            }

                                            return (
                                              <div key={sel.team_id} className="bg-scorebook p-6 rounded-2xl border-2 border-slate-200 shadow-md flex justify-between items-center group hover:border-[var(--color-stitch-red)] transition-all">
                                                <div>
                                                  <h3 className="font-varsity text-lg text-slate-900 uppercase tracking-tight">{team.team_name}</h3>
                                                  <div className="text-[10px] text-slate-500 uppercase tracking-widest font-varsity">
                                                    {activeContest.is_draft ? 'Draft Pick' : 'Selection'}
                                                  </div>
                                                </div>
                                                <div className="text-right">
                                                  <div className="text-3xl font-varsity text-blue-600 tabular-nums tracking-tighter">
                                                    {metricValue}
                                                  </div>
                                                  <div className="text-[10px] text-slate-500 uppercase tracking-widest font-varsity">
                                                    {formatMetric(activeContest.metric_key)}
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          }

                                          const endVal = activeContest.ending_stats?.[team.id];
                                          const wins = endVal !== undefined ? endVal : team.stats.wins;
                                          const gamesPlayed = team.stats.wins + team.stats.losses;
                                          const projectedWins = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 162) : 0;
                                          const progress = (wins / team.ou_line) * 100;
                                          const gamesRemaining = (activeContest.results_sealed || endVal !== undefined) ? 0 : (162 - (team.stats.wins + team.stats.losses));
                                          const isClinched = sel.side === 'over' 
                                            ? wins > team.ou_line 
                                            : (wins + gamesRemaining) < team.ou_line;
                                          const isEliminated = sel.side === 'over'
                                            ? (wins + gamesRemaining) < team.ou_line
                                            : wins > team.ou_line;
                                          
                                          const isTrendingCorrect = sel.side === 'over' ? projectedWins > team.ou_line : projectedWins < team.ou_line;

                                          return (
                                            <div key={sel.team_id} className="bg-scorebook p-6 rounded-2xl border-2 border-slate-200 shadow-md group hover:border-[var(--color-stitch-red)] transition-all">
                                              <div className="flex justify-between items-center mb-4">
                                                <div>
                                                  <h3 className="font-varsity text-lg text-slate-900 uppercase tracking-tight">{team.team_name}</h3>
                                                  <div className="text-[10px] text-slate-500 uppercase tracking-widest font-varsity flex flex-wrap items-center gap-y-1">
                                                    <span>{sel.side} {team.ou_line} • {sel.chips} Chips</span>
                                                    {isClinched && <span className="text-emerald-600 ml-2 font-black">CLINCHED</span>}
                                                    {isEliminated && <span className="text-rose-600 ml-2 font-black">ELIMINATED</span>}
                                                    {!isClinched && !isEliminated && endVal === undefined && wins + team.stats.losses > 0 && (
                                                      <span className={`ml-2 px-1.5 py-0.5 rounded ${isTrendingCorrect ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'} font-black text-[8px]`}>
                                                        ON PACE: {projectedWins} ({projectedWins > team.ou_line ? 'O' : 'U'})
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                                <div className="text-right">
                                                  <div className={`text-2xl font-varsity tabular-nums tracking-tighter ${isClinched ? 'text-emerald-600' : isEliminated ? 'text-rose-600' : 'text-slate-400'}`}>
                                                    {wins}{endVal === undefined && ` - ${team.stats.losses}`}
                                                  </div>
                                                  <div className="text-[10px] text-slate-500 uppercase tracking-widest font-varsity">{endVal !== undefined ? 'Final Result' : 'Current Record'}</div>
                                                </div>
                                              </div>
                                              <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                                                <div 
                                                  className={`absolute top-0 left-0 h-full transition-all duration-1000 ${isClinched ? 'bg-emerald-500' : isEliminated ? 'bg-rose-500' : 'bg-slate-400'}`}
                                                  style={{ width: `${Math.min(progress, 100)}%` }}
                                                />
                                                <div 
                                                  className="absolute top-0 h-full border-r-2 border-slate-300 z-10"
                                                  style={{ left: '50%' }}
                                                />
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <div className="bg-slate-50 p-12 rounded-[2rem] border-4 border-dashed border-slate-200 text-center">
                                        <p className="text-slate-500 mb-6 text-sm font-scorebook">No active entry found for this contest.</p>
                                        {!isLocked && (
                                          <button 
                                            onClick={() => setView('drafting')}
                                            className="px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white font-varsity uppercase tracking-widest rounded-xl transition-all shadow-lg"
                                          >
                                            Step to the Plate
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  <div className="md:col-span-2 lg:col-span-1 space-y-6">
                                    <h2 className="text-xl font-varsity text-slate-900 flex items-center gap-3 uppercase tracking-tighter">
                                      <Users className="text-[var(--color-stitch-red)]" size={20} />
                                      CONTESTANTS
                                    </h2>
                                    <div className="bg-scorebook rounded-[2rem] border-4 border-stitch overflow-hidden shadow-xl">
                                      {leaderboard.map((player, idx) => (
                                        <div
                                          key={player.uid}
                                          onClick={() => showRival(player)}
                                          className="w-full flex items-center justify-between p-4 hover:bg-blue-50/30 transition-colors border-b-2 border-slate-100 last:border-0 group cursor-pointer"
                                        >
                                          <div className="flex items-center gap-4">
                                            <span className="text-[10px] font-varsity text-slate-400 w-4">{idx + 1}</span>
                                            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-[10px] font-varsity text-[var(--color-stitch-red)] border-2 border-stitch group-hover:scale-110 transition-transform">
                                              {player.display_name?.[0]}
                                            </div>
                                            <span className="font-varsity text-sm text-slate-900 group-hover:text-[var(--color-stitch-red)] transition-colors uppercase tracking-tight">{player.display_name}</span>
                                          </div>
                                          <ChevronRight size={14} className="text-slate-400 group-hover:text-[var(--color-stitch-red)] transition-colors" />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-6">
                                  <div className="flex items-center justify-between">
                                    <h2 className="text-xl font-varsity text-slate-900 flex items-center gap-3 uppercase tracking-tighter">
                                      <BarChart3 className="text-blue-600" size={20} />
                                      FULL STANDINGS
                                    </h2>
                                    <div className="text-[10px] font-varsity text-slate-500 uppercase tracking-[0.2em]">
                                      {allEntries.length} Contestants
                                    </div>
                                  </div>

                                  <div className="bg-scorebook rounded-[1.5rem] md:rounded-[2rem] border-4 border-stitch overflow-hidden shadow-xl">
                                    <div className="grid grid-cols-12 px-4 md:px-6 py-2 bg-slate-50 border-b-2 border-slate-200 text-[8px] md:text-[10px] font-varsity text-slate-500 uppercase tracking-widest">
                                      <div className="col-span-1">Rank</div>
                                      <div className="col-span-3">Contestant</div>
                                      <div className="hidden md:block col-span-5">Selections & Records</div>
                                      {isBigBet ? (
                                        <div className="col-span-3 text-right">CP</div>
                                      ) : (
                                        <>
                                          <div className="col-span-1 text-right">Score</div>
                                          <div className="col-span-2 text-right">CP</div>
                                        </>
                                      )}
                                    </div>
                                    <div className="divide-y-2 divide-slate-200/80">
                                      {sortedEntries.map((entry, idx) => {
                                        const player = leaderboard.find(p => p.uid === entry.uid);
                                        if (!player) return null;
                                        
                                        const rank = entry.rank + 1;
                                        const cp = getCPForRank(entry.rank);
 
                                        return (
                                          <div key={entry.uid} onClick={() => showRival(player)} className="flex flex-col md:grid md:grid-cols-12 px-4 md:px-6 py-2 md:py-3 md:items-center hover:bg-blue-50/50 transition-colors group gap-4 md:gap-0 cursor-pointer">
                                            <div className="flex items-center justify-start md:justify-between md:contents gap-4">
                                              <div className="w-8 md:col-span-1 font-scorebook text-slate-500 text-xs md:text-sm">{rank}</div>
                                              
                                              <div className="flex-1 md:col-span-3 flex items-center gap-3 md:gap-4">
                                                <div className="w-8 h-8 md:w-10 md:h-10 bg-white rounded-full flex items-center justify-center font-varsity text-[var(--color-stitch-red)] border-2 border-stitch group-hover:scale-110 transition-transform shrink-0 text-xs md:text-base shadow-sm">
                                                  {player.display_name?.[0]}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                  <span className="font-varsity text-slate-900 group-hover:text-[var(--color-stitch-red)] transition-colors truncate text-xs md:text-base uppercase tracking-tight">{player.display_name}</span>
                                                  <span className="text-[8px] md:text-[10px] text-slate-500 uppercase tracking-widest font-varsity truncate">{player.role}</span>
                                                </div>
                                              </div>

                                              <div className="md:hidden ml-auto text-right flex flex-col items-end">
                                                {!isBigBet && (
                                                  <div className="text-lg font-varsity text-blue-600 tabular-nums tracking-tighter">
                                                    {entry.score}
                                                  </div>
                                                )}
                                                {cp > 0 && activeContest.points_awarded && getContestStatus(activeContest).statusType === 'completed' && (
                                                  <div className="px-2 py-0.5 bg-amber-500 text-amber-950 text-[8px] font-black rounded-lg">
                                                    +{cp} CP
                                                  </div>
                                                )}
                                              </div>
                                            </div>

                                            <div className={`col-span-5 ${isBigBet ? 'flex flex-col gap-1 py-1' : 'flex flex-wrap gap-2 justify-center md:justify-start py-2'}`}>
                                              {(isBigBet ? [
                                                [...entry.selections].sort((a, b) => (b.chips || 0) - (a.chips || 0)).slice(0, 3),
                                                [...entry.selections].sort((a, b) => (b.chips || 0) - (a.chips || 0)).slice(3)
                                              ] : [[...entry.selections].sort((a, b) => (b.chips || 0) - (a.chips || 0))]).map((row, rowIdx) => (
                                                <div key={rowIdx} className={`flex ${isBigBet ? 'flex-row gap-1' : 'flex-wrap gap-2'} justify-center md:justify-start`}>
                                                  {row.map(sel => {
                                                    const team = teams.find(t => t.id === sel.team_id);
                                                    if (!team) return null;
                                                    const endVal = activeContest.ending_stats?.[team.id];
                                                    const rawValue = endVal !== undefined ? endVal : (team.stats[activeContest.metric_key as keyof typeof team.stats] || 0);
                                                    const startValue = activeContest.starting_stats?.[team.id] || 0;
                                                    const isStarted = parseDate(activeContest.start_time) <= new Date();
                                                    const metricValue = activeContest.metric_key === 'wins' ? rawValue : (isStarted ? Math.max(0, rawValue - startValue) : 0);
                                                    const gamesPlayed = team.stats.wins + team.stats.losses;
                                                    const projectedWins = gamesPlayed > 0 ? Math.round((rawValue / gamesPlayed) * 162) : 0;
                                                    const isTrendingCorrect = activeContest.metric_key === 'wins' ? (sel.side === 'over' ? projectedWins > team.ou_line : projectedWins < team.ou_line) : false;

                                                    const gamesRemaining = (activeContest.results_sealed || endVal !== undefined) ? 0 : (162 - (team.stats.wins + team.stats.losses));
                                                    const isClinched = activeContest.metric_key === 'wins'
                                                      ? (sel.side === 'over' ? rawValue > team.ou_line : (rawValue + gamesRemaining) < team.ou_line)
                                                      : false;
                                                    const isEliminated = activeContest.metric_key === 'wins'
                                                      ? (sel.side === 'over' ? (rawValue + gamesRemaining) < team.ou_line : rawValue > team.ou_line)
                                                      : false;

                                                    return (
                                                      <div 
                                                        key={sel.team_id}
                                                        className={`px-2 py-0.5 rounded-md border flex items-center gap-1 transition-all ${
                                                          isBigBet ? 'text-[10px] md:text-xs' : 'text-xs md:text-sm px-3 py-1.5'
                                                        } ${
                                                          isClinched 
                                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-600' 
                                                            : isEliminated
                                                              ? 'bg-rose-50 border-rose-200 text-rose-600'
                                                              : 'bg-white border-slate-100 text-slate-500'
                                                        }`}
                                                      >
                                                        <div className="flex flex-col items-start leading-none relative">
                                                          <span className="font-varsity uppercase tracking-tight">{team.abbreviation}</span>
                                                          {activeContest.metric_key === 'wins' && (
                                                            <div className="flex items-center gap-0.5">
                                                              <span className="opacity-70 font-sans font-bold tracking-tighter scale-90 origin-left">{sel.side[0]}{team.ou_line}</span>
                                                              {!isClinched && !isEliminated && endVal === undefined && gamesPlayed > 0 && (
                                                                <div className={`w-1 h-1 rounded-full ${isTrendingCorrect ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500 animate-pulse'}`} />
                                                              )}
                                                            </div>
                                                          )}
                                                        </div>
                                                        <span className="w-px h-3 bg-slate-200 ml-1" />
                                                        <div className="flex flex-col items-end leading-none">
                                                          <span className="font-varsity tabular-nums">
                                                            {activeContest.metric_key === 'wins' ? (endVal !== undefined ? rawValue : `${team.stats.wins}-${team.stats.losses}`) : metricValue}
                                                          </span>
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              ))}
                                            </div>

                                            {!isBigBet && (
                                              <div className="hidden md:block col-span-1 text-right">
                                                <div className="text-2xl font-varsity text-blue-600 tabular-nums tracking-tighter">
                                                  {entry.score}
                                                </div>
                                                <div className="text-[10px] font-varsity text-slate-500 uppercase tracking-widest">
                                                  {formatMetric(activeContest.metric_key)}
                                                </div>
                                              </div>
                                            )}

                                            <div className={`hidden md:flex ${isBigBet ? 'col-span-3' : 'col-span-2'} flex-col items-end`}>
                                              {cp > 0 && activeContest.points_awarded && getContestStatus(activeContest).statusType === 'completed' ? (
                                                <>
                                                  <div className="text-2xl font-varsity text-amber-600 tabular-nums tracking-tighter">
                                                    +{cp}
                                                  </div>
                                                  <div className="flex items-center gap-1">
                                                    <Trophy size={10} className="text-amber-500" />
                                                    <span className="text-[10px] font-varsity text-amber-500 uppercase tracking-widest">CP Won</span>
                                                  </div>
                                                </>
                                              ) : (
                                                <span className="text-[10px] font-varsity text-slate-400 uppercase tracking-widest">---</span>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              )}
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

          {view === 'standings' && (
            <motion.div 
              key="standings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full h-full overflow-y-auto custom-scrollbar"
            >
              <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <Trophy className="text-[var(--color-stitch-red)]" size={16} />
                      <span className="text-[10px] font-varsity text-slate-500 uppercase tracking-[0.3em]">League Standings</span>
                    </div>
                    <h1 className="text-3xl md:text-5xl font-varsity text-slate-900 tracking-tighter uppercase leading-none">
                      {activeContest?.theme_name || 'STANDINGS'}
                    </h1>
                  </div>
                  {activeContest && (
                    <div className="hidden sm:flex px-4 py-2 bg-white rounded-xl border-2 border-slate-200 items-center gap-3 shadow-sm">
                      <span className="text-xs font-varsity text-slate-500 uppercase tracking-widest">{formatMetric(activeContest.metric_key)}</span>
                    </div>
                  )}
                </div>

                {/* Contest Selector */}
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 border-b-2 border-slate-200">
                  {contests.filter(c => c.is_active).map(contest => (
                    <button
                      key={contest.id}
                      onClick={() => setActiveContest(contest)}
                      className={`px-4 py-2 rounded-xl text-[10px] font-varsity whitespace-nowrap transition-all border-2 uppercase tracking-widest ${
                        activeContest?.id === contest.id
                          ? 'bg-slate-900 border-slate-900 text-white shadow-lg'
                          : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
                      }`}
                    >
                      {contest.theme_name}
                    </button>
                  ))}
                </div>

                {activeContest ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-varsity text-slate-900 flex items-center gap-3 uppercase tracking-tighter">
                        <BarChart3 className="text-blue-600" size={20} />
                        FULL CONTEST STANDINGS
                      </h2>
                      <div className="text-[10px] font-varsity text-slate-500 uppercase tracking-[0.2em]">
                        {allEntries.length} Contestants
                      </div>
                    </div>

                    <div className="bg-scorebook rounded-[1.5rem] md:rounded-[2rem] border-4 border-stitch overflow-hidden shadow-xl">
                      <div className="grid grid-cols-12 px-4 md:px-6 py-2 bg-slate-50 border-b-2 border-slate-200 text-[8px] md:text-[10px] font-varsity text-slate-500 uppercase tracking-widest">
                        <div className="col-span-1">Rank</div>
                        <div className="col-span-3">Contestant</div>
                        <div className="hidden md:block col-span-5">Selections & Records</div>
                        {isBigBet ? (
                          <div className="col-span-3 text-right">CP</div>
                        ) : (
                          <>
                            <div className="col-span-1 text-right">Score</div>
                            <div className="col-span-2 text-right">CP</div>
                          </>
                        )}
                      </div>
                      <div className="divide-y-2 divide-slate-200/80">
                        {sortedEntries.map((entry, idx) => {
                          const player = leaderboard.find(p => p.uid === entry.uid);
                          if (!player) return null;
                          
                          const rank = entry.rank + 1;
                          const cp = getCPForRank(entry.rank);
 
                          return (
                            <div key={entry.uid} onClick={() => showRival(player)} className="flex flex-col md:grid md:grid-cols-12 px-4 md:px-6 py-2 md:py-3 md:items-center hover:bg-blue-50/50 transition-colors group gap-4 md:gap-0 cursor-pointer">
                              <div className="flex items-center justify-start md:justify-between md:contents gap-4">
                                <div className="w-8 md:col-span-1 font-varsity text-slate-400 text-xs md:text-sm">{rank}</div>
                                
                                <div className="flex-1 md:col-span-3 flex items-center gap-3 md:gap-4">
                                  <div className="w-8 h-8 md:w-10 md:h-10 bg-white rounded-full flex items-center justify-center font-varsity text-[var(--color-stitch-red)] border-2 border-stitch group-hover:scale-110 transition-transform shrink-0 text-xs md:text-base shadow-sm">
                                    {player.display_name?.[0]}
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-varsity text-slate-900 group-hover:text-[var(--color-stitch-red)] transition-colors truncate text-xs md:text-base uppercase tracking-tight">{player.display_name}</span>
                                    <span className="text-[8px] md:text-[10px] text-slate-400 uppercase tracking-widest font-varsity truncate">{player.role}</span>
                                  </div>
                                </div>

                                <div className="md:hidden ml-auto text-right flex flex-col items-end">
                                  {!isBigBet && (
                                    <div className="text-lg font-varsity text-blue-600 tabular-nums tracking-tighter">
                                      {entry.score}
                                    </div>
                                  )}
                                  {cp > 0 && getContestStatus(activeContest).statusType === 'completed' && (
                                    <div className="px-2 py-0.5 bg-amber-500 text-amber-950 text-[8px] font-black rounded-lg">
                                      +{cp} CP
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className={`col-span-5 ${isBigBet ? 'flex flex-col gap-1 py-1' : 'flex flex-wrap gap-2 justify-center md:justify-start py-2'}`}>
                                {(isBigBet ? [
                                  [...entry.selections].sort((a, b) => (b.chips || 0) - (a.chips || 0)).slice(0, 3),
                                  [...entry.selections].sort((a, b) => (b.chips || 0) - (a.chips || 0)).slice(3)
                                ] : [[...entry.selections].sort((a, b) => (b.chips || 0) - (a.chips || 0))]).map((row, rowIdx) => (
                                  <div key={rowIdx} className={`flex ${isBigBet ? 'flex-row gap-1' : 'flex-wrap gap-2'} justify-center md:justify-start`}>
                                    {row.map(sel => {
                                      const team = teams.find(t => t.id === sel.team_id);
                                      if (!team) return null;
                                      const endVal = activeContest.ending_stats?.[team.id];
                                      const rawValue = endVal !== undefined ? endVal : (team.stats[activeContest.metric_key as keyof typeof team.stats] || 0);
                                      
                                      const gamesPlayed = team.stats.wins + team.stats.losses;
                                      const projectedWins = gamesPlayed > 0 ? Math.round((rawValue / gamesPlayed) * 162) : 0;
                                      const isTrendingCorrect = activeContest.metric_key === 'wins' ? (sel.side === 'over' ? projectedWins > team.ou_line : projectedWins < team.ou_line) : false;

                                      const gamesRemaining = 162 - (team.stats.wins + team.stats.losses);
                                      const isClinched = activeContest.metric_key === 'wins'
                                        ? (sel.side === 'over' ? rawValue > team.ou_line : (rawValue + gamesRemaining) < team.ou_line)
                                        : false;
                                      const isEliminated = activeContest.metric_key === 'wins'
                                        ? (sel.side === 'over' ? (rawValue + gamesRemaining) < team.ou_line : rawValue > team.ou_line)
                                        : false;

                                      return (
                                          <div 
                                            key={sel.team_id} 
                                            className={`px-2 py-0.5 rounded-md border flex items-center gap-1 transition-all ${
                                              isBigBet ? 'text-[10px] md:text-xs' : 'text-xs md:text-sm px-3 py-1.5'
                                            } ${
                                              isClinched 
                                                ? 'bg-emerald-50 border-emerald-200 text-emerald-600' 
                                                : isEliminated 
                                                  ? 'bg-rose-50 border-rose-200 text-rose-600' 
                                                  : 'bg-white border-slate-100 text-slate-500'
                                            }`}
                                          >
                                            <div className="flex flex-col items-start leading-none">
                                              <span className="font-varsity text-slate-900">{team.abbreviation}</span>
                                              {activeContest.metric_key === 'wins' && (
                                                <div className="flex items-center gap-0.5">
                                                  <span className={`font-sans font-bold uppercase tracking-tighter scale-90 origin-left text-[8px] md:text-[10px] ${isClinched ? 'text-emerald-600' : isEliminated ? 'text-rose-600' : 'text-slate-400'}`}>
                                                    {sel.side[0]}{team.ou_line}
                                                  </span>
                                                  {!isClinched && !isEliminated && endVal === undefined && gamesPlayed > 0 && (
                                                    <div className={`w-1 h-1 rounded-full ${isTrendingCorrect ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500 animate-pulse'}`} />
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                            <span className="w-px h-3 bg-slate-200 ml-1" />
                                          <span className="font-varsity text-slate-600">
                                            {(() => {
                                              if (activeContest.metric_key === 'wins') {
                                                return endVal !== undefined ? rawValue : `${team.stats.wins}-${team.stats.losses}`;
                                              }
                                              return parseDate(activeContest.start_time) <= new Date() ? Math.max(0, rawValue - (activeContest.starting_stats?.[team.id] || 0)) : 0;
                                            })()}
                                          </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>

                              {!isBigBet && (
                                <div className="hidden md:block col-span-1 text-right">
                                  <div className="text-2xl font-varsity text-blue-600 tabular-nums tracking-tighter">
                                    {entry.score}
                                  </div>
                                  <div className="text-[10px] font-varsity text-slate-400 uppercase tracking-widest">
                                    {formatMetric(activeContest.metric_key)}
                                  </div>
                                </div>
                              )}

                              <div className={`hidden md:flex ${isBigBet ? 'col-span-3' : 'col-span-2'} flex-col items-end`}>
                                {cp > 0 && getContestStatus(activeContest).statusType === 'completed' ? (
                                  <>
                                    <div className="text-2xl font-varsity text-amber-600 tabular-nums tracking-tighter">
                                      +{cp}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Trophy size={10} className="text-amber-500" />
                                      <span className="text-[10px] font-varsity text-amber-500 uppercase tracking-widest">CP Won</span>
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-[10px] font-varsity text-slate-400 uppercase tracking-widest">---</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white p-12 rounded-[2rem] border-4 border-dashed border-slate-200 text-center">
                    <Trophy className="mx-auto text-slate-300 mb-4" size={48} />
                    <h3 className="text-xl font-varsity text-slate-900 mb-2 uppercase tracking-tight">No Active Contest</h3>
                    <p className="text-slate-500 font-scorebook">Select a contest to view its standings.</p>
                  </div>
                )}
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
                className="w-full max-w-2xl bg-white rounded-3xl border-4 border-stitch shadow-2xl overflow-hidden"
              >
                <div className="p-6 border-b-2 border-slate-200 flex justify-between items-center bg-slate-50">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center font-varsity text-xl text-[var(--color-stitch-red)] border-2 border-stitch shrink-0 shadow-inner">
                      {selectedRival.user.display_name?.[0]}
                    </div>
                    <div>
                      <h3 className="text-xl font-varsity text-slate-900 uppercase tracking-tight">{selectedRival.user.display_name}'s Slip</h3>
                      <p className="text-xs text-slate-500 uppercase tracking-widest font-varsity">Locked Entry</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedRival(null)}
                    className="p-2 hover:bg-slate-200 rounded-full text-slate-400 transition-colors"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto bg-scorebook">
                  {[...selectedRival.entry.selections].sort((a, b) => b.chips - a.chips).map(sel => {
                    const team = teams.find(t => t.id === sel.team_id);
                    if (!team) return null;
                    
                    if (activeContest.metric_key !== 'wins') {
                      const endVal = activeContest.ending_stats?.[team.id];
                      const rawValue = endVal !== undefined ? endVal : (team.stats[activeContest.metric_key as keyof typeof team.stats] || 0);
                      const startValue = activeContest.starting_stats?.[team.id] || 0;
                      const isStarted = parseDate(activeContest.start_time) <= new Date();
                      const metricValue = isStarted ? Math.max(0, rawValue - startValue) : 0;

                      if (activeContest.metric_key === 'defense') {
                        const startDP = (activeContest as any).starting_doublePlays?.[team.id] || 0;
                        const startCS = (activeContest as any).starting_caughtStealing?.[team.id] || 0;
                        const startErr = (activeContest as any).starting_errors?.[team.id] || 0;

                        const rawDP = (activeContest as any).ending_doublePlays?.[team.id] !== undefined 
                          ? (activeContest as any).ending_doublePlays[team.id] 
                          : (team.stats.doublePlays || 0);
                        const rawCS = (activeContest as any).ending_caughtStealing?.[team.id] !== undefined 
                          ? (activeContest as any).ending_caughtStealing[team.id] 
                          : (team.stats.caughtStealing || 0);
                        const rawErr = (activeContest as any).ending_errors?.[team.id] !== undefined 
                          ? (activeContest as any).ending_errors[team.id] 
                          : (team.stats.errors || 0);

                        const dpVal = isStarted ? Math.max(0, rawDP - startDP) : 0;
                        const csVal = isStarted ? Math.max(0, rawCS - startCS) : 0;
                        const errVal = isStarted ? Math.max(0, rawErr - startErr) : 0;
                        const defVal = dpVal + csVal - errVal;

                        return (
                          <div key={sel.team_id} className="bg-white p-5 rounded-2xl border-2 border-slate-200 shadow-sm flex flex-col gap-3">
                            <div className="flex justify-between items-center">
                              <div>
                                <div className="font-varsity text-slate-900 uppercase tracking-tight text-base">{team.team_name}</div>
                                <div className="text-[9px] text-slate-500 uppercase tracking-widest font-varsity">
                                  {activeContest.is_draft ? 'Draft Pick' : 'Selection'}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-2xl font-varsity text-blue-600 tabular-nums tracking-tighter">
                                  {defVal}
                                </div>
                                <div className="text-[9px] text-slate-400 uppercase tracking-widest font-varsity leading-none">
                                  Defensive Score
                                </div>
                              </div>
                            </div>

                            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-[10px] space-y-1.5 font-varsity uppercase tracking-wider text-slate-600">
                              <div className="flex justify-between items-center">
                                <span>Double Plays Turned:</span>
                                <span className="font-mono text-emerald-600 font-bold">+{dpVal} <span className="text-[8px] text-slate-400">({startDP} → {rawDP})</span></span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span>Caught Stealing:</span>
                                <span className="font-mono text-emerald-600 font-bold">+{csVal} <span className="text-[8px] text-slate-400">({startCS} → {rawCS})</span></span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span>Errors Committed:</span>
                                <span className="font-mono text-rose-500 font-bold">-{errVal} <span className="text-[8px] text-slate-400">({startErr} → {rawErr})</span></span>
                              </div>
                              <div className="h-px bg-slate-200 my-0.5" />
                              <div className="flex justify-between items-center text-[11px] font-black text-slate-800">
                                <span>Calculation:</span>
                                <span>{dpVal} + {csVal} - {errVal} = {defVal}</span>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={sel.team_id} className="flex justify-between items-center p-4 rounded-xl border-2 border-slate-100 shadow-sm">
                          <div>
                            <div className="font-varsity text-slate-900 uppercase tracking-tight">{team.team_name}</div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-varsity">
                              {activeContest.is_draft ? 'Draft Pick' : 'Selection'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-varsity text-blue-600 uppercase tracking-tight">{metricValue} {formatMetric(activeContest.metric_key)}</div>
                          </div>
                        </div>
                      );
                    }

                    const endVal = activeContest.ending_stats?.[team.id];
                    const wins = endVal !== undefined ? endVal : team.stats.wins;
                    const gamesPlayed = team.stats.wins + team.stats.losses;
                    const projectedWins = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 162) : 0;
                    const isTrendingCorrect = sel.side === 'over' ? projectedWins > team.ou_line : projectedWins < team.ou_line;

                    const gamesRemaining = (activeContest.results_sealed || endVal !== undefined) ? 0 : (162 - (team.stats.wins + team.stats.losses));
                    const isClinched = sel.side === 'over' 
                      ? wins > team.ou_line 
                      : (wins + gamesRemaining) < team.ou_line;
                    const isEliminated = sel.side === 'over'
                      ? (wins + gamesRemaining) < team.ou_line
                      : wins > team.ou_line;

                    return (
                      <div key={sel.team_id} className="bg-slate-50 p-4 rounded-xl border-2 border-slate-100 shadow-sm transition-all">
                        <div className="flex justify-between items-center mb-3">
                          <div>
                            <div className="font-varsity text-slate-900 uppercase tracking-tight">{team.team_name}</div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-varsity flex flex-wrap items-center gap-y-1">
                              <span>{sel.side} {team.ou_line} • {sel.chips} Chips</span>
                              {isClinched && <span className="text-emerald-600 ml-2 font-black">CLINCHED</span>}
                              {isEliminated && <span className="text-rose-600 ml-2 font-black">ELIMINATED</span>}
                              {!isClinched && !isEliminated && endVal === undefined && gamesPlayed > 0 && (
                                <span className={`ml-2 px-1.5 py-0.5 rounded ${isTrendingCorrect ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'} font-black text-[7px]`}>
                                  PACE: {projectedWins} ({projectedWins > team.ou_line ? 'O' : 'U'})
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`font-varsity uppercase tracking-tight tabular-nums ${isClinched ? 'text-emerald-600' : isEliminated ? 'text-rose-600' : 'text-slate-400'}`}>
                              {wins}{endVal === undefined && ` - ${team.stats.losses}`}
                            </div>
                            <div className="text-[8px] text-slate-500 uppercase tracking-widest font-varsity">{endVal !== undefined ? 'Final' : 'Current'}</div>
                          </div>
                        </div>
                        <div className="relative h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div 
                            className={`absolute top-0 left-0 h-full transition-all duration-1000 ${isClinched ? 'bg-emerald-500' : isEliminated ? 'bg-rose-500' : 'bg-slate-400'}`}
                            style={{ width: `${Math.min((wins / team.ou_line) * 100, 100)}%` }}
                          />
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
