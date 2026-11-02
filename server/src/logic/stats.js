// The single list of which numbers exist. Every other file imports from here,
// so adding a new statistic later means changing ONE place.

export const DRIVER_SEASON_STAT_FIELDS = [
  'wins', 'second_places', 'third_places', 'podiums', 'poles', 'p1_fl_gp',
  'fastest_laps', 'dnfs',
  'sprint_wins', 'sprint_podiums', 'sprint_poles', 'sprint_fastest_laps',
];

export const TEAM_SEASON_STAT_FIELDS = [
  'wins', 'podiums', 'poles', 'fastest_laps',
  'sprint_wins', 'sprint_podiums', 'sprint_poles',
];

// Numbers read from the Driver Stats sheet. 'mps' is kept as a legacy-only field:
// its meaning is unknown, so it is never added to anything and never guessed.
export const LEGACY_DRIVER_FIELDS = [
  'wins', 'second_places', 'third_places', 'podiums', 'poles', 'p1_fl_gp',
  'fastest_laps', 'dnfs', 'mps', 'points', 'drivers_titles', 'constructors_titles',
];

export const LEGACY_TEAM_FIELDS = [
  'wins', 'podiums', 'poles', 'mps', 'points', 'drivers_titles', 'constructors_titles',
];

export const LEGACY_ONLY_FIELDS = ['mps'];
