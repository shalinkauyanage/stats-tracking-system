import React, { useMemo, useState } from "react";
import driverTeamHistory from "./data/driverTeamHistory";
import "./DriverTeamTimeline.css";

const slugFor = (name) => {
  const value = String(name || "").toLowerCase().replace(/&/g, "and").trim();
  const aliases = {
    "red bull": "red-bull-racing",
    "red bull racing": "red-bull-racing",
    rb: "racing-bulls",
    "visa cash app racing bulls": "racing-bulls",
    "racing bulls": "racing-bulls",
    "aston martin aramco": "aston-martin",
    "aston martin": "aston-martin",
    "mercedes-amg petronas": "mercedes",
    mercedes: "mercedes",
    "scuderia ferrari": "ferrari",
  };
  return aliases[value] || value.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
};

const normalize = (name) =>
  String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

const blankStats = { driverTitles: null, gpWins: null, years: null };

export default function DriverTeamTimeline({ driverName }) {
  const key = Object.keys(driverTeamHistory).find(
  (name) => normalize(name) === normalize(driverName)
);

const driverData = key ? driverTeamHistory[key] : null;
const teams = driverData?.teams || [];
  const [selectedTeam, setSelectedTeam] = useState("");

const activeTeam = teams.includes(selectedTeam) ? selectedTeam : null;

const stats = activeTeam
  ? driverData?.stats?.[activeTeam] || blankStats
  : blankStats;

  if (!teams.length) return null;

  const statItems = [
    { label: "Driver Titles", value: stats.driverTitles },
    { label: "Grand Prix Wins", value: stats.gpWins },
    { label: "Years Represented", value: stats.years },
  ];

  return (
    <section className="driver-team-timeline">
      <div className="driver-team-timeline-heading">
        <div>
          <span className="driver-team-timeline-kicker">CAREER JOURNEY</span>
          <h3>DRIVER TIMELINE</h3>
        </div>
        <span className="driver-team-timeline-count">
          {String(teams.length).padStart(2, "0")} <small>TEAMS</small>
        </span>
      </div>

      <div className="driver-team-timeline-track">
        {teams.map((team, index) => {
          const slug = slugFor(team);
          const isLatest = index === teams.length - 1;
          const isActive = team === activeTeam;

          return (
            <React.Fragment key={`${team}-${index}`}>
              <button
                type="button"
                className={`driver-team-timeline-stop team-${slug} ${isActive ? "is-selected" : ""}`}
                onClick={() =>
  setSelectedTeam((current) => current === team ? "" : team)
}
                aria-pressed={isActive}
                aria-label={`Show ${driverName}'s statistics with ${team}`}
              >
                <span className="driver-team-timeline-logo">
                  <span className="driver-team-timeline-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <img
                    src={`/images/team-logos/${slug}.png`}
                    alt={`${team} logo`}
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                      event.currentTarget.parentElement.classList.add("logo-fallback");
                    }}
                  />
                  <span className="driver-team-timeline-fallback">
                    {team.split(" ").map((part) => part[0]).join("").slice(0, 3)}
                  </span>
                  <span className="driver-team-timeline-glow" />
                </span>
                <span className="driver-team-timeline-team-name">{team}</span>
                {isLatest && (
                  <span className="driver-team-timeline-current">
                    <i /> CURRENT TEAM
                  </span>
                )}
              </button>

              {index < teams.length - 1 && (
                <div className="driver-team-timeline-connector" aria-hidden="true">
                  <span className="driver-team-timeline-line" />
                  <span className="driver-team-timeline-arrow">›</span>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {activeTeam && (
        <div className={`driver-team-selected-panel team-${slugFor(activeTeam)}`}>
          <div className="driver-team-selected-heading">
            <div>
              <span className="driver-team-selected-eyebrow">DRIVER RECORD WITH</span>
              <h4>{activeTeam}</h4>
            </div>
            
          </div>

          <div className="driver-team-stat-grid">
            {statItems.map((item) => (
              <div className="driver-team-stat-card" key={item.label}>
                <strong>{item.value == null ? "—" : item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          {statItems.some((item) => item.value == null) && (
            <p className="driver-team-stats-note">
              Add the missing values in <code>src/data/driverTeamStats.js</code>.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
