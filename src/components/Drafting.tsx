import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from '../firebase';
import { doc, setDoc, getDoc, collection, getDocs, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
import { toast } from 'react-hot-toast';
import { TeamLine, Selection, Contest, UserProfile } from '../types';
import { Save, AlertCircle, CheckCircle2, Clock, User as UserIcon, ArrowRight, ListOrdered, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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

interface DraftingProps {
  contest: Contest;
  contests: Contest[];
  onContestChange: (contest: Contest) => void;
}

function SnakeDraftRoom({ 
  contest, 
  teams, 
  users, 
  selections, 
  takenTeams, 
  isLocked, 
  isMyTurn, 
  activePlayerUid,
  allSelections,
  onDraft 
}: { 
  contest: Contest, 
  teams: TeamLine[], 
  users: UserProfile[], 
  selections: Selection[], 
  takenTeams: Set<string>, 
  isLocked: boolean, 
  isMyTurn: boolean, 
  activePlayerUid: string | null,
  allSelections: {teamId: string, userId: string, pickNumber: number}[],
  onDraft: (teamId: string) => void 
}) {
  const numPlayers = contest.draft_order?.length || 0;
  const currentTurnIndex = contest.current_turn_index || 0;
  const round = Math.floor(currentTurnIndex / (numPlayers || 1));
  const [isBoardExpanded, setIsBoardExpanded] = useState(true);

  const formatMetric = (key: string) => {
    if (key.toLowerCase() === 'hrs') return 'Home Runs';
    if (key.toLowerCase() === 'wins') return 'CP';
    return key.toUpperCase();
  };

  return (
    <div className="space-y-8">
      {/* Draft Board - Organized by Contestant */}
      {contest.draft_order && contest.draft_order.length > 0 && (
        <div className="bg-white rounded-3xl border-4 border-stitch p-6 overflow-hidden shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div className="text-[10px] font-varsity text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
              <ListOrdered size={14} />
              Draft Board • {allSelections.length} Total Picks {contest.draft_status === 'completed' && '• COMPLETED'}
            </div>
            <button 
              onClick={() => setIsBoardExpanded(!isBoardExpanded)}
              className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500"
            >
              {isBoardExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
          
          <AnimatePresence initial={false}>
            {isBoardExpanded && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-x-auto no-scrollbar"
              >
                <div className="flex gap-6 min-w-max pb-4">
                  {contest.draft_order.map((uid, playerIdx) => {
                    const user = users.find(u => u.uid === uid);
                    const userPicks = allSelections.filter(s => s.userId === uid);
                    
                    return (
                      <div key={uid} className="flex-1 min-w-[180px] space-y-4">
                        {/* Player Header */}
                        <div className="flex items-center gap-3 pb-4 border-b-2 border-slate-100">
                          <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-[10px] font-varsity text-white border-2 border-slate-700">
                            {playerIdx + 1}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs font-varsity text-slate-900 truncate max-w-[140px] uppercase tracking-tight">
                              {user?.display_name || 'Unknown'}
                            </span>
                            <span className="text-[8px] font-varsity text-slate-400 uppercase tracking-widest">
                              Contestant
                            </span>
                          </div>
                        </div>

                        {/* Player's Picks */}
                        <div className="space-y-2">
                          {userPicks.length > 0 ? (
                            userPicks.map((sel) => {
                              const team = teams.find(t => t.id === sel.teamId);
                              return (
                                <motion.div 
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  key={sel.teamId}
                                  className="flex items-center gap-3 bg-slate-50 border-2 border-slate-100 p-2 rounded-xl"
                                >
                                  <div className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center text-[9px] font-varsity border border-blue-700 shrink-0">
                                    #{sel.pickNumber + 1}
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-[10px] font-varsity text-slate-900 truncate leading-tight uppercase tracking-tight">
                                      {team?.team_name}
                                    </span>
                                    <span className="text-[8px] font-varsity text-slate-400 uppercase tracking-widest">
                                      {team?.abbreviation}
                                    </span>
                                  </div>
                                </motion.div>
                              );
                            })
                          ) : (
                            <div className="h-12 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center">
                              <span className="text-[9px] font-varsity text-slate-300 uppercase tracking-widest">No Picks</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Draft Status Bar - Sticky */}
      <div className="sticky top-[80px] z-30 -mx-4 px-4 py-2 md:py-4 bg-white/95 backdrop-blur-md border-b-2 border-slate-200 shadow-xl">
        <div className={`p-4 md:p-6 rounded-2xl md:rounded-3xl border-4 transition-all flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6 ${
          contest.draft_status === 'completed' ? 'bg-emerald-50 border-emerald-500/50' : 'bg-slate-900 border-slate-800'
        }`}>
          <div className="flex items-center gap-4 md:gap-6 w-full md:w-auto">
            <div className={`w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl flex items-center justify-center shrink-0 ${
              contest.draft_status === 'completed' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-slate-900'
            }`}>
              {contest.draft_status === 'completed' ? <CheckCircle2 size={24} className="md:w-8 md:h-8" /> : <Clock size={24} className={`md:w-8 md:h-8 ${contest.draft_status === 'in_progress' ? 'animate-pulse' : ''}`} />}
            </div>
            <div>
              <div className={`text-[8px] md:text-[10px] font-varsity uppercase tracking-[0.2em] mb-0.5 md:mb-1 ${
                contest.draft_status === 'completed' ? 'text-emerald-600' : 'text-amber-500'
              }`}>
                {contest.draft_status === 'completed' ? 'DRAFT FINALIZED' : `Round ${round + 1} • ${contest.draft_status?.replace('_', ' ').toUpperCase()}`}
              </div>
              <div className="flex items-center gap-2 md:gap-3">
                <h3 className="text-lg md:text-2xl font-varsity text-white leading-tight uppercase tracking-tighter">
                  {contest.draft_status === 'completed' ? 'DRAFT COMPLETED' : 
                   isMyTurn ? 'YOUR TURN TO PICK' : 
                   `${users.find(u => u.uid === activePlayerUid)?.display_name?.split(' ')[0] || 'Waiting'}'s Turn`}
                </h3>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto w-full md:max-w-full pb-1 no-scrollbar">
            {contest.draft_order?.map((uid, i) => {
              const user = users.find(u => u.uid === uid);
              const isCurrent = uid === activePlayerUid;
              return (
                <div 
                  key={uid} 
                  className={`flex flex-col items-center gap-1 md:gap-2 px-3 md:px-4 py-1.5 md:py-2 rounded-xl md:rounded-2xl border-2 transition-all shrink-0 ${
                    isCurrent ? 'bg-amber-500 border-amber-400 text-slate-950 scale-105 shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-500'
                  }`}
                >
                  <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-slate-700 flex items-center justify-center text-[10px] md:text-xs font-varsity border border-white/10 shrink-0 text-white">
                    {user?.display_name?.[0]}
                  </div>
                  <span className="text-[8px] md:text-[10px] font-varsity uppercase tracking-widest truncate max-w-[50px] md:max-w-[60px]">
                    {user?.display_name?.split(' ')[0]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Team Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {teams.map(team => {
          const selection = selections.find(s => s.team_id === team.id);
          const isSelected = !!selection;
          const isTaken = takenTeams.has(team.id) && !isSelected;

          return (
            <div 
              key={team.id}
              className={`p-6 rounded-3xl border-4 transition-all ${
                isSelected ? 'bg-emerald-50 border-emerald-500 shadow-lg' : 
                isTaken ? 'bg-slate-50 border-slate-200 opacity-40 grayscale' :
                'bg-white border-slate-200 hover:border-blue-400 group'
              }`}
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-varsity text-xl text-slate-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight">{team.team_name}</h3>
                  <div className="text-[10px] font-varsity text-slate-400 uppercase tracking-[0.2em] mt-1">
                    {team.abbreviation}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {isSelected && <CheckCircle2 className="text-emerald-500" size={24} />}
                  {isTaken && <div className="text-[10px] font-varsity text-rose-600 bg-rose-50 px-2 py-1 rounded-lg border-2 border-rose-200 uppercase tracking-widest">Taken</div>}
                  <div className="bg-slate-50 px-3 py-1.5 rounded-xl border-2 border-slate-200 shadow-inner text-right">
                    <span className="text-[8px] font-varsity text-slate-400 uppercase tracking-widest block leading-none mb-1">
                      {contest.metric_key === 'wins' ? 'O/U Line' : `${formatMetric(contest.metric_key)} Sprint`}
                    </span>
                    <span className="text-lg font-varsity text-blue-600 leading-none">
                      {contest.metric_key === 'wins' ? team.ou_line : (parseDate(contest.start_time) <= new Date() ? Math.max(0, (team.stats[contest.metric_key as keyof typeof team.stats] || 0) - (contest.starting_stats?.[team.id] || 0)) : 0)}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => onDraft(team.id)}
                disabled={isTaken || isSelected || !isMyTurn || isLocked}
                className={`w-full py-4 rounded-2xl text-sm font-varsity uppercase tracking-widest transition-all flex items-center justify-center gap-3 ${
                  isSelected 
                    ? 'bg-emerald-600 text-white cursor-default' 
                    : isTaken 
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : isMyTurn
                        ? 'bg-slate-900 text-white hover:bg-slate-800 shadow-lg active:scale-95'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              >
                {isSelected ? (
                  <><CheckCircle2 size={20} /> DRAFTED</>
                ) : isTaken ? (
                  'UNAVAILABLE'
                ) : isMyTurn ? (
                  <><ArrowRight size={20} /> DRAFT TEAM</>
                ) : contest.draft_status === 'completed' ? (
                  'DRAFT COMPLETED'
                ) : (
                  'WAITING...'
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SelectionRoom({
  contest,
  teams,
  selections,
  isLocked,
  saving,
  canSave,
  hasChanges,
  isValidCount,
  isValidTotal,
  allSelectionsMin5,
  onSideChange,
  onChipChange,
  onSave
}: {
  contest: Contest,
  teams: TeamLine[],
  selections: Selection[],
  isLocked: boolean,
  saving: boolean,
  canSave: boolean,
  hasChanges: boolean,
  isValidCount: boolean,
  isValidTotal: boolean,
  allSelectionsMin5: boolean,
  onSideChange: (teamId: string, side: 'over' | 'under') => void,
  onChipChange: (teamId: string, chips: number) => void,
  onSave: () => void
}) {
  const formatMetric = (key: string) => {
    if (key.toLowerCase() === 'hrs') return 'Home Runs';
    if (key.toLowerCase() === 'wins') return 'CP';
    return key.toUpperCase();
  };

  return (
    <div className="space-y-8">
      {/* Selection Status Bar - Sticky */}
      <div className="sticky top-[80px] z-30 -mx-4 px-4 py-2 md:py-4 bg-white/95 backdrop-blur-md border-b-2 border-slate-200 shadow-xl">
        <div className="bg-slate-900 p-4 md:p-6 rounded-2xl md:rounded-3xl border-4 border-slate-800 shadow-xl flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6">
          <div className="flex items-center gap-4 md:gap-6 w-full md:w-auto">
            <div className="w-12 h-12 md:w-16 md:h-16 bg-emerald-500/10 rounded-xl md:rounded-2xl flex items-center justify-center text-emerald-500 shrink-0">
              <Save size={24} className="md:w-8 md:h-8" />
            </div>
            <div>
              <div className="text-[8px] md:text-[10px] font-varsity text-emerald-500 uppercase tracking-[0.2em] mb-0.5 md:mb-1">
                Pick Status • {isLocked ? 'LOCKED' : 'OPEN'}
              </div>
              <h3 className="text-lg md:text-2xl font-varsity text-white leading-tight uppercase tracking-tighter">
                {isLocked ? 'Selections are Final' : 'Customize Your Picks'}
              </h3>
            </div>
          </div>

          <div className="flex items-center justify-between md:justify-end gap-4 md:gap-8 w-full md:w-auto">
            <div className="flex items-center gap-4 md:gap-8">
              <div className="text-center">
                <div className={`text-xl md:text-3xl font-varsity tabular-nums tracking-tighter ${isValidTotal ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {selections.reduce((sum, s) => sum + s.chips, 0)}/100
                </div>
                <div className="text-[8px] md:text-[10px] uppercase tracking-widest text-slate-500 font-varsity">Chips</div>
              </div>
              <div className="h-8 md:h-10 w-px bg-slate-800" />
              <div className="text-center">
                <div className={`text-xl md:text-3xl font-varsity tabular-nums tracking-tighter ${isValidCount ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {selections.length}/{contest.selection_limit}
                </div>
                <div className="text-[8px] md:text-[10px] uppercase tracking-widest text-slate-500 font-varsity">Teams</div>
              </div>
            </div>
            <button
              onClick={onSave}
              disabled={!canSave || saving}
              className={`px-6 md:px-10 py-3 md:py-4 text-white text-xs md:text-sm font-varsity uppercase tracking-widest rounded-xl md:rounded-2xl transition-all flex items-center gap-2 md:gap-3 shadow-lg active:scale-95 shrink-0 ${
                canSave 
                  ? 'bg-emerald-600 hover:bg-emerald-500' 
                  : 'bg-slate-800 opacity-50 cursor-not-allowed'
              }`}
            >
              {isLocked ? (
                'LOCKED'
              ) : saving ? (
                'SAVING...'
              ) : !hasChanges && isValidCount && isValidTotal && allSelectionsMin5 ? (
                <><CheckCircle2 size={16} className="md:w-5 md:h-5" /> SAVED</>
              ) : (
                <><Save size={16} className="md:w-5 md:h-5" /> SAVE</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Team Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {teams.map(team => {
          const selection = selections.find(s => s.team_id === team.id);
          const isSelected = !!selection;

          return (
            <div 
              key={team.id}
              className={`p-4 md:p-6 rounded-2xl md:rounded-3xl border-4 transition-all ${
                isSelected ? 'bg-white border-emerald-500 shadow-lg' : 
                'bg-white border-slate-200 hover:border-blue-400'
              }`}
            >
              <div className="flex justify-between items-start mb-4 md:mb-6">
                <div className="min-w-0">
                  <h3 className="font-varsity text-lg md:text-xl text-slate-900 truncate uppercase tracking-tight">{team.team_name}</h3>
                  <div className="text-[8px] md:text-[10px] font-varsity text-slate-400 uppercase tracking-[0.2em] mt-0.5 md:mt-1">
                    {team.abbreviation}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 md:gap-2 shrink-0">
                  {isSelected && <CheckCircle2 className="text-emerald-500 w-5 h-5 md:w-6 md:h-6" size={24} />}
                  <div className="bg-slate-50 px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-xl border-2 border-slate-200 shadow-inner text-right">
                    <span className="text-[7px] md:text-[8px] font-varsity text-slate-400 uppercase tracking-widest block leading-none mb-0.5 md:mb-1">
                      {contest.metric_key === 'wins' ? 'O/U Line' : `${formatMetric(contest.metric_key)}`}
                    </span>
                    <span className="text-base md:text-lg font-varsity text-blue-600 leading-none">
                      {contest.metric_key === 'wins' ? team.ou_line : (parseDate(contest.start_time) <= new Date() ? Math.max(0, (team.stats[contest.metric_key as keyof typeof team.stats] || 0) - (contest.starting_stats?.[team.id] || 0)) : 0)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-4 md:space-y-6">
                {contest.metric_key === 'wins' ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSideChange(team.id, 'over')}
                      className={`flex-1 py-2.5 md:py-3 rounded-lg md:rounded-xl text-[10px] md:text-xs font-varsity uppercase tracking-widest transition-all border-2 ${
                        selection?.side === 'over' 
                          ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg' 
                          : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'
                      }`}
                    >
                      OVER
                    </button>
                    <button
                      onClick={() => onSideChange(team.id, 'under')}
                      className={`flex-1 py-2.5 md:py-3 rounded-lg md:rounded-xl text-[10px] md:text-xs font-varsity uppercase tracking-widest transition-all border-2 ${
                        selection?.side === 'under' 
                          ? 'bg-rose-600 border-rose-500 text-white shadow-lg' 
                          : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'
                      }`}
                    >
                      UNDER
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onSideChange(team.id, 'over')}
                    className={`w-full py-2.5 md:py-3 rounded-lg md:rounded-xl text-[10px] md:text-xs font-varsity uppercase tracking-widest transition-all border-2 ${
                      isSelected 
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg' 
                        : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'
                    }`}
                  >
                    {isSelected ? 'SELECTED' : 'SELECT TEAM'}
                  </button>
                )}

                {contest.use_chips && (
                  <div className="flex flex-col gap-2 md:gap-3 p-3 md:p-4 bg-slate-50 rounded-xl md:rounded-2xl border-2 border-slate-200">
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] md:text-[10px] font-varsity text-slate-400 uppercase tracking-widest">Confidence Chips</span>
                      <span className="font-varsity text-blue-600 text-base md:text-lg">{selection?.chips || 0}</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="40"
                      step="1"
                      value={selection?.chips || 20}
                      onChange={(e) => {
                        onChipChange(team.id, parseInt(e.target.value));
                      }}
                      className="w-full h-1.5 md:h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                    <div className="flex justify-between text-[7px] md:text-[8px] text-slate-400 font-varsity uppercase tracking-widest">
                      <span>5 (MIN)</span>
                      <span>40 (MAX)</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContestSelector({ 
  currentContest, 
  contests, 
  onSelect 
}: { 
  currentContest: Contest, 
  contests: Contest[], 
  onSelect: (c: Contest) => void 
}) {
  const [isOpen, setIsOpen] = useState(false);

  const getStatus = (c: Contest) => {
    const now = new Date();
    const start = parseDate(c.start_time);
    const end = parseDate(c.end_time);

    if (c.is_draft) {
      if (c.draft_status === 'completed') {
        if (now > end) return { label: 'Completed', color: 'text-slate-500 bg-slate-500/10' };
        if (now > start) return { label: 'Live', color: 'text-emerald-500 bg-emerald-500/10' };
        return { label: 'Drafted', color: 'text-blue-500 bg-blue-500/10' };
      }
      if (c.draft_status === 'in_progress') return { label: 'Drafting', color: 'text-amber-500 bg-amber-500/10 animate-pulse' };
      return { label: 'Upcoming', color: 'text-slate-400 bg-slate-400/10' };
    } else {
      if (now > end) return { label: 'Completed', color: 'text-slate-500 bg-slate-500/10' };
      if (now > start) return { label: 'Live', color: 'text-emerald-500 bg-emerald-500/10' };
      return { label: 'Open', color: 'text-amber-500 bg-amber-500/10' };
    }
  };

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-4 px-5 py-2.5 bg-white rounded-2xl border-2 border-slate-200 hover:border-blue-400 transition-all group shadow-lg"
      >
        <div className="flex flex-col items-start">
          <span className="text-[9px] font-varsity text-slate-400 uppercase tracking-[0.2em] leading-none mb-1.5">Active Contest</span>
          <span className="text-sm font-varsity text-slate-900 group-hover:text-blue-600 transition-colors leading-none uppercase tracking-tight">{currentContest.theme_name}</span>
        </div>
        <div className="flex items-center gap-3 pl-4 border-l-2 border-slate-100">
          <div className={`px-2 py-1 rounded-lg text-[8px] font-varsity uppercase tracking-widest ${getStatus(currentContest).color.replace('text-', 'text-white bg-').replace('bg-', 'bg-opacity-80 bg-')}`}>
            {getStatus(currentContest).label}
          </div>
          <ChevronDown size={16} className={`text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm" 
              onClick={() => setIsOpen(false)} 
            />
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="absolute top-full left-0 mt-3 w-80 bg-white border-4 border-stitch rounded-[2rem] shadow-2xl z-50 overflow-hidden"
            >
              <div className="p-3 space-y-1 max-h-[400px] overflow-y-auto no-scrollbar">
                <div className="px-4 py-2 text-[10px] font-varsity text-slate-400 uppercase tracking-widest border-b-2 border-slate-100 mb-2">
                  Switch Contest
                </div>
                {contests.sort((a, b) => parseDate(b.start_time).getTime() - parseDate(a.start_time).getTime()).map(c => {
                  const status = getStatus(c);
                  const isActive = c.id === currentContest.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        onSelect(c);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all group ${
                        isActive ? 'bg-slate-50 border-2 border-slate-200' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex flex-col items-start text-left">
                        <span className={`text-xs font-varsity transition-colors uppercase tracking-tight ${isActive ? 'text-blue-600' : 'text-slate-900 group-hover:text-blue-600'}`}>
                          {c.theme_name}
                        </span>
                        <span className="text-[8px] font-varsity text-slate-400 uppercase tracking-widest mt-1">
                          {c.metric_key.toUpperCase()} • {c.selection_limit} TEAMS
                        </span>
                      </div>
                      <div className={`px-2 py-1 rounded-lg text-[8px] font-varsity uppercase tracking-widest shrink-0 ${status.color.replace('text-', 'text-white bg-').replace('bg-', 'bg-opacity-80 bg-')}`}>
                        {status.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Drafting({ contest, contests, onContestChange }: DraftingProps) {
  const [teams, setTeams] = useState<TeamLine[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [savedSelections, setSavedSelections] = useState<Selection[]>([]);
  const [takenTeams, setTakenTeams] = useState<Set<string>>(new Set());
  const [allSelections, setAllSelections] = useState<{teamId: string, userId: string, pickNumber: number}[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string>('');

  const numPlayers = contest.draft_order?.length || 0;
  const currentTurnIndex = contest.current_turn_index || 0;
  const round = Math.floor(currentTurnIndex / (numPlayers || 1));
  const indexInRound = currentTurnIndex % (numPlayers || 1);
  const isSnakeRound = round % 2 === 1;
  const activePlayerUid = contest.draft_order ? (
    isSnakeRound 
      ? contest.draft_order[numPlayers - 1 - indexInRound]
      : contest.draft_order[indexInRound]
  ) : null;

  const isMyTurn = activePlayerUid === auth.currentUser?.uid && contest.draft_status === 'in_progress';
  const isAdmin = users.find(u => u.uid === auth.currentUser?.uid)?.role === 'admin';

  const totalChips = selections.reduce((sum, s) => sum + s.chips, 0);
  const isValidCount = selections.length === contest.selection_limit;
  const isValidTotal = contest.use_chips ? totalChips === 100 : true;
  const allSelectionsMin5 = contest.use_chips ? selections.every(s => s.chips >= 5) : true;

  const hasChanges = useMemo(() => {
    if (selections.length !== savedSelections.length) return true;
    const savedMap = new Map<string, Selection>(savedSelections.map(s => [s.team_id, s]));
    for (const current of selections) {
      const saved = savedMap.get(current.team_id);
      if (!saved) return true;
      if (saved.chips !== current.chips) return true;
      if (saved.side !== current.side) return true;
    }
    return false;
  }, [selections, savedSelections]);

  const canSave = isValidCount && isValidTotal && allSelectionsMin5 && !isLocked && hasChanges;

  useEffect(() => {
    let isMounted = true;
    let unsubEntries = () => {};

    const fetchData = async () => {
      setLoading(true);
      // Reset selections immediately when contest changes
      if (isMounted) {
        setSelections([]);
        setSavedSelections([]);
        setTakenTeams(new Set());
        setAllSelections([]);
      }

      try {
        const teamsSnap = await getDocs(collection(db, 'team_lines'));
        if (isMounted) setTeams(teamsSnap.docs.map(d => ({ id: d.id, ...d.data() } as TeamLine)).sort((a, b) => a.team_name.localeCompare(b.team_name)));
        const usersSnap = await getDocs(collection(db, 'users'));
        if (isMounted) setUsers(usersSnap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
        
        if (auth.currentUser) {
          const entryRef = doc(db, 'contests', contest.id, 'entries', auth.currentUser.uid);
          const entrySnap = await getDoc(entryRef);
          if (isMounted) {
            if (entrySnap.exists()) {
              const loadedSelections = entrySnap.data().selections || [];
              setSelections(loadedSelections);
              setSavedSelections(loadedSelections);
            }
          }
        }

        if (contest.is_draft) {
          unsubEntries = onSnapshot(collection(db, 'contests', contest.id, 'entries'), (snap) => {
            const taken = new Set<string>();
            const allSels: {teamId: string, userId: string, pickNumber: number}[] = [];
            snap.docs.forEach(d => {
              d.data().selections?.forEach((s: Selection) => {
                taken.add(s.team_id);
                allSels.push({ 
                  teamId: s.team_id, 
                  userId: d.id, 
                  pickNumber: s.pick_number || 0 
                });
              });
            });
            // Sort by pick number
            allSels.sort((a, b) => a.pickNumber - b.pickNumber);
            
            if (isMounted) {
              setTakenTeams(taken);
              setAllSelections(allSels);
            }
          }, (error) => {
            if (error.code !== 'permission-denied') {
              console.error("Error listening to entries:", error);
            }
          });
        }
      } catch (error) {
        console.error("Error fetching drafting data:", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    const checkLock = () => {
      const startTime = parseDate(contest.start_time).getTime();
      const endTime = parseDate(contest.end_time).getTime();
      const now = Date.now();
      
      if (now > endTime) {
        setIsLocked(true);
        setTimeLeft('COMPLETED');
        return;
      }

      const diff = startTime - now;
      if (diff <= 30000) {
        setIsLocked(true);
        setTimeLeft('LOCKED');
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        if (hours > 24) setTimeLeft(`${Math.floor(hours / 24)}d ${hours % 24}h`);
        else setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
      }
    };
    fetchData();
    checkLock();
    const interval = setInterval(checkLock, 1000);
    return () => { 
      isMounted = false; 
      clearInterval(interval); 
      unsubEntries();
    };
  }, [contest.id, contest.start_time, contest.end_time]);

  const handleChipChange = (teamId: string, chips: number) => {
    if (isLocked || !contest.use_chips) return;
    setSelections(prev => {
      const existing = prev.find(s => s.team_id === teamId);
      if (existing) {
        if (existing.chips === chips) return prev;
        return prev.map(s => s.team_id === teamId ? { ...s, chips } : s);
      }
      if (prev.length >= contest.selection_limit) {
        toast.error(`Maximum ${contest.selection_limit} teams allowed`);
        return prev;
      }
      return [...prev, { team_id: teamId, chips, side: 'over' }];
    });
  };

  const handleSideChange = async (teamId: string, side: 'over' | 'under') => {
    if (isLocked) return;
    if (contest.is_draft) {
      if (!isMyTurn) { toast.error("It's not your turn to draft!"); return; }
      if (takenTeams.has(teamId)) { toast.error('This team has already been drafted!'); return; }
      if (selections.find(s => s.team_id === teamId)) { toast.error('You already selected this team!'); return; }
      if (selections.length >= contest.selection_limit) { toast.error(`You have already drafted ${contest.selection_limit} teams!`); return; }
      setSaving(true);
      try {
        const newSelections = [...selections, { 
          team_id: teamId, 
          chips: 1, 
          side: 'over',
          pick_number: currentTurnIndex 
        }];
        const entryRef = doc(db, 'contests', contest.id, 'entries', auth.currentUser!.uid);
        const contestRef = doc(db, 'contests', contest.id);
        
        const nextTurnIndex = currentTurnIndex + 1;
        const isDraftComplete = nextTurnIndex >= (numPlayers * contest.selection_limit);
        
        const batch = writeBatch(db);
        batch.set(entryRef, { 
          selections: newSelections, 
          score: 0, 
          is_valid: true, 
          last_updated: new Date().toISOString() 
        });
        batch.set(contestRef, { 
          current_turn_index: nextTurnIndex, 
          draft_status: isDraftComplete ? 'completed' : 'in_progress' 
        }, { merge: true });
        
        await batch.commit();
        
        setSelections(newSelections);
        setSavedSelections(newSelections);
        toast.success(`Drafted ${teams.find(t => t.id === teamId)?.team_name}!`);
      } catch (error: any) { 
        handleFirestoreError(error, OperationType.WRITE, `contests/${contest.id}`);
        toast.error(error.message); 
      } finally { setSaving(false); }
      return;
    }
    setSelections(prev => {
      const existing = prev.find(s => s.team_id === teamId);
      if (existing) {
        if (existing.side === side) return prev.filter(s => s.team_id !== teamId);
        return prev.map(s => s.team_id === teamId ? { ...s, side } : s);
      }
      if (prev.length >= contest.selection_limit) {
        toast.error(`Maximum ${contest.selection_limit} teams allowed`);
        return prev;
      }
      return [...prev, { team_id: teamId, chips: contest.use_chips ? 20 : 1, side }];
    });
  };

  const saveEntry = async () => {
    if (!auth.currentUser || !canSave) return;
    setSaving(true);
    const path = `contests/${contest.id}/entries/${auth.currentUser.uid}`;
    try {
      const entryRef = doc(db, 'contests', contest.id, 'entries', auth.currentUser.uid);
      await setDoc(entryRef, { selections, score: 0, is_valid: true, last_updated: new Date().toISOString() });
      setSavedSelections(selections);
      toast.success('Picks saved successfully!');
    } catch (error: any) { 
      handleFirestoreError(error, OperationType.WRITE, path);
      toast.error(error.message); 
    } finally { setSaving(false); }
  };

  const startDraft = async () => {
    if (!isAdmin) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'contests', contest.id), {
        draft_status: 'in_progress',
        current_turn_index: 0
      }, { merge: true });
      toast.success('Draft started!');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const generateOrder = async () => {
    if (!isAdmin) return;
    setSaving(true);
    try {
      const shuffledUids = users.map(u => u.uid).sort(() => Math.random() - 0.5);
      await setDoc(doc(db, 'contests', contest.id), {
        draft_order: shuffledUids,
        current_turn_index: 0,
        draft_status: 'pending'
      }, { merge: true });
      toast.success('Draft order generated!');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-20 space-y-6">
      <div className="w-16 h-16 border-4 border-slate-200 border-t-stitch rounded-full animate-spin" />
      <div className="text-xl font-varsity text-slate-400 uppercase tracking-widest animate-pulse">
        Entering the Dugout...
      </div>
    </div>
  );

  return (
    <div className="relative h-full overflow-y-auto bg-field">
      {/* Header - Sticky */}
      <div className="sticky top-0 inset-x-0 w-full z-40 bg-white/95 backdrop-blur-md border-b-4 border-stitch shadow-2xl px-4 md:px-8 h-[80px] flex items-center">
        <div className="flex justify-between items-center w-full max-w-7xl mx-auto">
          <div className="flex items-center gap-6">
            <h2 className="hidden md:block text-xl font-varsity text-blue-600 tracking-tighter uppercase">
              {contest.is_draft ? 'SPRINT DRAFT' : 'SELECTION ROOM'}
            </h2>
            <ContestSelector 
              currentContest={contest}
              contests={contests}
              onSelect={onContestChange}
            />
          </div>
          <div className="flex items-center gap-4">
            {!isLocked && timeLeft && (
              <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 text-[10px] font-varsity rounded-2xl border-2 border-emerald-200 shadow-lg uppercase tracking-widest">
                <Clock size={14} />
                {timeLeft}
              </div>
            )}
            {isLocked && (
              <div className={`px-4 py-2 text-[10px] font-varsity rounded-2xl border-2 shadow-lg uppercase tracking-widest ${
                timeLeft === 'COMPLETED' 
                  ? 'bg-slate-50 text-slate-500 border-slate-200' 
                  : 'bg-rose-50 text-rose-600 border-rose-200'
              }`}>
                {timeLeft}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-8 pb-8 max-w-7xl mx-auto mt-8">
        {timeLeft === 'COMPLETED' && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 bg-white border-4 border-stitch p-8 rounded-[2.5rem] text-center shadow-2xl relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-slate-500/5" />
            <div className="relative z-10">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mx-auto mb-4 border-2 border-slate-200">
                <Clock size={32} />
              </div>
              <h3 className="text-2xl font-varsity text-slate-900 mb-2 uppercase tracking-tight">This Contest is Over</h3>
              <p className="text-slate-500 text-sm font-varsity max-w-md mx-auto uppercase tracking-widest opacity-70">
                The contest has concluded. You can still view the final draft board and selections, but no further changes can be made.
              </p>
            </div>
          </motion.div>
        )}

        {contest.is_draft && contest.draft_status === 'pending' && isAdmin && timeLeft !== 'COMPLETED' && (
          <div className="mb-8 bg-white border-4 border-stitch p-8 rounded-3xl text-center shadow-xl">
            <h3 className="text-xl font-varsity text-amber-600 mb-2 uppercase tracking-tight">Draft Not Started</h3>
            <p className="text-slate-500 mb-6 text-sm font-varsity max-w-md mx-auto uppercase tracking-widest opacity-70">
              As an admin, you need to generate the draft order and start the draft before players can make their picks.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={generateOrder}
                disabled={saving}
                className="px-8 py-3 bg-slate-100 hover:bg-slate-200 text-slate-900 font-varsity text-xs uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 border-2 border-slate-200"
              >
                <ListOrdered size={18} />
                {contest.draft_order ? 'REGENERATE ORDER' : 'GENERATE ORDER'}
              </button>
              <button
                onClick={startDraft}
                disabled={saving || !contest.draft_order}
                className="px-8 py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-varsity text-xs uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 shadow-lg"
              >
                <Play size={18} />
                START DRAFT
              </button>
            </div>
          </div>
        )}

        {contest.is_draft ? (
          <SnakeDraftRoom 
            contest={contest}
            teams={teams}
            users={users}
            selections={selections}
            takenTeams={takenTeams}
            isLocked={isLocked}
            isMyTurn={isMyTurn}
            activePlayerUid={activePlayerUid}
            allSelections={allSelections}
            onDraft={(teamId) => handleSideChange(teamId, 'over')}
          />
        ) : (
          <SelectionRoom 
            contest={contest}
            teams={teams}
            selections={selections}
            isLocked={isLocked}
            saving={saving}
            canSave={canSave}
            hasChanges={hasChanges}
            isValidCount={isValidCount}
            isValidTotal={isValidTotal}
            allSelectionsMin5={allSelectionsMin5}
            onSideChange={handleSideChange}
            onChipChange={handleChipChange}
            onSave={saveEntry}
          />
        )}
      </div>
    </div>
  );
}