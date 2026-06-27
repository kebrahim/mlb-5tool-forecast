import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, updateDoc, collection, writeBatch, onSnapshot, getDocs, deleteDoc, query, Timestamp, increment } from 'firebase/firestore';
import { toast } from 'react-hot-toast';
import { Database, ShieldCheck, AlertCircle, Clock, RefreshCw, Power, ListOrdered, Play, Trash2, UserMinus, Mail, Search, Trophy, Lock, Wrench, Users, Sparkles } from 'lucide-react';
import { MLB_TEAMS, DEFAULT_LINES } from '../mlbData';
import { UserProfile, Contest } from '../types';

export default function Admin() {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [contests, setContests] = useState<Contest[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [editingContestId, setEditingContestId] = useState<string | null>(null);
  const [editingEndingStatsId, setEditingEndingStatsId] = useState<string | null>(null);
  const [tempEndingStats, setTempEndingStats] = useState<Record<string, number>>({});
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
  const [selectedContestForPoints, setSelectedContestForPoints] = useState<string>('');
  const [contestEntries, setContestEntries] = useState<any[]>([]);
  const [rewardPoints, setRewardPoints] = useState<Record<number, number>>({ 0: 9, 1: 6, 2: 3, 3: 0, 4: 0 });
  const [distributing, setDistributing] = useState(false);
  const [payoutConfirming, setPayoutConfirming] = useState(false);

  enum OperationType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    LIST = 'list',
    GET = 'get',
    WRITE = 'write',
  }

  interface FirestoreErrorInfo {
    error: string;
    operationType: OperationType;
    path: string | null;
    authInfo: {
      userId?: string | null;
      email?: string | null;
      emailVerified?: boolean | null;
      isAnonymous?: boolean | null;
    }
  }

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    toast.error(`Permission Error: ${operationType} on ${path}. Check console for details.`);
    throw new Error(JSON.stringify(errInfo));
  };

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

  useEffect(() => {
    const unsubContests = onSnapshot(collection(db, 'contests'), (snap) => {
      const mlbContestIds = ['season_2026', 'april_2026', 'may_2026', 'june_2026', 'july_2026'];
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Contest))
        .filter(c => mlbContestIds.includes(c.id));
      const sortedList = [...list].sort((a, b) => parseDate(a.end_time).getTime() - parseDate(b.end_time).getTime());
      setContests(sortedList);
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

  // Auto-snapshot logic for contests that have started but have no starting_stats, and completed contests with no ending_stats
  useEffect(() => {
    const checkAutoSnapshots = async () => {
      const now = new Date();
      const contestsToSnapshot = contests.filter(c => 
        c.metric_key !== 'wins' && 
        !c.starting_stats && 
        c.start_time &&
        parseDate(c.start_time).getTime() <= now.getTime()
      );

      const contestsToSeal = contests.filter(c =>
        c.metric_key !== 'wins' &&
        c.starting_stats &&
        !c.ending_stats &&
        c.end_time &&
        parseDate(c.end_time).getTime() <= now.getTime()
      );

      if ((contestsToSnapshot.length > 0 || contestsToSeal.length > 0) && !syncing) {
        console.log("Found contests needing auto-starting stats:", contestsToSnapshot.map(c => c.theme_name));
        console.log("Found contests needing auto-ending stats:", contestsToSeal.map(c => c.theme_name));
        
        try {
          setSyncing(true);
          
          const batch = writeBatch(db);
          let didUpdate = false;
          
          // Capture starting stats
          for (const contest of contestsToSnapshot) {
            toast.loading(`Capturing historical baseline for ${contest.theme_name}...`, { id: 'auto-snap' });
            
            // Calculate the day before the contest starts
            const startDate = parseDate(contest.start_time);
            const baselineDate = new Date(startDate);
            baselineDate.setDate(baselineDate.getDate() - 1);
            const dateStr = baselineDate.toISOString().split('T')[0];
            
            // Fetch historical stats for that date
            const historicalStats = await fetchMLBStatsForDate(dateStr, false);
            
            const statsMap: Record<string, number> = {};
            const dpMap: Record<string, number> = {};
            const csMap: Record<string, number> = {};
            const errMap: Record<string, number> = {};

            MLB_TEAMS.forEach(team => {
              const stats = historicalStats[team.id];
              if (stats) {
                statsMap[team.id] = stats[contest.metric_key as keyof typeof stats] || 0;
                if (contest.metric_key === 'defense') {
                  dpMap[team.id] = stats.doublePlays || 0;
                  csMap[team.id] = stats.caughtStealing || 0;
                  errMap[team.id] = stats.errors || 0;
                }
              } else {
                statsMap[team.id] = 0;
                if (contest.metric_key === 'defense') {
                  dpMap[team.id] = 0;
                  csMap[team.id] = 0;
                  errMap[team.id] = 0;
                }
              }
            });
            
            const updatePayload: any = {
              starting_stats: statsMap,
              baseline_date: dateStr,
              auto_snapshotted: true,
              last_updated: new Date().toISOString()
            };
            if (contest.metric_key === 'defense') {
              updatePayload.starting_doublePlays = dpMap;
              updatePayload.starting_caughtStealing = csMap;
              updatePayload.starting_errors = errMap;
            }

            batch.update(doc(db, 'contests', contest.id), updatePayload);
            didUpdate = true;
          }

          // Capture ending stats (sealing results)
          for (const contest of contestsToSeal) {
            toast.loading(`Sealing and capturing final stats for ${contest.theme_name}...`, { id: 'auto-seal' });
            
            // Calculate the ending date
            const endDate = parseDate(contest.end_time);
            const dateStr = endDate.toISOString().split('T')[0];
            
            // Fetch historical stats for that date
            const historicalStats = await fetchMLBStatsForDate(dateStr, false);
            
            const statsMap: Record<string, number> = {};
            const dpMap: Record<string, number> = {};
            const csMap: Record<string, number> = {};
            const errMap: Record<string, number> = {};

            MLB_TEAMS.forEach(team => {
              const stats = historicalStats[team.id];
              if (stats) {
                statsMap[team.id] = stats[contest.metric_key as keyof typeof stats] || 0;
                if (contest.metric_key === 'defense') {
                  dpMap[team.id] = stats.doublePlays || 0;
                  csMap[team.id] = stats.caughtStealing || 0;
                  errMap[team.id] = stats.errors || 0;
                }
              } else {
                statsMap[team.id] = 0;
                if (contest.metric_key === 'defense') {
                  dpMap[team.id] = 0;
                  csMap[team.id] = 0;
                  errMap[team.id] = 0;
                }
              }
            });
            
            const updatePayload: any = {
              ending_stats: statsMap,
              results_sealed: true,
              last_updated: new Date().toISOString()
            };
            if (contest.metric_key === 'defense') {
              updatePayload.ending_doublePlays = dpMap;
              updatePayload.ending_caughtStealing = csMap;
              updatePayload.ending_errors = errMap;
            }

            batch.update(doc(db, 'contests', contest.id), updatePayload);
            didUpdate = true;
          }

          if (didUpdate) {
            await batch.commit();
            if (contestsToSnapshot.length > 0) {
              toast.success(`Automatically captured historical baselines for ${contestsToSnapshot.length} contest(s)`, { id: 'auto-snap' });
            }
            if (contestsToSeal.length > 0) {
              toast.success(`Automatically sealed and saved final results for ${contestsToSeal.length} completed contest(s)`, { id: 'auto-seal' });
            }
          }
        } catch (error) {
          console.error("Auto-snapshot/seal historical fetch failed:", error);
          toast.error("Auto-snapshot/seal failed. Please trigger a manual operation.", { id: 'auto-snap' });
        } finally {
          setSyncing(false);
        }
      }
    };

    if (contests.length > 0) {
      checkAutoSnapshots();
    }
  }, [contests, syncing]);

  useEffect(() => {
    if (selectedContestForPoints) {
      const q = query(collection(db, 'contests', selectedContestForPoints, 'entries'));
      const unsubEntries = onSnapshot(q, (snap) => {
        const contest = contests.find(c => c.id === selectedContestForPoints);
        if (!contest) return;

        const entries = snap.docs.map(d => ({ uid: d.id, ...d.data() } as any));
        const scored = entries.map(entry => {
          let score = 0;
          entry.selections.forEach((sel: any) => {
            const team = teamLines.find(t => t.id === sel.team_id);
            if (team) {
              if (contest.metric_key === 'wins') {
                const gamesRemaining = 162 - (team.stats.wins + team.stats.losses);
                const isClinched = sel.side === 'over' 
                  ? team.stats.wins > team.ou_line 
                  : (team.stats.wins + gamesRemaining) < team.ou_line;
                if (isClinched) score += (contest.use_chips ? (sel.chips || 0) : 1);
              } else {
                const val = team.stats[contest.metric_key as keyof typeof team.stats] || 0;
                const startVal = contest.starting_stats?.[team.id] || 0;
                score += Math.max(0, val - startVal);
              }
            }
          });
          return { ...entry, score };
        }).sort((a, b) => b.score - a.score);
        
        // Calculate ranks with ties
        let currentRank = 0;
        const ranked = scored.map((entry, index) => {
          if (index > 0 && entry.score < scored[index - 1].score) {
            currentRank = index;
          }
          return { ...entry, rank: currentRank };
        });
        
        setContestEntries(ranked);
      });
      return () => unsubEntries();
    } else {
      setContestEntries([]);
    }
  }, [selectedContestForPoints, contests, teamLines]);

  const awardPoints = async () => {
    if (!selectedContestForPoints || contestEntries.length === 0) return;
    
    const contest = contests.find(c => c.id === selectedContestForPoints);
    if (!contest) return;

    setDistributing(true);
    try {
      const batch = writeBatch(db);
      let awardedCount = 0;
      
      // Award to the list
      contestEntries.forEach((entry) => {
        const points = rewardPoints[entry.rank] || 0;
        if (points > 0) {
          batch.update(doc(db, 'users', entry.uid), {
            total_cp: increment(points)
          });
          awardedCount++;
        }
      });

      // Mark contest as awarded
      batch.update(doc(db, 'contests', selectedContestForPoints), {
        points_awarded: true,
        awarded_at: new Date().toISOString()
      });

      await batch.commit();
      toast.success(`Distributed CP to ${awardedCount} contestants!`);
      setPayoutConfirming(false);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, `contests/${selectedContestForPoints}/payout`);
    } finally {
      setDistributing(false);
    }
  };

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

  const autoCompleteDraft = async (contestId: string) => {
    const contest = contests.find(c => c.id === contestId);
    if (!contest) return;

    setSyncing(true);
    toast.loading(`Simulating and completing draft for ${contest.theme_name}...`, { id: 'auto-draft' });

    try {
      // 1. Get or Generate draft order
      let draftOrder = contest.draft_order || [];
      if (draftOrder.length === 0) {
        // If there are no users besides the current user, or fewer than 4, make sure demo users exist
        let draftingUsers = [...users];
        if (draftingUsers.length < 4) {
          // Auto seed demo players if they aren't there so we have a good draft
          const demoPlayers = [
            { uid: 'demo_babe', display_name: 'Babe Ruth', email: 'babe@ballpark.com', total_cp: 350, role: 'player' as const },
            { uid: 'demo_jackie', display_name: 'Jackie Robinson', email: 'jackie@ballpark.com', total_cp: 280, role: 'player' as const },
            { uid: 'demo_ted', display_name: 'Ted Williams', email: 'ted@ballpark.com', total_cp: 420, role: 'player' as const },
            { uid: 'demo_mickey', display_name: 'Mickey Mantle', email: 'mickey@ballpark.com', total_cp: 190, role: 'player' as const }
          ];
          const seedBatch = writeBatch(db);
          demoPlayers.forEach(p => {
            if (!draftingUsers.find(du => du.uid === p.uid)) {
              seedBatch.set(doc(db, 'users', p.uid), p, { merge: true });
              draftingUsers.push(p);
            }
          });
          await seedBatch.commit();
        }
        draftOrder = draftingUsers.map(u => u.uid).sort(() => Math.random() - 0.5);
      }

      // 2. Simulate 3-round Snake Draft
      const playerPicks: Record<string, any[]> = {};
      draftOrder.forEach(uid => {
        playerPicks[uid] = [];
      });

      const draftedTeamIds = new Set<string>();
      const totalRounds = contest.selection_limit || 3;
      let absolutePickNum = 0;

      for (let r = 0; r < totalRounds; r++) {
        // Snake draft turn order
        const roundOrder = (r % 2 === 1) ? [...draftOrder].reverse() : [...draftOrder];
        
        for (const uid of roundOrder) {
          // Find an available team
          const availableTeams = MLB_TEAMS.filter(t => !draftedTeamIds.has(t.id));
          if (availableTeams.length === 0) break;

          // Pick a random team
          const chosenTeam = availableTeams[Math.floor(Math.random() * availableTeams.length)];
          draftedTeamIds.add(chosenTeam.id);

          playerPicks[uid].push({
            team_id: chosenTeam.id,
            chips: 1,
            side: 'over',
            pick_number: absolutePickNum
          });
          absolutePickNum++;
        }
      }

      // 3. Write entries to Firestore
      const entriesBatch = writeBatch(db);
      draftOrder.forEach(uid => {
        const entryRef = doc(db, 'contests', contestId, 'entries', uid);
        entriesBatch.set(entryRef, {
          selections: playerPicks[uid],
          score: 0,
          is_valid: true,
          last_updated: new Date().toISOString()
        });
      });

      // 4. Handle starting stats baseline (especially for past contests)
      let startingStats = contest.starting_stats;
      let updatePayload: any = {
        draft_order: draftOrder,
        current_turn_index: absolutePickNum,
        draft_status: 'completed',
        last_updated: new Date().toISOString()
      };

      if (!startingStats) {
        toast.loading(`Capturing baseline stats for ${contest.theme_name}...`, { id: 'auto-draft' });
        const startDate = parseDate(contest.start_time);
        const baselineDate = new Date(startDate);
        baselineDate.setDate(baselineDate.getDate() - 1);
        const dateStr = baselineDate.toISOString().split('T')[0];

        try {
          const historicalStats = await fetchMLBStatsForDate(dateStr, false);
          const statsMap: Record<string, number> = {};
          const dpMap: Record<string, number> = {};
          const csMap: Record<string, number> = {};
          const errMap: Record<string, number> = {};

          MLB_TEAMS.forEach(team => {
            const stats = historicalStats[team.id];
            if (stats) {
              statsMap[team.id] = stats[contest.metric_key as keyof typeof stats] || 0;
              if (contest.metric_key === 'defense') {
                dpMap[team.id] = stats.doublePlays || 0;
                csMap[team.id] = stats.caughtStealing || 0;
                errMap[team.id] = stats.errors || 0;
              }
            } else {
              statsMap[team.id] = 0;
              if (contest.metric_key === 'defense') {
                dpMap[team.id] = 0;
                csMap[team.id] = 0;
                errMap[team.id] = 0;
              }
            }
          });

          updatePayload.starting_stats = statsMap;
          updatePayload.baseline_date = dateStr;
          updatePayload.auto_snapshotted = true;
          if (contest.metric_key === 'defense') {
            updatePayload.starting_doublePlays = dpMap;
            updatePayload.starting_caughtStealing = csMap;
            updatePayload.starting_errors = errMap;
          }
        } catch (baselineErr) {
          console.error("Failed to fetch historical starting stats baseline during auto-draft:", baselineErr);
          const fallbackMap: Record<string, number> = {};
          MLB_TEAMS.forEach(t => {
            fallbackMap[t.id] = 0;
          });
          updatePayload.starting_stats = fallbackMap;
        }
      }

      // If the contest is already completed by end date, let's also take the ending snapshot!
      const now = new Date();
      const endTime = parseDate(contest.end_time);
      if (endTime <= now && !contest.ending_stats) {
        toast.loading(`Capturing final results for completed contest ${contest.theme_name}...`, { id: 'auto-draft' });
        const dateStr = endTime.toISOString().split('T')[0];
        try {
          const historicalStats = await fetchMLBStatsForDate(dateStr, false);
          const statsMap: Record<string, number> = {};
          const dpMap: Record<string, number> = {};
          const csMap: Record<string, number> = {};
          const errMap: Record<string, number> = {};

          MLB_TEAMS.forEach(team => {
            const stats = historicalStats[team.id];
            if (stats) {
              statsMap[team.id] = stats[contest.metric_key as keyof typeof stats] || 0;
              if (contest.metric_key === 'defense') {
                dpMap[team.id] = stats.doublePlays || 0;
                csMap[team.id] = stats.caughtStealing || 0;
                errMap[team.id] = stats.errors || 0;
              }
            } else {
              statsMap[team.id] = 0;
              if (contest.metric_key === 'defense') {
                dpMap[team.id] = 0;
                csMap[team.id] = 0;
                errMap[team.id] = 0;
              }
            }
          });

          updatePayload.ending_stats = statsMap;
          updatePayload.results_sealed = true;
          if (contest.metric_key === 'defense') {
            updatePayload.ending_doublePlays = dpMap;
            updatePayload.ending_caughtStealing = csMap;
            updatePayload.ending_errors = errMap;
          }
        } catch (endingErr) {
          console.error("Failed to fetch historical ending stats during auto-draft:", endingErr);
        }
      }

      entriesBatch.update(doc(db, 'contests', contestId), updatePayload);
      await entriesBatch.commit();

      toast.success(`Draft successfully simulated and finalized for ${contest.theme_name}!`, { id: 'auto-draft' });
    } catch (error: any) {
      console.error("Error auto-completing draft:", error);
      toast.error(`Auto-draft failed: ${error.message}`, { id: 'auto-draft' });
    } finally {
      setSyncing(false);
    }
  };

  const fetchMLBStatsForDate = async (dateStr: string, showToasts = true) => {
    const season = dateStr.split('-')[0];
    const apiDateStr = dateStr;

    if (showToasts) toast.loading(`Fetching historical MLB stats for ${dateStr}...`, { id: 'hist-sync' });
    
    // 1. Fetch Standings as of date (for Wins/Losses)
    const standingsRes = await fetch(`https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${season}&date=${apiDateStr}&standingsTypes=regularSeason`);
    const standingsData = await standingsRes.json();
    
    const teamStats: Record<string, any> = {};
    standingsData.records?.forEach((record: any) => {
      record.teamRecords?.forEach((tr: any) => {
        teamStats[tr.team.id.toString()] = {
          wins: tr.wins,
          losses: tr.losses,
          hrs: 0,
          ks: 0
        };
      });
    });

    // 2. Fetch Team Stats (HRs/Ks) using gameLog summation
    // We use Promise.all to fetch all teams in parallel
    const statsPromises = MLB_TEAMS.map(async (team) => {
      try {
        // Fetch hitting gameLog
        const hitRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${team.id}/stats?stats=gameLog&group=hitting&season=${season}&endDate=${apiDateStr}&gameType=R`);
        const hitData = await hitRes.json();
        
        let totalHRs = 0;
        let totalSBs = 0;
        hitData.stats?.[0]?.splits?.forEach((split: any) => {
          totalHRs += split.stat?.homeRuns || 0;
          totalSBs += split.stat?.stolenBases || 0;
        });

        // Fetch pitching gameLog
        const pitchRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${team.id}/stats?stats=gameLog&group=pitching&season=${season}&endDate=${apiDateStr}&gameType=R`);
        const pitchData = await pitchRes.json();
        
        let totalKs = 0;
        pitchData.stats?.[0]?.splits?.forEach((split: any) => {
          totalKs += split.stat?.strikeOuts || 0;
        });

        // Fetch fielding gameLog
        const fieldRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${team.id}/stats?stats=gameLog&group=fielding&season=${season}&endDate=${apiDateStr}&gameType=R`);
        const fieldData = await fieldRes.json();
        let totalDPs = 0;
        let totalErrors = 0;
        fieldData.stats?.[0]?.splits?.forEach((split: any) => {
          totalDPs += split.stat?.doublePlays || 0;
          totalErrors += split.stat?.errors || 0;
        });

        // Fetch catching gameLog
        const catchRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${team.id}/stats?stats=gameLog&group=catching&season=${season}&endDate=${apiDateStr}&gameType=R`);
        const catchData = await catchRes.json();
        let totalCS = 0;
        catchData.stats?.[0]?.splits?.forEach((split: any) => {
          totalCS += split.stat?.caughtStealing || 0;
        });
        
        return {
          id: team.id,
          hrs: totalHRs,
          ks: totalKs,
          stolenBases: totalSBs,
          doublePlays: totalDPs,
          caughtStealing: totalCS,
          errors: totalErrors,
          defense: totalDPs + totalCS - totalErrors
        };
      } catch (e) {
        console.error(`Error fetching historical stats for ${team.name}`, e);
        return { id: team.id, hrs: 0, ks: 0, stolenBases: 0, doublePlays: 0, caughtStealing: 0, errors: 0, defense: 0 };
      }
    });

    const allStats = await Promise.all(statsPromises);
    allStats.forEach(stat => {
      if (teamStats[stat.id]) {
        teamStats[stat.id].hrs = stat.hrs;
        teamStats[stat.id].ks = stat.ks;
        teamStats[stat.id].stolenBases = stat.stolenBases;
        teamStats[stat.id].doublePlays = stat.doublePlays;
        teamStats[stat.id].caughtStealing = stat.caughtStealing;
        teamStats[stat.id].errors = stat.errors;
        teamStats[stat.id].defense = stat.defense;
      } else {
        // If team not in standings (unlikely but possible if no games played yet), still record stats
        teamStats[stat.id.toString()] = {
          wins: 0,
          losses: 0,
          hrs: stat.hrs,
          ks: stat.ks,
          stolenBases: stat.stolenBases,
          doublePlays: stat.doublePlays,
          caughtStealing: stat.caughtStealing,
          errors: stat.errors,
          defense: stat.defense
        };
      }
    });

    if (showToasts) toast.success(`Historical stats for ${dateStr} retrieved.`, { id: 'hist-sync' });
    return teamStats;
  };

  const testMlbApi = async () => {
    const testTeamId = "108"; // LAA
    const testDate = "2024-04-10";
    setSyncing(true);
    try {
      toast.loading(`Testing MLB API for LAA as of ${testDate}...`, { id: 'api-test' });
      
      // 1. Test hitting gameLog (HRs)
      const hitRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${testTeamId}/stats?stats=gameLog&group=hitting&season=2024&endDate=${testDate}`);
      const hitData = await hitRes.json();
      const hGames = hitData.stats?.[0]?.splits?.length || 0;
      let hrs = 0;
      hitData.stats?.[0]?.splits?.forEach((s: any) => hrs += s.stat.homeRuns);

      // 2. Test pitching gameLog (Ks)
      const pitchRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${testTeamId}/stats?stats=gameLog&group=pitching&season=2024&endDate=${testDate}`);
      const pitchData = await pitchRes.json();
      const pGames = pitchData.stats?.[0]?.splits?.length || 0;
      let ks = 0;
      pitchData.stats?.[0]?.splits?.forEach((s: any) => ks += s.stat.strikeOuts);
      
      console.log(`API Test Results for LAA as of ${testDate}:`);
      console.log(`Hitting Games: ${hGames}, HRs: ${hrs}`);
      console.log(`Pitching Games: ${pGames}, Pitching Ks: ${ks}`);
      
      toast.success(`API Test Complete! LAA had ${hrs} HRs and ${ks} Pitching Ks. Check console.`, { id: 'api-test' });
    } catch (error: any) {
      console.error("API Test Error:", error);
      toast.error(`API Test Failed: ${error.message}`, { id: 'api-test' });
    } finally {
      setSyncing(false);
    }
  };

  const snapshotStartingStats = async (contestId: string) => {
    const contest = contests.find(c => c.id === contestId);
    if (!contest) return;

    try {
      setSyncing(true);
      
      // Calculate the day before the contest starts for the baseline
      const startDate = parseDate(contest.start_time);
      const baselineDate = new Date(startDate);
      baselineDate.setDate(baselineDate.getDate() - 1);
      const dateStr = baselineDate.toISOString().split('T')[0];

      const historicalStats = await fetchMLBStatsForDate(dateStr, true);
      
      const statsMap: Record<string, number> = {};
      const dpMap: Record<string, number> = {};
      const csMap: Record<string, number> = {};
      const errMap: Record<string, number> = {};

      MLB_TEAMS.forEach(team => {
        const stats = historicalStats[team.id];
        if (stats) {
          statsMap[team.id] = stats[contest.metric_key as keyof typeof stats] || 0;
          if (contest.metric_key === 'defense') {
            dpMap[team.id] = stats.doublePlays || 0;
            csMap[team.id] = stats.caughtStealing || 0;
            errMap[team.id] = stats.errors || 0;
          }
        } else {
          statsMap[team.id] = 0;
          if (contest.metric_key === 'defense') {
            dpMap[team.id] = 0;
            csMap[team.id] = 0;
            errMap[team.id] = 0;
          }
        }
      });

      const updatePayload: any = {
        starting_stats: statsMap,
        baseline_date: dateStr
      };
      if (contest.metric_key === 'defense') {
        updatePayload.starting_doublePlays = dpMap;
        updatePayload.starting_caughtStealing = csMap;
        updatePayload.starting_errors = errMap;
      }

      await updateDoc(doc(db, 'contests', contestId), updatePayload);
      
      toast.success(`Historical baseline (as of ${dateStr}) snapshotted for ${contest.theme_name}!`);
    } catch (error: any) {
      console.error("Manual snapshot error:", error);
      toast.error(error.message);
    } finally {
      setSyncing(false);
    }
  };

  const snapshotEndingStats = async (contestId: string) => {
    const contest = contests.find(c => c.id === contestId);
    if (!contest) return;

    try {
      setSyncing(true);
      
      // Calculate the date the contest ended
      const endDate = parseDate(contest.end_time);
      const dateStr = endDate.toISOString().split('T')[0];

      toast.loading(`Capturing final stats as of ${dateStr}...`, { id: 'final-snap' });
      const historicalStats = await fetchMLBStatsForDate(dateStr, false);
      
      const statsMap: Record<string, number> = {};
      const dpMap: Record<string, number> = {};
      const csMap: Record<string, number> = {};
      const errMap: Record<string, number> = {};

      MLB_TEAMS.forEach(team => {
        const stats = historicalStats[team.id];
        if (stats) {
          statsMap[team.id] = stats[contest.metric_key as keyof typeof stats] || 0;
          if (contest.metric_key === 'defense') {
            dpMap[team.id] = stats.doublePlays || 0;
            csMap[team.id] = stats.caughtStealing || 0;
            errMap[team.id] = stats.errors || 0;
          }
        } else {
          statsMap[team.id] = 0;
          if (contest.metric_key === 'defense') {
            dpMap[team.id] = 0;
            csMap[team.id] = 0;
            errMap[team.id] = 0;
          }
        }
      });

      const updatePayload: any = {
        ending_stats: statsMap,
        results_sealed: true,
        last_updated: new Date().toISOString()
      };
      if (contest.metric_key === 'defense') {
        updatePayload.ending_doublePlays = dpMap;
        updatePayload.ending_caughtStealing = csMap;
        updatePayload.ending_errors = errMap;
      }

      await updateDoc(doc(db, 'contests', contestId), updatePayload);
      
      toast.success(`Final results sealed as of ${dateStr} for ${contest.theme_name}!`, { id: 'final-snap' });
    } catch (error: any) {
      console.error("Manual ending snapshot error:", error);
      toast.error(error.message, { id: 'final-snap' });
    } finally {
      setSyncing(false);
    }
  };

  const repairAprilStats = async (contestId: string) => {
    const contest = contests.find(c => c.id === contestId);
    if (!contest) return;

    setEditingEndingStatsId(contestId);
    
    // Initialize with current ending_stats or starting_stats
    const initialStats: Record<string, number> = {};
    const currentEnding = contest.ending_stats || {};
    const currentStarting = contest.starting_stats || {};
    
    MLB_TEAMS.forEach(team => {
      // If ending_stats exist, use them. 
      // If not, we might want to default to starting_stats + some value (like in the repair function)
      // but let's just default to starting_stats if ending_stats don't exist yet
      initialStats[team.id] = currentEnding[team.id] !== undefined ? currentEnding[team.id] : (currentStarting[team.id] || 0);
    });
    
    setTempEndingStats(initialStats);
  };

  const saveEndingStats = async (contestId: string) => {
    try {
      setSyncing(true);
      toast.loading('Saving manual stats...', { id: 'save-stats' });

      await updateDoc(doc(db, 'contests', contestId), {
        ending_stats: tempEndingStats,
        results_sealed: true,
        last_updated: new Date().toISOString()
      });

      toast.success('Stats updated and results sealed!', { id: 'save-stats' });
      setEditingEndingStatsId(null);
    } catch (error: any) {
      console.error("Save stats error:", error);
      toast.error(error.message, { id: 'save-stats' });
    } finally {
      setSyncing(false);
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

  const performMLBSync = async (showToasts = true) => {
    if (showToasts) toast.loading("Fetching MLB Standings...", { id: 'sync-status' });
    
    const syncSeason = "2026";
    
    // 1. Fetch Standings (Wins/Losses)
    const standingsRes = await fetch(`https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${syncSeason}&standingsTypes=regularSeason`);
    const standingsData = await standingsRes.json();
    
    if (!standingsData.records || standingsData.records.length === 0) {
      throw new Error(`No standings records found in MLB API for ${syncSeason}.`);
    }

    if (showToasts) toast.loading("Fetching Team Performance Data...", { id: 'sync-status' });

    const teamStatsMap: Record<string, any> = {};

    // Process Standings for basic info
    standingsData.records.forEach((record: any) => {
      record.teamRecords?.forEach((tr: any) => {
        const tid = tr.team.id.toString();
        teamStatsMap[tid] = {
          wins: tr.wins,
          losses: tr.losses,
          hrs: 0,
          ks: 0,
          stolenBases: 0,
          doublePlays: 0,
          caughtStealing: 0,
          errors: 0,
          defense: 0
        };
      });
    });

    // 2. Fetch Team-Level Stats for each team (Parallel)
    // This is the most accurate way to get official team totals
    await Promise.all(MLB_TEAMS.map(async (team) => {
      try {
        const tid = team.id.toString();
        
        // Fetch Team Hitting Season Stats
        const hitRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${team.id}/stats?stats=season&group=hitting&season=${syncSeason}&gameType=R`);
        const hitData = await hitRes.json();
        const hitStat = hitData.stats?.[0]?.splits?.[0]?.stat;
        
        // Fetch Team Pitching Season Stats
        const pitchRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${team.id}/stats?stats=season&group=pitching&season=${syncSeason}&gameType=R`);
        const pitchData = await pitchRes.json();
        const pitchStat = pitchData.stats?.[0]?.splits?.[0]?.stat;

        // Fetch Team Fielding Season Stats (Double Plays & Errors)
        const fieldRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${team.id}/stats?stats=season&group=fielding&season=${syncSeason}&gameType=R`);
        const fieldData = await fieldRes.json();
        const fieldStat = fieldData.stats?.[0]?.splits?.[0]?.stat;

        // Fetch Team Catching Season Stats (Caught Stealing)
        const catchRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${team.id}/stats?stats=season&group=catching&season=${syncSeason}&gameType=R`);
        const catchData = await catchRes.json();
        const catchStat = catchData.stats?.[0]?.splits?.[0]?.stat;

        if (teamStatsMap[tid]) {
          teamStatsMap[tid].hrs = hitStat?.homeRuns || 0;
          teamStatsMap[tid].stolenBases = hitStat?.stolenBases || 0;
          teamStatsMap[tid].ks = pitchStat?.strikeOuts || 0;
          
          const dps = fieldStat?.doublePlays || 0;
          const errs = fieldStat?.errors || 0;
          const cs = catchStat?.caughtStealing || 0;
          
          teamStatsMap[tid].doublePlays = dps;
          teamStatsMap[tid].caughtStealing = cs;
          teamStatsMap[tid].errors = errs;
          teamStatsMap[tid].defense = dps + cs - errs;
        }
      } catch (err) {
        console.error(`Error fetching detailed stats for team ${team.name}:`, err);
      }
    }));

    if (showToasts) toast.loading("Updating database...", { id: 'sync-status' });
    
    const batch = writeBatch(db);
    let updatedCount = 0;

    for (const team of MLB_TEAMS) {
      const stats = teamStatsMap[team.id];
      if (stats) {
        batch.update(doc(db, 'team_lines', team.id), {
          "stats.wins": stats.wins,
          "stats.losses": stats.losses,
          "stats.hrs": stats.hrs,
          "stats.ks": stats.ks,
          "stats.stolenBases": stats.stolenBases,
          "stats.doublePlays": stats.doublePlays || 0,
          "stats.caughtStealing": stats.caughtStealing || 0,
          "stats.errors": stats.errors || 0,
          "stats.defense": stats.defense || 0,
          last_sync: new Date().toISOString()
        });
        updatedCount++;
      }
    }

    await batch.commit();
    if (showToasts) toast.success(`Sync successful! ${updatedCount} teams updated with official totals.`, { id: 'sync-status' });
    return updatedCount;
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      await performMLBSync(true);
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

  const formatMetricLabel = (key: string) => {
    switch (key?.toLowerCase()) {
      case 'hrs': return 'Home Runs';
      case 'ks': return 'Pitching Ks';
      case 'wins': return 'CP Hits';
      case 'stolenbases': return 'Stolen Bases';
      case 'defense': return 'Defensive Score (DP + CS - E)';
      case 'doubleplays': return 'Double Plays';
      case 'caughtstealing': return 'Caught Stealing';
      case 'errors': return 'Errors';
      default: return key?.toUpperCase() || 'UNKNOWN';
    }
  };

  const seedMayContest = async () => {
    setLoading(true);
    try {
      const maySprint = { 
        id: 'may_2026', 
        name: 'May Strikeout King', 
        description: 'Draft 3 teams. Total strikeouts thrown by your pitching staff in May decides the winner!',
        metric: 'ks', 
        start: '2026-05-01T00:00:00-04:00', 
        end: '2026-06-01T00:00:00-04:00', 
        limit: 3, 
        chips: false, 
        draft: true 
      };
      
      const sprintRef = doc(db, 'contests', maySprint.id);
      await setDoc(sprintRef, {
        theme_name: maySprint.name,
        description: maySprint.description,
        metric_key: maySprint.metric,
        start_time: Timestamp.fromDate(new Date(maySprint.start)),
        end_time: Timestamp.fromDate(new Date(maySprint.end)),
        is_active: true,
        selection_limit: maySprint.limit,
        use_chips: maySprint.chips,
        is_draft: maySprint.draft,
        draft_status: 'pending',
        current_turn_index: 0
      }, { merge: true });
      
      toast.success('May Strikeout King initialized! You can now manage its draft below.');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const seedJuneContest = async () => {
    setLoading(true);
    try {
      const juneSprint = { 
        id: 'june_2026', 
        name: 'June Sprint: Stolen Base Summer', 
        description: 'Draft 3 teams. Total Stolen Bases in June decides the winner!',
        metric: 'stolenBases', 
        start: '2026-06-01T00:00:00-04:00', 
        end: '2026-07-01T00:00:00-04:00', 
        limit: 3, 
        chips: false, 
        draft: true 
      };
      
      const sprintRef = doc(db, 'contests', juneSprint.id);
      await setDoc(sprintRef, {
        theme_name: juneSprint.name,
        description: juneSprint.description,
        metric_key: juneSprint.metric,
        start_time: Timestamp.fromDate(new Date(juneSprint.start)),
        end_time: Timestamp.fromDate(new Date(juneSprint.end)),
        is_active: true,
        selection_limit: juneSprint.limit,
        use_chips: juneSprint.chips,
        is_draft: juneSprint.draft,
        draft_status: 'pending',
        current_turn_index: 0
      }, { merge: true });
      
      toast.success('June Sprint: Stolen Base Summer initialized! You can now manage its draft below.');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const seedJulyContest = async () => {
    setLoading(true);
    try {
      const julySprint = { 
        id: 'july_2026', 
        name: 'July Monthly Contest: Defensive Showdown', 
        description: 'Draft 3 teams. Total Defensive Score (Double Plays + Caught Stealing - Errors) in July decides the winner!',
        metric: 'defense', 
        start: '2026-07-01T00:00:00-04:00', 
        end: '2026-08-01T00:00:00-04:00', 
        limit: 3, 
        chips: false, 
        draft: true 
      };
      
      const sprintRef = doc(db, 'contests', julySprint.id);
      await setDoc(sprintRef, {
        theme_name: julySprint.name,
        description: julySprint.description,
        metric_key: julySprint.metric,
        start_time: Timestamp.fromDate(new Date(julySprint.start)),
        end_time: Timestamp.fromDate(new Date(julySprint.end)),
        is_active: true,
        selection_limit: julySprint.limit,
        use_chips: julySprint.chips,
        is_draft: julySprint.draft,
        draft_status: 'pending',
        current_turn_index: 0
      }, { merge: true });
      
      toast.success('July Monthly Contest: Defensive Showdown initialized! You can now manage its draft below.');
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
      toast.success('Database seeded successfully!');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const seedDemoUsersOnly = async () => {
    setLoading(true);
    const toastId = toast.loading('Seeding legendary MLB demo players...');
    try {
      const batch = writeBatch(db);
      const demoPlayers = [
        { uid: 'demo_babe', display_name: 'Babe Ruth', email: 'babe@ballpark.com', total_cp: 350, role: 'player' as const },
        { uid: 'demo_jackie', display_name: 'Jackie Robinson', email: 'jackie@ballpark.com', total_cp: 280, role: 'player' as const },
        { uid: 'demo_ted', display_name: 'Ted Williams', email: 'ted@ballpark.com', total_cp: 420, role: 'player' as const },
        { uid: 'demo_mickey', display_name: 'Mickey Mantle', email: 'mickey@ballpark.com', total_cp: 190, role: 'player' as const }
      ];

      demoPlayers.forEach(player => {
        const userRef = doc(db, 'users', player.uid);
        batch.set(userRef, {
          display_name: player.display_name,
          email: player.email,
          total_cp: player.total_cp,
          role: player.role
        }, { merge: true });
      });

      await batch.commit();
      toast.success('Roster filled with legendary demo players!', { id: toastId });
    } catch (error: any) {
      toast.error(`Failed to seed demo players: ${error.message}`, { id: toastId });
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
    <div className="p-4 md:p-8 bg-white rounded-2xl border-4 border-stitch shadow-xl">
      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck className="text-blue-600 md:w-[32px] md:h-[32px]" size={28} />
        <h2 className="text-xl md:text-2xl font-varsity text-slate-900 uppercase tracking-tight">Admin Controls</h2>
      </div>

      <p className="text-sm font-varsity text-slate-500 mb-8 uppercase tracking-widest opacity-70">
        Use these tools to initialize the database with MLB teams, O/U lines, and the initial 2026 season contest.
      </p>

      <div className="bg-blue-50 border-2 border-blue-200 p-4 rounded-xl mb-8 flex items-start gap-3">
        <Clock className="text-blue-600 shrink-0 mt-0.5" size={18} />
        <div className="text-[10px] font-varsity text-blue-800 leading-relaxed uppercase tracking-widest">
          <span className="font-bold text-blue-600">Note:</span> MLB stats sync is currently in <span className="font-black">MANUAL MODE</span>. Click the sync button below to update real-time standings from your browser.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        <div className="p-4 md:p-6 bg-slate-50 rounded-2xl border-2 border-slate-200">
          <div className="flex items-center gap-3 mb-4">
            <RefreshCw className={`${syncing ? 'text-blue-600 animate-spin' : 'text-slate-400'} md:w-[24px] md:h-[24px]`} size={20} />
            <div>
              <h3 className="font-varsity text-sm text-slate-900 uppercase tracking-tight">MLB Stats Sync</h3>
              <p className="text-[10px] font-varsity text-slate-400 uppercase tracking-widest">Manual Trigger</p>
            </div>
          </div>
          <p className="text-[10px] font-varsity text-slate-500 leading-relaxed mb-4 uppercase tracking-widest opacity-70">
            Now using optimized bulk fetching. Syncs W/L, HRs, Ks, and SBs for all 30 teams in seconds.
          </p>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={handleManualSync}
              disabled={syncing}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-[10px] font-varsity uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 shadow-md"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync MLB Data'}
            </button>
            <button
              onClick={testMlbApi}
              disabled={syncing}
              className="px-4 py-2 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-900 text-[10px] font-varsity uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 border-2 border-slate-200 shadow-sm"
            >
              <Search size={14} />
              Verify MLB API
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6 bg-blue-600 rounded-2xl border-4 border-white shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <Trophy className="text-white md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-varsity text-sm text-white uppercase tracking-tight">May Sprint Launch</h3>
              <p className="text-[10px] font-varsity text-blue-200 uppercase tracking-widest">One-Click Setup</p>
            </div>
          </div>
          <p className="text-[10px] font-varsity text-blue-100 leading-relaxed mb-6 uppercase tracking-widest">
            Safely initialize the May Strikeout King contest. This will NOT affect teams, win totals, or other contests.
          </p>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={seedMayContest}
              disabled={loading}
              className="w-full px-4 py-3 bg-white hover:bg-blue-50 text-blue-600 text-xs font-varsity uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-3 shadow-lg active:scale-95"
            >
              <Database size={16} />
              {loading ? 'Seeding...' : 'Seed May Contest'}
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6 bg-emerald-600 rounded-2xl border-4 border-white shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <Trophy className="text-white md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-varsity text-sm text-white uppercase tracking-tight">June Sprint Launch</h3>
              <p className="text-[10px] font-varsity text-emerald-100 uppercase tracking-widest">One-Click Setup</p>
            </div>
          </div>
          <p className="text-[10px] font-varsity text-emerald-100 leading-relaxed mb-6 uppercase tracking-widest">
            Safely initialize the June Stolen Base Summer contest. This allows 3 team selections and tracks Stolen Bases as the metric.
          </p>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={seedJuneContest}
              disabled={loading}
              className="w-full px-4 py-3 bg-white hover:bg-emerald-50 text-emerald-600 text-xs font-varsity uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-3 shadow-lg active:scale-95"
            >
              <Database size={16} />
              {loading ? 'Seeding...' : 'Seed June Contest'}
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6 bg-indigo-900 rounded-2xl border-4 border-white shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <Trophy className="text-white md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-varsity text-sm text-white uppercase tracking-tight">July Contest Launch</h3>
              <p className="text-[10px] font-varsity text-indigo-200 uppercase tracking-widest">One-Click Setup</p>
            </div>
          </div>
          <p className="text-[10px] font-varsity text-indigo-100 leading-relaxed mb-6 uppercase tracking-widest">
            Initialize the July Defensive Showdown contest. Tracks total Double Plays + Caught Stealing - Errors as the metric.
          </p>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={seedJulyContest}
              disabled={loading}
              className="w-full px-4 py-3 bg-white hover:bg-indigo-50 text-indigo-950 text-xs font-varsity uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-3 shadow-lg active:scale-95"
            >
              <Database size={16} />
              {loading ? 'Seeding...' : 'Seed July Contest'}
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6 bg-slate-50 rounded-2xl border-2 border-slate-200">
          <div className="flex items-center gap-3 mb-4">
            <Database className="text-blue-600 md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-varsity text-sm text-slate-900 uppercase tracking-tight">Full Initial Seed</h3>
              <p className="text-[10px] font-varsity text-slate-400 uppercase tracking-widest">Global Reset</p>
            </div>
          </div>
          <p className="text-[10px] font-varsity text-slate-500 leading-relaxed mb-6 uppercase tracking-widest opacity-70">
            Initialize ALL teams, O/U lines, and all monthly sprints for 2026. Warning: Resets team stats.
          </p>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={seedData}
              disabled={loading}
              className="w-full px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-900 text-[10px] font-varsity uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-3 border-2 border-slate-200"
            >
              <Database size={16} />
              {loading ? 'Seeding...' : 'Full System Seed'}
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6 bg-slate-50 rounded-2xl border-2 border-slate-200">
          <div className="flex items-center gap-3 mb-4">
            <Users className="text-emerald-600 md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-varsity text-sm text-slate-900 uppercase tracking-tight">Seed Demo Players</h3>
              <p className="text-[10px] font-varsity text-slate-400 uppercase tracking-widest">Roster Management</p>
            </div>
          </div>
          <p className="text-[10px] font-varsity text-slate-500 leading-relaxed mb-6 uppercase tracking-widest opacity-70">
            Seed legendary Hall-of-Fame players (Babe Ruth, Jackie Robinson, Ted Williams, Mickey Mantle) as demo users to run fantasy drafts and fill the leaderboard!
          </p>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={seedDemoUsersOnly}
              disabled={loading}
              className="w-full px-4 py-2 bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-200 text-emerald-700 text-[10px] font-varsity uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-3"
            >
              <Users size={16} />
              {loading ? 'Seeding...' : 'Seed Demo Players'}
            </button>
          </div>
        </div>
        <div className="p-4 md:p-6 bg-slate-50 rounded-2xl border-2 border-slate-200">
          <div className="flex items-center gap-3 mb-4">
            <Trash2 className="text-rose-600 md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-varsity text-sm text-slate-900 uppercase tracking-tight">Clear Test Data</h3>
              <p className="text-[10px] font-varsity text-slate-400 uppercase tracking-widest">Danger Zone</p>
            </div>
          </div>
          <p className="text-[10px] font-varsity text-slate-500 leading-relaxed mb-6 uppercase tracking-widest opacity-70">
            Delete all user picks and entries across all contests. This will also reset draft progress.
          </p>
          
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full px-4 py-2 bg-rose-50 hover:bg-rose-100 border-2 border-rose-200 text-rose-600 text-[10px] font-varsity uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <Trash2 size={16} />
              Delete All Picks
            </button>
          ) : (
            <div className="space-y-2">
              <button
                onClick={deleteAllEntries}
                disabled={loading}
                className="w-full px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-[10px] font-varsity uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 shadow-md"
              >
                {loading ? 'Deleting...' : 'CONFIRM DELETE ALL'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loading}
                className="w-full px-4 py-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-600 text-[10px] font-varsity uppercase tracking-widest rounded-xl transition-all"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8">
        <div className="p-4 md:p-6 bg-slate-50 rounded-2xl border-2 border-slate-200">
          <div className="flex items-center gap-3 mb-6">
            <ListOrdered className="text-emerald-600 md:w-[24px] md:h-[24px]" size={20} />
            <div>
              <h3 className="font-varsity text-sm text-slate-900 uppercase tracking-tight">MLB Win Totals Management</h3>
              <p className="text-[10px] font-varsity text-slate-400 uppercase tracking-widest">Adjust Over/Under Lines</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[500px] overflow-y-auto pr-2 no-scrollbar">
            {teamLines.map(team => (
              <div key={team.id} className="p-3 bg-white rounded-xl border-2 border-slate-100 flex items-center justify-between group shadow-sm">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-varsity text-slate-900 flex items-center gap-2 truncate uppercase tracking-tight">
                    <span className="text-slate-400 w-8 shrink-0">{team.abbreviation}</span>
                    <span className="truncate">{team.team_name}</span>
                  </div>
                  <div className="text-[9px] font-varsity text-slate-400 mt-0.5 uppercase tracking-widest">
                    Current Line: <span className="text-emerald-600">{team.ou_line}</span>
                  </div>
                </div>

                {editingTeamId === team.id ? (
                  <div className="flex items-center gap-1">
                    <input 
                      type="number"
                      step="0.5"
                      value={editLineValue}
                      onChange={(e) => setEditLineValue(e.target.value)}
                      className="w-16 bg-slate-50 border-2 border-slate-200 rounded px-2 py-1 text-xs font-varsity text-blue-600"
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
                      className="p-1.5 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-lg transition-all"
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

      {/* Champ Points Distribution */}
      <div className="bg-slate-950 rounded-2xl p-6 md:p-8 border border-slate-800 shadow-xl mb-12">
        <div className="flex items-center gap-3 mb-8">
          <Trophy className="text-amber-500 w-8 h-8" />
          <div>
            <h2 className="text-xl font-varsity text-white uppercase tracking-tight">Champ Points Distribution</h2>
            <p className="text-[10px] font-varsity text-slate-500 uppercase tracking-widest opacity-70">
              Reward top finishers for completed contests.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="space-y-6">
            <div>
              <label className="text-[10px] font-varsity text-slate-500 uppercase tracking-widest block mb-2">Select Completed Contest</label>
              <select 
                value={selectedContestForPoints}
                onChange={(e) => setSelectedContestForPoints(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:border-amber-500 transition-colors"
              >
                <option value="">-- Choose Contest --</option>
                {contests.filter(c => parseDate(c.end_time) <= new Date()).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.theme_name} {(c as any).points_awarded ? '✅' : '❌'}
                  </option>
                ))}
              </select>
            </div>

            {selectedContestForPoints && (
              <div className="space-y-4">
                <label className="text-[10px] font-varsity text-slate-500 uppercase tracking-widest block mb-2">CP Payout Structure</label>
                {[0, 1, 2, 3, 4].map(idx => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center text-[10px] font-varsity text-slate-400">
                      #{idx + 1}
                    </span>
                    <input 
                      type="number"
                      value={rewardPoints[idx] || 0}
                      onChange={(e) => setRewardPoints({ ...rewardPoints, [idx]: parseInt(e.target.value) || 0 })}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-bold text-blue-400"
                    />
                    <span className="text-[10px] font-varsity text-slate-600 uppercase tracking-widest">CP</span>
                  </div>
                ))}
                
                {!payoutConfirming ? (
                  <button
                    onClick={() => {
                      const contest = contests.find(c => c.id === selectedContestForPoints);
                      if (contest && (contest as any).points_awarded) {
                        toast.error("Warning: Points already awarded for this contest.");
                      }
                      setPayoutConfirming(true);
                    }}
                    disabled={contestEntries.length === 0}
                    className="w-full py-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-varsity uppercase tracking-widest text-xs rounded-xl shadow-[0_4px_0_0_rgb(180,134,8)] active:translate-y-0.5 active:shadow-none transition-all mt-4"
                  >
                    {contestEntries.length === 0 ? 'No Entries Found' : 'Preview Payouts'}
                  </button>
                ) : (
                  <div className="flex flex-col gap-2 mt-4">
                    <button
                      onClick={awardPoints}
                      disabled={distributing}
                      className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-varsity uppercase tracking-widest text-xs rounded-xl shadow-[0_4px_0_0_rgb(5,150,105)] active:translate-y-0.5 active:shadow-none transition-all"
                    >
                      {distributing ? 'Distributing...' : 'Confirm & Payout CP'}
                    </button>
                    <button
                      onClick={() => setPayoutConfirming(false)}
                      disabled={distributing}
                      className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 font-varsity uppercase tracking-widest text-[10px] rounded-lg transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-slate-900/50 rounded-2xl border border-slate-800 overflow-hidden">
            <div className="p-4 border-b border-slate-800 bg-slate-900/80 flex justify-between items-center">
              <span className="text-[10px] font-varsity text-slate-400 uppercase tracking-widest">Final Standings Audit</span>
              <span className="px-2 py-0.5 bg-slate-800 rounded text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                {contestEntries.length} Entries
              </span>
            </div>
            
            <div className="max-h-[400px] overflow-y-auto no-scrollbar">
              {contestEntries.length > 0 ? (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-[8px] uppercase font-varsity tracking-widest text-slate-500 border-b border-slate-800">
                      <th className="py-2 px-4">Rank</th>
                      <th className="py-2 px-4">User</th>
                      <th className="py-2 px-4">Score</th>
                      <th className="py-2 px-4 text-right">Award</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {contestEntries.map((entry) => {
                      const user = users.find(u => u.uid === entry.uid);
                      const cp = rewardPoints[entry.rank] || 0;
                      return (
                        <tr key={entry.uid} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-2 px-4 font-mono text-slate-500 text-xs">#{entry.rank + 1}</td>
                          <td className="py-2 px-4">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-white uppercase tracking-tight">{user?.display_name || 'Unknown'}</span>
                              <span className="text-[8px] text-slate-500 uppercase tracking-widest">{user?.email || 'N/A'}</span>
                            </div>
                          </td>
                          <td className="py-2 px-4 font-mono text-blue-400 text-xs">{entry.score}</td>
                          <td className="py-2 px-4 text-right">
                            {cp > 0 && (
                              <span className="px-2 py-0.5 bg-amber-500/10 text-amber-500 text-[10px] font-black rounded uppercase">
                                +{cp} CP
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-12 text-center">
                  <div className="text-3xl mb-4 opacity-20">🏆</div>
                  <p className="text-xs font-varsity text-slate-600 uppercase tracking-[0.2em]">Select a contest to view results</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8">
        <div className="p-4 md:p-6 bg-slate-950 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <Trophy className="text-emerald-500 md:w-[32px] md:h-[32px]" size={28} />
              <div>
                <h2 className="text-xl font-varsity text-white uppercase tracking-tight">Individual Contest Management</h2>
                <p className="text-[10px] font-varsity text-slate-500 uppercase tracking-widest opacity-70">
                  Manage dates, drafts, and snapshots for each month separately.
                </p>
              </div>
            </div>
            <div className="hidden md:block px-3 py-1 bg-slate-900 rounded-lg border border-slate-800 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Total Users: <span className="text-emerald-500">{users.length}</span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {[...contests].sort((a, b) => parseDate(a.end_time).getTime() - parseDate(b.end_time).getTime()).map(c => (
              <div key={c.id} className="p-5 bg-slate-900 rounded-2xl border border-slate-800 flex flex-col gap-6 shadow-xl hover:border-slate-700 transition-colors">
                {/* Header & Status */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-white truncate">{c.theme_name}</h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                       <span className="text-[9px] px-2 py-0.5 bg-slate-950 text-slate-400 rounded uppercase font-bold border border-slate-800">
                          ID: {c.id}
                       </span>
                       <span className="text-[9px] px-2 py-0.5 bg-emerald-500/10 text-emerald-500 rounded uppercase font-bold border border-emerald-500/20">
                          {formatMetricLabel(c.metric_key)}
                       </span>
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shrink-0 ${
                    c.is_active ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-slate-800 text-slate-500 border border-slate-700'
                  }`}>
                    {c.is_active ? 'Active' : 'Hidden'}
                  </div>
                </div>

                {editingContestId === c.id ? (
                  <div className="space-y-4 bg-slate-950/30 p-4 rounded-xl border border-slate-800/50">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="w-full">
                        <label className="text-[8px] uppercase text-slate-500 block mb-1">Contest Title</label>
                        <input 
                          type="text" 
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[10px] font-bold text-white"
                        />
                      </div>
                      <div className="w-full">
                        <label className="text-[8px] uppercase text-slate-500 block mb-1">Metric Key</label>
                        <select 
                          value={editMetric}
                          onChange={(e) => setEditMetric(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[10px] font-bold text-white"
                        >
                          <option value="wins">Wins (O/U)</option>
                          <option value="hrs">Home Runs</option>
                          <option value="ks">Strikeouts</option>
                          <option value="stolenBases">Stolen Bases</option>
                          <option value="defense">Defensive Score (DP + CS - E)</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="w-full">
                        <label className="text-[8px] uppercase text-slate-500 block mb-1">Start Time (ISO)</label>
                        <input 
                          type="text" 
                          value={editStartTime}
                          onChange={(e) => setEditStartTime(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[10px] font-mono text-emerald-500"
                        />
                      </div>
                      <div className="w-full">
                        <label className="text-[8px] uppercase text-slate-500 block mb-1">End Time (ISO)</label>
                        <input 
                          type="text" 
                          value={editEndTime}
                          onChange={(e) => setEditEndTime(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[10px] font-mono text-rose-500"
                        />
                      </div>
                    </div>
                    <div className="w-full">
                      <label className="text-[8px] uppercase text-slate-500 block mb-1">Description</label>
                      <textarea 
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-2 text-[10px] leading-relaxed h-20 resize-none text-slate-300"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                       <button
                        onClick={() => setEditingContestId(null)}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold rounded-lg transition-all text-slate-400"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => updateContest(c.id)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-[10px] font-bold rounded-lg transition-all text-white shadow-lg"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Time Window */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/50 p-4 rounded-xl border border-slate-800/50">
                       <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                             <Clock size={16} />
                          </div>
                          <div>
                            <p className="text-[7px] uppercase text-slate-500 tracking-widest font-bold">Starts</p>
                            <p className="text-[10px] font-mono text-slate-300">
                               {parseDate(c.start_time).toLocaleString()}
                            </p>
                          </div>
                       </div>
                       <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-500">
                             <Clock size={16} />
                          </div>
                          <div>
                            <p className="text-[7px] uppercase text-slate-500 tracking-widest font-bold">Ends</p>
                            <p className="text-[10px] font-mono text-slate-300">
                               {parseDate(c.end_time).toLocaleString()}
                            </p>
                          </div>
                       </div>
                    </div>

                    {/* Operational Controls */}
                    <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-slate-800">
                        <button
                          onClick={() => {
                            setEditingContestId(c.id);
                            setEditStartTime(parseDate(c.start_time).toISOString());
                            setEditEndTime(parseDate(c.end_time).toISOString());
                            setEditDescription(c.description || '');
                            setEditTitle(c.theme_name);
                            setEditMetric(c.metric_key);
                          }}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold rounded-lg transition-all flex items-center gap-2 border border-slate-700"
                        >
                          <Clock size={14} />
                          Edit Schedule
                        </button>

                        {c.metric_key !== 'wins' && (
                          <button
                            onClick={() => snapshotStartingStats(c.id)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-2 border ${
                              c.starting_stats 
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' 
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <RefreshCw size={14} className={c.starting_stats ? '' : 'animate-pulse text-amber-500'} />
                            {c.starting_stats ? 'Stat Snapshot Verified' : 'Take Start Snapshot'}
                          </button>
                        )}
                        {c.starting_stats && (
                          <span className="text-[10px] text-emerald-500 font-mono italic">
                            (Stats Sync Active)
                          </span>
                        )}

                        {c.metric_key !== 'wins' && parseDate(c.end_time) <= new Date() && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => snapshotEndingStats(c.id)}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-2 border ${
                                c.ending_stats 
                                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' 
                                  : 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20'
                              }`}
                            >
                              <Lock size={14} className={c.ending_stats ? '' : 'animate-bounce'} />
                              {c.ending_stats ? 'Results Sealed' : 'Seal Final Results'}
                            </button>

                            <button
                              onClick={() => repairAprilStats(c.id)}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-400 rounded-lg transition-all flex items-center gap-2 border border-slate-700"
                              title="Manual Correction"
                            >
                              <Wrench size={14} />
                              Manual Edit Stats
                            </button>
                          </div>
                        )}
                    </div>

                    {/* Manual Stats Editor */}
                    {editingEndingStatsId === c.id && (
                      <div className="bg-slate-950 p-6 rounded-2xl border-2 border-blue-500/30 shadow-2xl mb-4 animate-in fade-in slide-in-from-top-4">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h4 className="font-varsity text-sm text-white uppercase tracking-tight">Manual Ending Stats Editor</h4>
                            <p className="text-[10px] font-varsity text-slate-500 uppercase tracking-widest">Enter the final RAW totals for each team</p>
                          </div>
                          <div className="flex gap-2">
                             <button
                                onClick={() => setEditingEndingStatsId(null)}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold rounded-lg text-slate-400"
                             >
                                Cancel
                             </button>
                             <button
                                onClick={() => saveEndingStats(c.id)}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-[10px] font-bold rounded-lg text-white shadow-lg"
                             >
                                Save & Seal
                             </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 max-h-[300px] overflow-y-auto pr-2 no-scrollbar">
                          {MLB_TEAMS.map(team => (
                            <div key={team.id} className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-bold text-slate-400">{team.abbr}</span>
                                <span className="text-[8px] text-slate-600 uppercase font-bold">Start: {c.starting_stats?.[team.id] || 0}</span>
                              </div>
                              <input 
                                type="number"
                                value={tempEndingStats[team.id] || 0}
                                onChange={(e) => setTempEndingStats({
                                  ...tempEndingStats,
                                  [team.id]: parseInt(e.target.value) || 0
                                })}
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-bold text-blue-400 focus:border-blue-500 outline-none"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Draft Specific Card */}
                    {c.is_draft && (
                       <div className="p-4 bg-slate-950 rounded-xl border-2 border-amber-500/10">
                          <div className="flex items-center justify-between mb-4">
                             <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${c.draft_status === 'completed' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`}></span>
                                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-tighter">Draft Stage: <span className="text-white">{c.draft_status || 'Pending'}</span></p>
                             </div>
                             {c.draft_order && (
                                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest italic">
                                   {c.draft_order.length} Players Enrolled
                                </div>
                             )}
                          </div>

                          <div className="grid grid-cols-2 gap-2 mt-4">
                            <button
                              onClick={() => generateDraftOrder(c.id)}
                              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 border border-slate-700 shadow-sm"
                            >
                              <ListOrdered size={14} className="text-amber-500" />
                              Reset Order
                            </button>
                            <button
                              onClick={() => startDraft(c.id)}
                              disabled={!c.draft_order || c.draft_status === 'in_progress' || c.draft_status === 'completed'}
                              className="px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-20 text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 shadow-inner active:scale-95"
                            >
                              <Play size={14} fill="currentColor" />
                              KICK OFF DRAFT
                            </button>

                            <button
                              onClick={() => autoCompleteDraft(c.id)}
                              disabled={c.draft_status === 'completed'}
                              className="px-3 py-2 col-span-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-20 text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 shadow-inner active:scale-95"
                            >
                              <Sparkles size={14} fill="currentColor" className="text-amber-300" />
                              AUTO-COMPLETE DRAFT (SIMULATE)
                            </button>
                          </div>
                       </div>
                    )}
                  </div>
                )}
              </div>
            ))}
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

      {/* Team Data Verification Table */}
      <div className="bg-white rounded-2xl p-6 md:p-8 border-4 border-slate-900 shadow-xl mt-12 mb-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <RefreshCw className="text-blue-600 h-8 w-8" />
            <div>
              <h2 className="text-xl font-varsity text-slate-900 uppercase tracking-tight">Team Data Verification</h2>
              <p className="text-[10px] font-varsity text-slate-500 uppercase tracking-widest opacity-70">
                Raw season totals currently stored in the database.
              </p>
            </div>
          </div>
          <div className="hidden md:block px-3 py-1 bg-slate-100 rounded-lg border border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Last Sync: {teamLines[0]?.last_sync ? new Date(teamLines[0].last_sync).toLocaleTimeString() : 'N/A'}
          </div>
        </div>
        
        <div className="overflow-x-auto -mx-6 md:mx-0">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b-2 border-slate-200 text-[10px] uppercase font-varsity tracking-widest text-slate-400">
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4 text-center">Wins</th>
                <th className="py-3 px-4 text-center">Losses</th>
                <th className="py-3 px-4 text-center text-rose-600">HRs</th>
                <th className="py-3 px-4 text-center text-amber-600">Ks</th>
                <th className="py-3 px-4 text-center text-emerald-600">SBs</th>
                <th className="py-3 px-4 text-center text-blue-600">DP</th>
                <th className="py-3 px-4 text-center text-indigo-600">CS</th>
                <th className="py-3 px-4 text-center text-rose-500">ERR</th>
                <th className="py-3 px-4 text-center text-teal-600 font-bold">DEF</th>
                <th className="py-3 px-4 text-right">O/U Line</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teamLines.map((team) => (
                <tr key={team.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="py-3 px-4">
                    <div className="flex flex-col">
                      <span className="font-varsity text-slate-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight">{team.team_name}</span>
                      <span className="text-[10px] text-slate-400 font-varsity uppercase tracking-widest">{team.abbreviation}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center font-scorebook text-slate-600">{team.stats?.wins || 0}</td>
                  <td className="py-3 px-4 text-center font-scorebook text-slate-400">{team.stats?.losses || 0}</td>
                  <td className="py-3 px-4 text-center font-scorebook text-rose-600 font-bold">{team.stats?.hrs || 0}</td>
                  <td className="py-3 px-4 text-center font-scorebook text-amber-600">{team.stats?.ks || 0}</td>
                  <td className="py-3 px-4 text-center font-scorebook text-emerald-600">{team.stats?.stolenBases || 0}</td>
                  <td className="py-3 px-4 text-center font-scorebook text-blue-600">{(team.stats as any)?.doublePlays || 0}</td>
                  <td className="py-3 px-4 text-center font-scorebook text-indigo-600">{(team.stats as any)?.caughtStealing || 0}</td>
                  <td className="py-3 px-4 text-center font-scorebook text-rose-500">{(team.stats as any)?.errors || 0}</td>
                  <td className="py-3 px-4 text-center font-scorebook text-teal-600 font-bold">{(team.stats as any)?.defense || 0}</td>
                  <td className="py-3 px-4 text-right font-varsity text-slate-400 text-xs">{team.ou_line}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
