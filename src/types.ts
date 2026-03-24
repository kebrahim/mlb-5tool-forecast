export interface UserProfile {
  uid: string;
  display_name: string;
  email: string;
  total_cp: number;
  role: 'player' | 'admin';
}

export interface TeamStats {
  wins: number;
  losses: number;
  hrs: number;
  ks: number;
}

export interface TeamLine {
  id: string;
  team_name: string;
  abbreviation: string;
  ou_line: number;
  stats: TeamStats;
  last_sync: string;
}

export interface Contest {
  id: string;
  theme_name: string;
  description?: string;
  metric_key: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
  selection_limit: number;
  use_chips: boolean;
  is_draft: boolean;
  draft_order?: string[];
  current_turn_index?: number;
  draft_status?: 'pending' | 'in_progress' | 'completed';
}

export interface Selection {
  team_id: string;
  chips: number;
  side: 'over' | 'under';
  pick_number?: number;
}

export interface Entry {
  uid: string;
  selections: Selection[];
  score: number;
  is_valid: boolean;
  last_updated: string;
}
