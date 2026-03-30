import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, updateDoc, collection, writeBatch, onSnapshot, getDocs, deleteDoc, query, Timestamp } from 'firebase/firestore';
import { toast } from 'react-hot-toast';
import { Database, ShieldCheck, AlertCircle, Clock, RefreshCw, Power, ListOrdered, Play, Trash2, UserMinus, Mail } from 'lucide-react';
import { MLB_TEAMS, DEFAULT_LINES } from '../mlbData';
import { UserProfile, Contest } from '../types';

export default function Admin() {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [contests, setContests] = useState<Contest[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [editingContestId, setEditingContestId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editMetric, setEditMetric] = useState('');
  const [teamLines, setTeamLines] = useState<any[]>([]);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editLineValue, setEditLineValue] = useState<string>('');

  useEffect(() => {
    const unsubContests = onSnapshot(collection(db, 'contests'), (snap) => {
      setContests(snap.docs.map(d => ({ id: d.id, ...d.data() } as Contest)));
    }, (error) => {
      console.error("Admin contests sync error:", error);
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
    }, (error) => {
      console.error("Admin users sync error:", error);
    });

    const unsubTeamLines = onSnapshot(collection(db, 'team_lines'), (snap) => {
      setTeamLines(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a: any, b: any) => a.team_name.localeCompare(b.team_name)));
    }, (error) => {
      console.error("Admin team lines sync error:", error);
    });

    const unsubSyncSettings = onSnapshot(doc(db, 'settings', 'mlb_sync'), (snap) => {
      if (snap.exists()) {
        setSyncEnabled(snap.data().enabled || false);
      }
    });

    return () => {
      unsubContests();
      unsubUsers();
      unsubTeamLines();
      unsubSyncSettings();
    };
  }, []);

  // Auto-snapshot logic for contests that have started but have no starting_stats
  useEffect(() => {
    const checkAutoSnapshots = async () => {
      const now = new Date();
      const contestsToSnapshot = contests.filter(c => 
        c.metric_key !== 'wins' && 
        !c.starting_stats && 
        c.start_time &&
        (typeof c.start_time === 'string' ? new Date(c.start_time) : (c.start_time as any).toDate()).getTime() <= now.getTime() &&
        (typeof c.end_time === 'string' ? new Date(c.end_time) : (c.end_time as any).toDate()).getTime() > now.getTime()
      );

      if (contestsToSnapshot.length > 0 && teamLines.length > 0) {
        console.log("Found contests needing auto-snapshot:", contestsToSnapshot.map(c => c.theme_name));
        const batch = writeBatch(db);
        
        contestsToSnapshot.forEach(contest => {
          const statsMap: Record<string, number> = {};
          teamLines.forEach(team => {
            statsMap[team.id] = team.stats[contest.metric_key as keyof typeof team.stats] || 0;
          });
          
          batch.update(doc(db, 'contests', contest.id), {
            starting_stats: statsMap,
            auto_snapshotted: true,
            last_updated: new Date().toISOString()
          });
        });

        try {
          await batch.commit();
          toast.success(`Automatically captured starting stats for ${contestsToSnapshot.length} contest(s)`);
        } catch (error) {
          console.error("Auto-snapshot failed:", error);
        }
      }
    };

    if (contests.length > 0 && teamLines.length > 0) {
      checkAutoSnapshots();
    }
  }, [contests, teamLines]);

  const generateDraftOrder = async (contestId: string) => {
    const contest = contests.find(c => c.id === contestId);
    if (!contest) return;

    if (contest.draft_status === 'in_progress' || contest.draft_status === 'completed') {
      const confirmReset = window.confirm("This draft is already in progress or completed. Regenerating the order will reset all draft progress. Are you sure?");
      if (!confirmReset) return;
    }

    // Shuffle users
    const shuffledUids = users.map(u => u.uid).sort(() => Math.random() - 0.5);

    try {
      await setDoc(doc(db, 'contests', contestId), {
        draft_order: shuffledUids,
        current_turn_index: 0,
        draft_status: 'pending'
      }, { merge: true });
      toast.success('Draft order generated!');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const startDraft = async (contestId: string) => {
    try {
      await setDoc(doc(db, 'contests', contestId), {
        draft_status: 'in_progress',
        current_turn_index: 0
      }, { merge: true });
      toast.success('Draft started!');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const snapshotStartingStats = async (contestId: string) => {
    const contest = contests.find(c => c.id === contestId);
    if (!contest) return;

    const statsMap: Record<string, number> = {};
    teamLines.forEach(team => {
      statsMap[team.id] = team.stats[contest.metric_key] || 0;
    });

    try {
      await updateDoc(doc(db, 'contests', contestId), {
        starting_stats: statsMap
      });
      toast.success(`Starting stats snapshotted for ${contest.theme_name}!`);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const updateContest = async (contestId: string) => {
    try {
      await setDoc(doc(db, 'contests', contestId), {
        theme_name: editTitle,
        start_time: Timestamp.fromDate(new Date(editStartTime)),
        end_time: Timestamp.fromDate(new Date(editEndTime)),
        description: editDescription,
        metric_key: editMetric
      }, { merge: true });
      toast.success('Contest updated!');
      setEditingContestId(null);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const deleteUser = async (uid: string) => {
    setLoading(true);
    try {
      const batch = writeBatch(db);
      
      // 1. Delete user document
      batch.delete(doc(db, 'users', uid));
      
      // 2. Delete user's picks in all contests and remove from draft orders
      for (const contest of contests) {
        // Delete entry
        batch.delete(doc(db, 'contests', contest.id, 'entries', uid));
        
        // Remove from draft order if present
        if (contest.draft_order && contest.draft_order.includes(uid)) {
          const newOrder = contest.draft_order.filter(id => id !== uid);
          batch.update(doc(db, 'contests', contest.id), {
            draft_order: newOrder
          });
        }
      }
      
      await batch.commit();
      toast.success("User and all their picks deleted successfully.");
      setUserToDelete(null);
    } catch (error) {
      console.error("Error deleting user:", error);
      toast.error("Failed to delete user and their picks.");
    } finally {
      setLoading(false);
    }
  };

  const resetUserPassword = async (email: string) => {
    if (!email) {
      toast.error("User email not found.");
      return;
    }
    
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      toast.success(`Password reset email sent to ${email}`);
    } catch (error: any) {
      console.error("Error sending password reset email:", error);
      toast.error(error.message || "Failed to send reset email.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSync = async () => {
    try {
      const syncRef = doc(db, 'settings', 'mlb_sync');
      await updateDoc(syncRef, {
        enabled: !syncEnabled
      });
      toast.success(`MLB Sync ${!syncEnabled ? 'Enabled' : 'Disabled'}`);
    } catch (error) {
      console.error('Error toggling sync:', error);
      toast.error('Failed to toggle sync');
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      toast.loading("Fetching MLB Standings...", { id: 'sync-status' });
      
      // 1. Fetch Standings
      const standingsRes = await fetch("https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026&standingsTypes=regularSeason");
      const standingsData = await standingsRes.json();
      
      if (!standingsData.records || standingsData.records.length === 0) {
        throw new Error("No standings records found in MLB API for 2026.");
      }

      const teamStatsMap: Record<string, { wins: number, losses: number }> = {};
      standingsData.records.forEach((record: any) => {
        record.teamRecords?.forEach((tr: any) => {
          teamStatsMap[tr.team.id.toString()] = {
            wins: tr.wins,
            losses: tr.losses
          };
        });
      });

      toast.loading("Updating team stats...", { id: 'sync-status' });
      
      const batch = writeBatch(db);
      let updatedCount = 0;

      // Process teams in chunks to avoid overwhelming the browser/API
      for (const team of MLB_TEAMS) {
        const mlbStats = teamStatsMap[team.id];
        if (mlbStats) {
          try {
            // Fetch HRs and Ks for each team
            const [hitRes, pitchRes] = await Promise.all([
              fetch(`https://statsapi.mlb.com/api/v1/teams/${team.id}/stats?stats=season&group=hitting&season=2026`),
              fetch(`https://statsapi.mlb.com/api/v1/teams/${team.id}/stats?stats=season&group=pitching&season=2026`)
            ]);
            
            const hitData = await hitRes.json();
            const pitchData = await pitchRes.json();
            
            const hrs = hitData.stats?.[0]?.splits?.[0]?.stat?.homeRuns || 0;
            const ks = pitchData.stats?.[0]?.splits?.[0]?.stat?.strikeOuts || 0;

            batch.update(doc(db, 'team_lines', team.id), {
              "stats.wins": mlbStats.wins,
              "stats.losses": mlbStats.losses,
              "stats.hrs": hrs,
              "stats.ks": ks,
              last_sync: new Date().toISOString()
            });
            updatedCount++;
          } catch (e) {
            console.warn(`Failed to fetch extra stats for ${team.name}`, e);
            // Still update wins/losses even if HRs/Ks fail
            batch.update(doc(db, 'team_lines', team.id), {
              "stats.wins": mlbStats.wins,
              "stats.losses": mlbStats.losses,
              last_sync: new Date().toISOString()
            });
            updatedCount++;
          }
        }
      }

      await batch.commit();
      toast.success(`Sync successful! ${updatedCount} teams updated.`, { id: 'sync-status' });
    } catch (error: any) {
      console.error("Manual sync error:", error);
      toast.error('Sync failed: ' + error.message, { id: 'sync-status' });
    } finally {
      setSyncing(false);
    }
  };

  const updateTeamLine = async (teamId: string) => {
    const val = parseFloat(editLineValue);
    if (isNaN(val)) {
      toast.error("Invalid line value");
      return;
    }

    setLoading(true);
    try {
      await setDoc(doc(db, 'team_lines', teamId), {
        ou_line: val,
        last_manual_update: new Date().toISOString()
      }, { merge: true });
      toast.success('Win total updated!');
      setEditingTeamId(null);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const seedData = async () => {
    setLoading(true);
    try {
      const batch = writeBatch(db);

      // 1. Seed Teams
      MLB_TEAMS.forEach((team) => {
        const teamRef = doc(db, 'team_lines', team.id);
        batch.set(teamRef, {
          team_name: team.name,
          abbreviation: team.abbr,
          ou_line: DEFAULT_LINES[team.id] || 81.0,
          stats: { wins: 0, losses: 0, hrs: 0, ks: 0 },
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
          name: 'May Sprint: Strikeout King', 
          description: 'Draft 3 teams. The total strikeouts thrown by your teams in May determines your score.',
          metric: 'ks', 
          start: '2026-05-01T00:00:00-04:00', 
          end: '2026-06-01T00:00:00-04:00', 
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
      toast.success('Database seeded successfully!');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteAllEntries = async () => {
    setLoading(true);
    try {
      let totalDeleted = 0;
      
      // We need to iterate through all contests and delete their entries subcollections
      for (const contest of contests) {
        const entriesRef = collection(db, 'contests', contest.id, 'entries');
        const entriesSnap = await getDocs(entriesRef);
        
        if (entriesSnap.empty) continue;

        // Delete in batches of 500
        const docs = entriesSnap.docs;
        for (let i = 0; i < docs.length; i += 500) {
          const batch = writeBatch(db);
          const chunk = docs.slice(i, i + 500);
          chunk.forEach((doc) => {
            batch.delete(doc.ref);
            totalDeleted++;
          });
          await batch.commit();
        }
      }

      // Also reset draft statuses if needed
      const resetBatch = writeBatch(db);
      contests.forEach(c => {
        if (c.is_draft) {
          resetBatch.update(doc(db, 'contests', c.id), {
            draft_status: 'pending',
            current_turn_index: 0
          });
        }
      });
      await resetBatch.commit();

      toast.success(`Deleted ${totalDeleted} entries and reset draft statuses.`);
      setShowDeleteConfirm(false);
    } catch (error: any) {
      toast.error('Error deleting entries: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 bg-slate-900 rounded-2xl border border-slate-800 shadow-xl">
      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck className="text-emerald-500 md:w-[32px] md:h-[32px]" size={28} />
        <h2 className="text-xl md:text-2xl font-bold">Admin Controls</h2>
      </div>

      <p className="text-sm text-slate-400 mb-8">
        Use these tools to initialize the database with MLB teams, O/U lines, and the initial 2026 season contest.
      </p>

      <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl mb-8 flex items-start gap-3">
        <Clock className="text-blue-500 shrink-0 mt-0.5" size={18} />
        <div className="text-xs text-blue-200 leading-relaxed">
          <span className="font-bold text-blue-500 uppercase">Note:</span> MLB stats sync is currently in <span className="font-black">MANUAL MODE</span>. Click the sync button below to update real-time standings from your browser.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <div className="p-4 md:p-6 bg-slate-950 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <RefreshCw className={`${syncing ? 'text-blue-500 animate-spin' : 'text-slate-500'} md:w-[24px] md:h-[24px]`} size={20} />
              <div>
                <h3 className="font-bold text-sm">MLB Stats Sync</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">Manual Trigger</p>
              </div>
            </div>
            <button
              onClick={handleToggleSync}
              className={`px-3 py-1 rounded-full text-[10px] font-black transition-all border ${
                syncEnabled 
                  ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-500' 
                  : 'bg-slate-800 border-slate-700 text-slate-500'
              }`}
            >
              {syncEnabled ? 'ENABLED' : 'DISABLED'}
            </button>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">
            Trigger a manual sync of real-time MLB standings, home runs, and strikeouts directly from your browser.
          </p>
          <div className="flex items-center gap-2 text-[10px] font-mono mb-4">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-blue-500">
              MODE: MANUAL (BROWSER-BASED)
            </span>
          </div>
          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="w-full px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-[10px] font-bold rounded-xl transition-all flex items-center justify-center gap-2 border border-slate-700"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync Now (Manual Test)'}
          </button>
        </div>

        <div className="p-4 md:p-6 bg-slate-950 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-3 mb-4">
            <Database className="text-blue-500 md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-bold text-sm">Data Seeding</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Initial Setup</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed mb-6">
            Reset teams, lines, and contests. Use this for initial setup or season resets.
          </p>
          <button
            onClick={seedData}
            disabled={loading}
            className="w-full px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
          >
            <Database size={16} />
            {loading ? 'Seeding...' : 'Seed Initial Data'}
          </button>
        </div>

        <div className="p-4 md:p-6 bg-slate-950 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-3 mb-4">
            <Trash2 className="text-rose-500 md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-bold text-sm">Clear Test Data</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Danger Zone</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed mb-6">
            Delete all user picks and entries across all contests. This will also reset draft progress.
          </p>
          
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full px-4 py-2 bg-rose-900/20 hover:bg-rose-900/40 border border-rose-500/30 text-rose-500 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <Trash2 size={16} />
              Delete All Picks
            </button>
          ) : (
            <div className="space-y-2">
              <button
                onClick={deleteAllEntries}
                disabled={loading}
                className="w-full px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
              >
                {loading ? 'Deleting...' : 'CONFIRM DELETE ALL'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loading}
                className="w-full px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-400 text-xs font-bold rounded-xl transition-all"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8">
        <div className="p-4 md:p-6 bg-slate-950 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-3 mb-6">
            <ListOrdered className="text-emerald-500 md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-bold text-sm">MLB Win Totals Management</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Adjust Over/Under Lines</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {teamLines.map(team => (
              <div key={team.id} className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between group">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold flex items-center gap-2 truncate">
                    <span className="text-slate-500 w-8 shrink-0">{team.abbreviation}</span>
                    <span className="truncate">{team.team_name}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Current Line: <span className="text-emerald-500 font-mono">{team.ou_line}</span>
                  </div>
                </div>

                {editingTeamId === team.id ? (
                  <div className="flex items-center gap-1">
                    <input 
                      type="number"
                      step="0.5"
                      value={editLineValue}
                      onChange={(e) => setEditLineValue(e.target.value)}
                      className="w-16 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-emerald-500"
                      autoFocus
                    />
                    <button
                      onClick={() => updateTeamLine(team.id)}
                      disabled={loading}
                      className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-all"
                    >
                      <Play size={12} />
                    </button>
                    <button
                      onClick={() => setEditingTeamId(null)}
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg transition-all"
                    >
                      <Power size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingTeamId(team.id);
                      setEditLineValue(team.ou_line.toString());
                    }}
                    className="p-2 text-slate-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8">
        <div className="p-4 md:p-6 bg-slate-950 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-3 mb-6">
            <Clock className="text-emerald-500 md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-bold text-sm">Contest Schedule Management</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Update Start & End Times</p>
            </div>
          </div>
          
          <div className="space-y-4">
            {contests.map(c => (
              <div key={c.id} className="p-4 bg-slate-900 rounded-xl border border-slate-800">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{c.theme_name}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">
                      ID: {c.id} • Metric: {c.metric_key}
                    </div>
                    {editingContestId !== c.id && (
                      <>
                        {c.description && (
                          <div className="text-[10px] text-slate-400 mt-2 italic line-clamp-1">
                            {c.description}
                          </div>
                        )}
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono text-slate-400">
                          <div>START: {new Date(c.start_time).toLocaleString()}</div>
                          <div>END: {new Date(c.end_time).toLocaleString()}</div>
                        </div>
                      </>
                    )}
                  </div>

                  {editingContestId === c.id ? (
                    <div className="flex flex-col gap-4 flex-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="w-full">
                          <label className="text-[8px] uppercase text-slate-500 block mb-1">Contest Title</label>
                          <input 
                            type="text" 
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] font-bold"
                          />
                        </div>
                        <div className="w-full">
                          <label className="text-[8px] uppercase text-slate-500 block mb-1">Metric Key</label>
                          <select 
                            value={editMetric}
                            onChange={(e) => setEditMetric(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] font-bold"
                          >
                            <option value="wins">Wins (O/U)</option>
                            <option value="hrs">Home Runs</option>
                            <option value="ks">Strikeouts</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="w-full">
                          <label className="text-[8px] uppercase text-slate-500 block mb-1">Start Time (ISO)</label>
                          <input 
                            type="text" 
                            value={editStartTime}
                            onChange={(e) => setEditStartTime(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] font-mono"
                          />
                        </div>
                        <div className="w-full">
                          <label className="text-[8px] uppercase text-slate-500 block mb-1">End Time (ISO)</label>
                          <input 
                            type="text" 
                            value={editEndTime}
                            onChange={(e) => setEditEndTime(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] font-mono"
                          />
                        </div>
                      </div>
                      <div className="w-full">
                        <label className="text-[8px] uppercase text-slate-500 block mb-1">Description</label>
                        <textarea 
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] leading-relaxed h-16 resize-none"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => updateContest(c.id)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-[10px] font-bold rounded-lg transition-all"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingContestId(null)}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold rounded-lg transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                      <div className="flex items-center gap-2">
                        {c.metric_key !== 'wins' && (
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => snapshotStartingStats(c.id)}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-2 border ${
                                c.starting_stats 
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' 
                                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              <RefreshCw size={14} className={c.starting_stats ? '' : 'animate-pulse'} />
                              {c.starting_stats ? 'Snapshot Taken' : 'Take Start Snapshot'}
                            </button>
                            {!c.starting_stats && (
                              <span className="text-[7px] text-slate-500 uppercase tracking-tighter italic">
                                * System will auto-snapshot on start
                              </span>
                            )}
                          </div>
                        )}
                        <button
                        onClick={() => {
                          setEditingContestId(c.id);
                          setEditStartTime(c.start_time instanceof Timestamp ? c.start_time.toDate().toISOString() : c.start_time);
                          setEditEndTime(c.end_time instanceof Timestamp ? c.end_time.toDate().toISOString() : c.end_time);
                          setEditDescription(c.description || '');
                          setEditTitle(c.theme_name);
                          setEditMetric(c.metric_key);
                        }}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold rounded-lg transition-all flex items-center gap-2"
                      >
                        <Clock size={14} />
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8">
        <div className="p-4 md:p-6 bg-slate-950 rounded-2xl border border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <ListOrdered className="text-amber-500 md:w-[24px] md:h-[24px]" size={20} />
              <div>
                <h3 className="font-bold text-sm">Draft Management</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">Snake Draft Controls</p>
              </div>
            </div>
            <div className="px-3 py-1 bg-slate-900 rounded-lg border border-slate-800 text-[10px] font-black text-slate-400 uppercase tracking-widest self-start sm:self-auto">
              Total Users: <span className="text-emerald-500">{users.length}</span>
            </div>
          </div>
          
          <div className="space-y-4">
            {contests.filter(c => c.is_active && c.is_draft).map(c => (
              <div key={c.id} className="p-4 bg-slate-900 rounded-xl border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{c.theme_name}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">
                    Status: <span className="text-amber-500">{c.draft_status || 'pending'}</span> • 
                    Current Order: {c.draft_order ? (
                      <span className="text-slate-300">
                        {c.draft_order.length} players ({c.draft_order.map(uid => users.find(u => u.uid === uid)?.display_name || 'Unknown').join(', ')})
                      </span>
                    ) : 'Not set'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => generateDraftOrder(c.id)}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <ListOrdered size={14} />
                    Generate Order
                  </button>
                  <button
                    onClick={() => startDraft(c.id)}
                    disabled={!c.draft_order || c.draft_status === 'in_progress'}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <Play size={14} />
                    Start Draft
                  </button>
                </div>
              </div>
            ))}
            {contests.filter(c => c.is_draft).length === 0 && (
              <div className="text-center py-4 text-xs text-slate-500 italic">
                No draft contests found.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8">
        <div className="p-4 md:p-6 bg-slate-950 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-3 mb-6">
            <UserMinus className="text-rose-500 md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-bold text-sm">User Management</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Delete or Manage Users</p>
            </div>
          </div>
          
          <div className="space-y-2 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
            {users.map(u => (
              <div key={u.uid} className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-emerald-500 shrink-0">
                    {u.display_name?.charAt(0) || u.email?.charAt(0) || '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold flex items-center gap-2 truncate">
                      <span className="truncate">{u.display_name}</span>
                      {u.role === 'admin' && <span className="text-[8px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded uppercase tracking-widest shrink-0">Admin</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{u.email}</div>
                  </div>
                </div>
                
                {u.uid !== auth.currentUser?.uid && (
                  <div className="flex items-center gap-2">
                    {userToDelete === u.uid ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteUser(u.uid)}
                          disabled={loading}
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-[10px] font-bold rounded text-white transition-all"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setUserToDelete(null)}
                          disabled={loading}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold rounded text-slate-400 transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => resetUserPassword(u.email || '')}
                          disabled={loading}
                          className="p-2 text-slate-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="Send Password Reset Email"
                        >
                          <Mail size={16} />
                        </button>
                        <button
                          onClick={() => setUserToDelete(u.uid)}
                          disabled={loading}
                          className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="Delete User"
                        >
                          <UserMinus size={16} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl mt-8 flex items-start gap-3">
        <AlertCircle className="text-rose-500 shrink-0 mt-0.5" size={18} />
        <div className="text-xs text-rose-200 leading-relaxed">
          <span className="font-bold text-rose-500 uppercase">Warning:</span> Seeding will reset all team stats (wins, losses, home runs) to zero. It will <span className="underline">not</span> delete user entries or picks, but current progress will be lost.
        </div>
      </div>
    </div>
  );
}
