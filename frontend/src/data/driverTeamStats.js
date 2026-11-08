/*
 * MANUAL TEAM-SPECIFIC DRIVER STATISTICS
 * --------------------------------------
 * Add verified values for each driver/team combination.
 *
 * driverTitles = Driver World Championships won while driving for that team.
 * gpWins       = Grand Prix victories achieved with that team.
 * years        = Number of seasons/years represented for that team.
 *
 * Use null until you have verified a value. The UI displays — for null.
 * Do not copy a driver's overall career totals into a team entry unless
 * all those achievements were earned with that team.
 */
const driverTeamStats = {
  "Max Verstappen": {
    "Red Bull Racing": {
      driverTitles: null,
      gpWins: null,
      years: null,
    },
  },

  "Lewis Hamilton": {
    "Ferrari": { driverTitles: null, gpWins: null, years: null },
    "Mercedes": { driverTitles: null, gpWins: null, years: null },
  },

  "Kimi Antonelli": {
    "Mercedes": { driverTitles: null, gpWins: null, years: null },
    "Ferrari": { driverTitles: null, gpWins: null, years: null },
  },
};

export default driverTeamStats;
