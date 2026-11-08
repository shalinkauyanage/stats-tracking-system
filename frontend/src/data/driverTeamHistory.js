
/*
 * MANUAL DRIVER TEAM HISTORY AND TEAM STATISTICS
 *
 * teams: Teams represented, displayed from left to right.
 * driverTitles: World titles won with that team.
 * gpWins: Grand Prix wins with that team.
 * years: Seasons represented with that team.
 *
 * Use null for statistics that have not yet been verified.
 */

const driverTeamHistory = {
  "Max Verstappen": {
    teams: ["Red Bull Racing"],
    stats: {
      "Red Bull Racing": {driverTitles: 3,gpWins: 47,years: 5,},
    },
  },

  "Lewis Hamilton": {
    teams: ["Ferrari", "Mercedes"],
    stats: {
      "Ferrari": { driverTitles: 1, gpWins: 14, years: 4 },
      Mercedes: { driverTitles: 0, gpWins: 5, years: 1 },
    },
  },

  "Lando Norris": {
    teams: ["McLaren"],
    stats: {
      McLaren: { driverTitles: 0, gpWins: 10, years: 5 },
  },
  },

  "George Russell": {
    teams: ["Mercedes"],
    stats: {
      Mercedes: { driverTitles: 0, gpWins: 8, years: 5 },
  },
  },

  "Oscar Piastri": {
    teams: ["McLaren", "Red Bull Racing"],
    stats: {
      "McLaren": { driverTitles: 0, gpWins: 5, years: 4 },
      "Red Bull Racing": {driverTitles: 0,gpWins: 3,years: 1},
  },
  },

  "Charles Leclerc": {
    teams: ["Ferrari"],
    stats: {
      "Ferrari": { driverTitles: 0, gpWins: 4, years: 5 },
    },
  },

  "Kimi Antonelli": {
    teams: ["Mercedes", "Ferrari"],
    stats: {
      "Mercedes": { driverTitles: 1, gpWins: 13, years: 4 },
      "Ferrari": { driverTitles: 0, gpWins: 0, years: 1 },
    },
  },

  "Fernando Alonso": {
    teams: ["Aston Martin", "McLaren"],
    stats: {
      "Aston Martin": { driverTitles: 0, gpWins: 3, years: 4 },
      "McLaren": { driverTitles: 0, gpWins: 1, years: 1 },
    },
  },

  "Oliver Bearman": {
    teams: ["Haas", "Aston Martin"],
    stats: {
      "Haas": { driverTitles: 0, gpWins: 0, years: 1 },
      "Aston Martin": { driverTitles: 0, gpWins: 1, years: 4 },
    },
  },

  "Arvid Lindblad": {
    teams: ["Racing Bulls", "Red Bull Racing","Audi"],
    stats: {
      "Racing Bulls": { driverTitles: 0, gpWins: 0, years: 1 },
      "Red Bull Racing": { driverTitles: 0, gpWins: 2, years: 3 },
      "Audi": { driverTitles: 0, gpWins: 0, years: 1 },
    },
  },

  "Carlos Sainz": {
    teams: ["Williams", "Aston Martin"],
    stats: {
      "Williams": { driverTitles: 0, gpWins: 0, years: 4 },
      "Aston Martin": { driverTitles: 0, gpWins: 1, years: 1 },
    },
  },

  "Nico Hulkenberg": {
    teams: ["Audi", "Williams"],
    stats: {
      "Audi": { driverTitles: 0, gpWins: 0, years: 4 },
      "Williams": { driverTitles: 0, gpWins: 2, years: 1 },
    },
  },

  "Alex Albon": {
    teams: ["Williams", "Haas"],
     stats: {
      "Williams": { driverTitles: 0, gpWins: 0, years: 5 },
      "Aston Martin": { driverTitles: 0, gpWins: 0, years: 0 },
    },
  },

  "Sergio Perez": {
    teams: ["Cadillac", "Williams"],
    stats: {
      "Cadillac": { driverTitles: 0, gpWins: 0, years: 5 },
      "Williams": { driverTitles: 0, gpWins: 0, years: 0 },
    },
  },

  "Valtteri Bottas": {
    teams: ["Cadillac"],
    stats: {
      "Cadillac": { driverTitles: 0, gpWins: 0, years: 5 }
    },
  },

  "Isack Hadjar": {
    teams: ["Red Bull Racing", "Racing Bulls"],
    stats: {
      "Red Bull Racing": { driverTitles: 0, gpWins: 0, years: 1 },
      "Racing Bulls": { driverTitles: 0, gpWins: 1, years: 4 },
    },
  },

  "Pierre Gasly": {
    teams: ["Alpine", "Audi"],
    stats: {
      "Alpine": { driverTitles: 0, gpWins: 0, years: 4 },
      "Audi": { driverTitles: 0, gpWins: 0, years: 1 },
    },
  },

  "Liam Lawson": {
    teams: ["Racing Bulls"],
    stats: {
      "Racing Bulls": { driverTitles: 0, gpWins: 0, years: 5 },
    },
  },

  "Esteban Ocon": {
    teams: ["Haas", "Cadillac"],
    stats: {
      "Haas": { driverTitles: 0, gpWins: 0, years: 5 },
      "Cadillac": { driverTitles: 0, gpWins: 0, years: 0 },
    },
  },

  "Gabriel Bortoleto": {
    teams: ["Audi", "Alpine"],
    stats: {
      "Audi": { driverTitles: 0, gpWins: 0, years: 4 },
      "Alpine": { driverTitles: 0, gpWins: 0, years: 1 },
    },
  },

  "Lance Stroll": {
    teams: ["Aston Martin", "Haas", "Alpine"],
    stats: {
      "Aston Martin": { driverTitles: 0, gpWins: 0, years: 2 },
       "Haas": { driverTitles: 0, gpWins: 0, years: 2 },
      "Alpine": { driverTitles: 0, gpWins: 0, years: 1 },
    },
  },

  "Franco Colapinto": {
    teams: ["Alpine", "Haas"],
    stats: {
      "Alpine": { driverTitles: 0, gpWins: 0, years: 4 },
      "Haas": { driverTitles: 0, gpWins: 0, years: 1 },
    },
  },
};

export default driverTeamHistory;
