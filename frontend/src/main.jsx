import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Award, CalendarDays, ChevronRight, CircleHelp, Flag, Gauge, Home, Menu, Search, ShieldCheck, Trophy, Users, X, Zap, RefreshCw, Database, Radio, Timer, Medal } from 'lucide-react';
import driverTeams from './data/driverTeams.js';
import { GB, BH, CN, SA, AE, AU, JP, US, IT, MC, ES, CA, AT, BE, HU, NL, AZ, SG, MX, BR, QA, FR, DE, PT, TR } from 'country-flag-icons/react/3x2';
import { seasonArchive } from './data/seasonArchive.js';
import { allTimeRecords } from './data/allTimeRecords.js';
import './styles.css';
import driversBanner from './assets/banners/drivers-banner.png';
import teamsBanner from './assets/banners/teams-banner.png';
import circuitsBanner from './assets/banners/circuits-banner.png';
import seasonsBanner from './assets/banners/seasons-banner.png';
import hallOfFameBanner from './assets/banners/hall-of-fame-banner.png';
import recordsBanner from './assets/banners/records-banner.png';
const getCircuitFlag = (name = '') => {
  const value = name.toLowerCase();

  if (value.includes('bahrain')) return BH;
  if (value.includes('china')) return CN;
  if (value.includes('saudi')) return SA;
  if (value.includes('emirates') || value.includes('abu dhabi')) return AE;
  if (value.includes('australia')) return AU;
  if (value.includes('japan')) return JP;

  if (
    value.includes('miami') ||
    value.includes('united states') ||
    value.includes('usa') ||
    value.includes('las vegas')
  ) return US;

  if (
    value.includes('imola') ||
    value.includes('italy') ||
    value.includes('italian') ||
    value.includes('emilia-romagna') ||
    value.includes('tuscany') ||
    value.includes('mugello')
  ) return IT;

  if (value.includes('portugal') || value.includes('portuguese')) return PT;
  if (value.includes('turkey') || value.includes('türkiye') || value.includes('turkish')) return TR;

  if (value.includes('monaco')) return MC;
  if (value.includes('spain') || value.includes('madrid') || value.includes('barcelona')) return ES;
  if (value.includes('canada')) return CA;
  if (value.includes('austria')) return AT;
  if (value.includes('belgium')) return BE;
  if (value.includes('hungary')) return HU;
  if (value.includes('netherlands') || value.includes('dutch')) return NL;
  if (value.includes('azerbaijan') || value.includes('baku')) return AZ;
  if (value.includes('singapore')) return SG;
  if (value.includes('mexico')) return MX;
  if (value.includes('brazil') || value.includes('são paulo') || value.includes('sao paulo')) return BR;
  if (value.includes('qatar')) return QA;
  if (value.includes('france')) return FR;
  if (value.includes('germany')) return DE;
  if (value.includes('britain') || value.includes('british') || value.includes('silverstone') || value.includes('united kingdom')) return GB;

  return null;
};

function getCircuitCountry(name = '') {
  const value = name.toLowerCase();

  if (value.includes('bahrain')) return 'Bahrain';
  if (value.includes('china')) return 'China';
  if (value.includes('saudi')) return 'Saudi Arabia';
  if (value.includes('abu dhabi') || value.includes('emirates')) return 'United Arab Emirates';
  if (value.includes('australia')) return 'Australia';
  if (value.includes('japan')) return 'Japan';
  if (value.includes('miami') || value.includes('las vegas') || value.includes('united states')) return 'United States';
  if (value.includes('italy') || value.includes('imola') || value.includes('monza') || value.includes('tuscany')) return 'Italy';
  if (value.includes('mexico')) return 'Mexico';
  if (value.includes('brazil') || value.includes('são paulo') || value.includes('sao paulo')) return 'Brazil';
  if (value.includes('qatar')) return 'Qatar';
  if (value.includes('portugal')) return 'Portugal';
  if (value.includes('turkey') || value.includes('türkiye')) return 'Turkey';
  if (value.includes('germany')) return 'Germany';
  if (value.includes('france')) return 'France';

  return '';
}
const API = import.meta.env.VITE_API_BASE || 'http://localhost:3002/api';
const nav = [
  { name: 'Drivers', icon: Users }, { name: 'Teams', icon: ShieldCheck },
  { name: 'Circuits', icon: Flag }, { name: 'Seasons', icon: CalendarDays }, { name: 'Hall of Fame',icon: Trophy }, { name: 'Records', icon: Gauge }
];
const pageBannerImages = {
  Drivers: driversBanner,
  Teams: teamsBanner,
  Circuits: circuitsBanner,
  Seasons: seasonsBanner,
  'Hall of Fame': hallOfFameBanner,
  Records: recordsBanner
};
const fmt = n => n == null || n === '' ? '—' : Number(n).toLocaleString();
const parseTrackStat = raw => {
  const value = String(raw ?? '').replace(/\\s+/g, ' ').trim();
  const match = value.match(/^(.*?)\\s+(\\d{2}:\\d{2}\\.\\d{3})$/);
  return match ? { driver: match[1].trim(), time: match[2] } : { driver: value, time: '' };
};




const circuitFlagComponents = {
  Bahrain: BH,
  China: CN,
  'Saudi Arabia': SA,
  'United Arab Emirates': AE,
  Australia: AU,
  Japan: JP,
  Miami: US,
  'Emilia-Romagna': IT,
  Monaco: MC,
  Spain: ES,
  Canada: CA,
  Austria: AT,
  Belgium: BE,
  Hungary: HU,
  Netherlands: NL,
  Azerbaijan: AZ,
  Singapore: SG,
  Mexico: MX,
  Brazil: BR,
  Qatar: QA,
  France: FR,
  Germany: DE,
  'United Kingdom': GB,
  'Las Vegas': US,
  'São Paulo': BR,
  'Abu Dhabi': AE,
  'Portugal': PT,
  'Turkey': TR,
  'Tuscany': IT,
};

const driverTeam = d => {
  const name = d.display_name || d.name || '';
  const manualTeam = driverTeams[name];

  if (manualTeam) return manualTeam;

  const value = d.current_team_name || d.current_team || d.team_name || d.constructor_name || d.team;

  return typeof value === 'object' && value
    ? (value.name || value.team_name || '')
    : (value || '');
};

const apiImageFor = (item, kind) => kind === 'Drivers'
  ? (item.image_url || item.headshot_url || item.photo_url || item.image || item.headshot || '')
  : (item.logo_url || item.image_url || item.logo || item.team_logo || '');

const teamLogoSlug = name => {
  const value = String(name || '').toLowerCase().replace(/&/g, 'and').trim();
  const aliases = {
    'red bull': 'red-bull-racing',
    'red bull racing': 'red-bull-racing',
    'rb': 'racing-bulls',
    'visa cash app racing bulls': 'racing-bulls',
    'racing bulls': 'racing-bulls',
    'aston martin aramco': 'aston-martin',
    'aston martin': 'aston-martin',
    'mercedes-amg petronas': 'mercedes',
    'mercedes': 'mercedes',
    'scuderia ferrari': 'ferrari'
  };
  return aliases[value] || value.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
};

const imageFor = (item, kind) => {
  if (kind === 'Drivers') {
    const name = item.display_name || item.name || '';
    // Match database names to the actual filenames in public/images/drivers.
    const driverAliases = {
      'Alex Albon': 'Alexander Albon',
      'Sergio Perez': 'Sergio Pérez',
      'Sergio Pérez': 'Sergio Pérez',
      'Kimi Antonelli': 'Kimi Antonelli'
    };
    const filename = driverAliases[name] || name;
    return filename ? `/images/drivers/${encodeURIComponent(filename)}.png` : apiImageFor(item, kind);
  }
  if (kind === 'Teams') {
    const slug = teamLogoSlug(item.name);
    return slug ? `/images/team-logos/${slug}.png` : apiImageFor(item, kind);
  }
  // Circuits use country flags in their avatar, not an API image.
  if (kind === 'Circuits') return '';
  return apiImageFor(item, kind);
};
const initials = name => String(name || 'F1').split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();

function App() {
  const [page, setPage] = useState('Drivers');
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState('');
  const [data, setData] = useState({ drivers: [], teams: [], circuits: [], seasons: [], hall: [], laps: [], winners: [], trackRecords: [] });
  const [health, setHealth] = useState('checking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function get(path) { const r = await fetch(`${API}${path}`); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); }
  async function load() {
    setLoading(true); setError('');
    try {
      const paths = ['/health','/drivers','/teams','/circuits','/seasons','/hall-of-fame','/records/lap-times','/records/gp-winners','/track-records'];
      const out = await Promise.allSettled(paths.map(get));
      if (out[0].status === 'fulfilled') setHealth(out[0].value.database === 'connected' ? 'connected' : 'warning'); else setHealth('offline');
      const val = i => out[i]?.status === 'fulfilled' ? out[i].value : [];
      const drivers = await Promise.all(val(1).map(async item => {
        try { const full = await get(`/drivers/${item.id}`); return { ...item, legacy_totals: full.legacy_totals, season_history: full.season_history }; }
        catch { return item; }
      }));
      const teams = await Promise.all(val(2).map(async item => {
        try { const full = await get(`/teams/${item.id}`); return { ...item, legacy_totals: full.legacy_totals, season_history: full.season_history }; }
        catch { return item; }
      }));
      setData({ drivers, teams, circuits: val(3), seasons: val(4), hall: val(5), laps: val(6), winners: val(7), trackRecords: val(8)?.columns || [] });
      if (out.slice(1).every(x => x.status === 'rejected')) setError('The API could not be reached. Start the backend on port 3002, then refresh.');
    } catch { setError('Could not load archive data. Check that the API is running.'); setHealth('offline'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  async function openDetail(kind, item) {
    const key = kind === 'Drivers' ? 'drivers' : kind === 'Teams' ? 'teams' : 'circuits';
    const label = kind === 'Drivers' ? (item.display_name || item.name) : kind === 'Teams' ? item.name : item.gp_name;
    setSelected({ kind, item, label }); setDetail(null); setDetailLoading(true);
    try { setDetail(await get(`/${key}/${item.id}`)); } catch (e) { setDetail({ _error: e.message }); }
    finally { setDetailLoading(false); }
  }
  const list = page === 'Drivers' ? data.drivers : page === 'Teams' ? data.teams : page === 'Circuits' ? data.circuits : [];
  const filtered = useMemo(() => {
    const rows = list.filter(x => JSON.stringify(x).toLowerCase().includes(search.toLowerCase()));
    if (page === 'Drivers' || page === 'Teams') return rows.sort((a, b) => Number(b.legacy_totals?.points ?? b.points ?? 0) - Number(a.legacy_totals?.points ?? a.points ?? 0));
    return rows;
  }, [list, search, page]);
  const stats = [
    { label: 'Drivers archived', value: data.drivers.length, icon: Users, tone: 'red', note: 'Driverrecords' },
    { label: 'Teams archived', value: data.teams.length, icon: ShieldCheck, tone: 'blue', note: 'Constructor records' },
    { label: 'Grand Prix circuits', value: data.circuits.length, icon: Flag, tone: 'gold', note: 'Circuit archive' },
    { label: 'Lap-time records', value: data.laps.length, icon: Timer, tone: 'green', note: 'Recorded entries' }
  ];
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'show' : ''}`}>
  <div className="brand">
    <img
      src="/images/f1-logo.png"
      alt="F1 Career"
      className="brand-logo"
    />
    <button className="close-nav" onClick={() => setMobileNav(false)}>
      <X size={18}/>
    </button>
  </div>

  

  <nav>
    {nav.map(n => {
      const Icon = n.icon;

      return (
        <button
          key={n.name}
          className={`nav-item ${page === n.name ? 'active' : ''}`}
          onClick={() => {
            setPage(n.name);
            setSearch('');
            setSelected(null);
            setMobileNav(false);
          }}
        >
          <Icon size={18}/>
          <span>{n.name}</span>
          {n.name === 'Overview' && <span className="nav-live"/>}
        </button>
      );
    })}
  </nav>

  <div className="sidebar-bottom">
  <div className="connection-panel">
    <div className="connection-info">
      <span className={`connection-dot ${health}`} />

      <div>
        <strong>
          {health === 'connected' ? 'SYSTEM ONLINE' :
           health === 'checking' ? 'CONNECTING...' :
           health === 'warning' ? 'CONNECTION WARNING' :
           'SYSTEM OFFLINE'}
        </strong>

        <small>
          {health === 'connected'
            ? 'Your archive is up to date'
            : 'Check your server connection'}
        </small>
      </div>
    </div>

    <button
      className="connection-refresh"
      onClick={load}
      title="Refresh connection"
    >
      <RefreshCw size={15}/>
    </button>
  </div>
</div>
</aside>
    {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-area">

      <div className="content">
        <div className={`page-banner page-banner-${page.toLowerCase().replace(/\s+/g, '-')}`}>
  {pageBannerImages[page] && (
    <img
      className="page-banner-image"
      src={pageBannerImages[page]}
      alt={`${page} banner`}
    />
  )}
  <div className="page-banner-overlay">
    <span className="page-banner-kicker">F1 CAREER ARCHIVE</span>
    <h1>{page.toUpperCase()}</h1>
    <p>
      {page === 'Drivers' && 'Explore the legends behind every racing career.'}
      {page === 'Teams' && 'Discover the constructors shaping Formula 1 history.'}
      {page === 'Circuits' && 'Explore the circuits behind every Grand Prix.'}
      {page === 'Seasons' && 'Relive the championship seasons and their champions.'}
      {page === 'Hall of Fame' && 'Honouring the drivers who made history.'}
      {page === 'Records' && 'The numbers, achievements and records that define greatness.'}
    </p>
  </div>
  <span className="page-banner-index">F1 / {String(nav.findIndex(n => n.name === page) + 1).padStart(2, '0')}</span>
</div>
        

        {['Drivers','Teams','Circuits'].includes(page) && <section className={`panel data-panel directory-${page.toLowerCase()}`}><div className="panel-heading list-heading"><div><span className="section-kicker">ARCHIVE DIRECTORY</span><h3>{page} <span className="heading-count">{filtered.length}</span></h3><p className="directory-hint">{page==='Drivers'?'Ranked by career points':page==='Teams'?'Constructor statistics and archived drivers':'Grand Prix circuit archive'}</p></div><div className="searchbox"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Search ${page.toLowerCase()}…`}/>{search&&<button onClick={()=>setSearch('')}><X size={14}/></button>}</div></div>{loading?<div className="loading-state"><RefreshCw className="spin"/> Loading archive records…</div>:filtered.length===0?<div className="empty-state"><div className="empty-icon"><Search size={23}/></div><strong>{search?'No matching records':'No records available yet'}</strong><p>{search?'Try another search term.':'When records are available, they will appear here automatically.'}</p></div>:<div className="table-wrap"><table><thead><tr><th>{page==='Drivers'?'DRIVER':page==='Teams'?'TEAM':'GRAND PRIX'}</th>
{page==='Drivers' && <><th>CURRENT TEAM</th><th>WINS</th><th>PODIUMS</th><th>POLES</th><th>POINTS</th><th>WORLD TITLES</th></>}
{page==='Teams' && <><th>DRIVERS LINEUP</th><th>WINS</th><th>PODIUMS</th><th>POLES</th><th>POINTS</th><th>CONSTRUCTOR TITLES</th></>}

{page==='Circuits' && <><th>CIRCUIT</th><th>MOST WINS</th><th>FASTEST LAP</th><th>POLE TIME</th><th>STATUS</th></>}<th/></tr></thead><tbody>{filtered.map((x,i)=>{const title=page==='Drivers'?(x.display_name||x.name):page==='Teams'?x.name:x.gp_name; const trackRecord = page==='Circuits' ? data.trackRecords.find(r => String(r.label || '').trim().toLowerCase() === String(title || '').trim().toLowerCase()) : null; const fastestLap = parseTrackStat(trackRecord?.fastest_lap_raw); const poleTime = parseTrackStat(trackRecord?.pole_time_raw); const t=x.legacy_totals||{}; const img=imageFor(x,page); const team=driverTeam(x); const teamDrivers=data.drivers.filter(d=>driverTeam(d).toLowerCase() && driverTeam(d).toLowerCase()===String(x.name||'').toLowerCase()); const points=t.points??x.points; const titles=page==='Drivers'?(t.drivers_titles??t.world_titles??t.titles):(t.constructors_titles??t.constructor_titles??t.titles); return <tr key={x.id??i} onClick={()=>openDetail(page,x)}><td><div className="entity-cell">{img?<img className={`entity-photo ${page==='Teams'?`team-logo team-logo-${teamLogoSlug(x.name)}`:''}`} src={img} alt="" loading="lazy" onError={e=>{
  const el = e.currentTarget;

  if (!el.dataset.triedApiImage) {
    el.dataset.triedApiImage = '1';
    const fallback = apiImageFor(x, page);
    if (fallback && !el.src.endsWith(fallback)) { el.src = fallback; return; }
  }
 
el.style.display = 'none';
}}/> : (
  <div className={`entity-avatar avatar-${i % 5} ${page === 'Teams' ? 'team-logo-fallback' : ''}`}>
  {page === 'Circuits'
  ? (() => {
      const CountryFlag = getCircuitFlag(x.gp_name || title);
      return CountryFlag
        ? <CountryFlag className="circuit-country-flag" title={title} />
        : initials(title);
    })()
  : initials(title)}
</div>
)}
<div className="entity-name">
  <strong>{title || 'Unnamed record'}</strong>
  {page === 'Drivers' && <small>{team || 'Current team not recorded'}</small>}
  {page === 'Teams' }
</div>
</div></td>

{page==='Drivers' && <><td className="team-cell">{team ? <img className="current-team-logo" src={`/images/team-logos/${teamLogoSlug(team)}.png`} alt={team} title={team} /> : <span className="not-recorded">Not recorded</span>}</td><td className="number-cell">{fmt(t.wins??x.wins)}</td><td className="number-cell">{fmt(t.podiums??x.podiums)}</td><td className="number-cell">{fmt(t.poles??x.poles)}</td><td className="number-cell points-cell">{fmt(points)}</td><td className={`number-cell ${Number(titles) > 0 ? 'world-champion-titles' : ''}`}>
  {fmt(titles)}
</td></>}

{page==='Teams' && <><td className="team-drivers">{teamDrivers.length ? <div className="team-driver-portraits">{teamDrivers.map((d,i)=>{const driverName=d.display_name||d.name; const portrait=imageFor(d,'Drivers'); return portrait ? <img key={d.id??i} src={portrait} alt="" title={driverName} className="team-driver-portrait" loading="lazy" /> : null;})}</div> : <span className="not-recorded">No linked drivers</span>}</td><td className="number-cell">{fmt(t.wins??x.wins)}</td><td className="number-cell">{fmt(t.podiums??x.podiums)}</td><td className="number-cell">{fmt(t.poles??x.poles)}</td><td className="number-cell points-cell">{fmt(points)}</td><td className={`number-cell ${Number(titles) > 0 ? 'world-champion-titles' : ''}`}>
  {fmt(titles)}
</td></>}

{page==='Circuits' && <><td>
  {{
    'Bahrain': 'Sakhir',
    'China': 'Shanghai',
    'Saudi Arabia': 'Jeddah',
    'United Arab Emirates': 'Abu Dhabi',
    'Australia': 'Melbourne',
    'Japan': 'Suzuka',
    'Miami': 'Miami Garden',
    'Emilia-Romagna': 'Imola',
    'Monaco': 'Monte Carlo',
    'Spain': 'Barcelona',
    'Canada': 'Montreal',
    'Austria': 'Spielberg',
    'Belgium': 'Spa',
    'Hungary': 'Mogyoród',
    'Netherlands': 'Zandvoort',
    'Azerbaijan': 'Baku',
    'Singapore': 'Singapore',
    'Mexico': 'Mexico City',
    'Brazil': 'São Paulo',
    'Qatar': 'Lusail',
    'France': 'Le Castellet',
    'Germany': 'Hockenheim',
    'United States': 'Austin',
    'Las Vegas': 'Las Vegas',
    'Portugal': 'Portimão',
    'Turkey': 'Istanbul',
    'Tuscany': 'Mugello',
    'United Kingdom': 'Silverstone',
    'Italy': 'Monza'
  }[x.gp_name] || 'Location unavailable'}
</td>
<td className="track-stat-cell">{trackRecord?.most_wins_raw || '—'}</td>
<td className="track-stat-cell">{fastestLap.driver ? <><strong>{fastestLap.driver}</strong>{fastestLap.time && <small>{fastestLap.time}</small>}</> : '—'}</td>
<td className="track-stat-cell">{poleTime.driver ? <><strong>{poleTime.driver}</strong>{poleTime.time && <small>{poleTime.time}</small>}</> : '—'}</td>
<td><span className="status-pill"><span/> SAVED</span></td></>}<td><button className="row-open" aria-label={`Open ${title}`}><ChevronRight size={17}/></button></td></tr>})}</tbody></table></div>}</section>}
        

{page === 'Seasons' && (
  <div className="season-archive-grid">
    {seasonArchive.map((season, index) => (
      <details
        className={`season-card ${season.teamTheme || ''}`}
        key={season.season}
      >
        <summary className="season-card-summary">
          <div className="season-number">
            <Trophy size={20} />
            <span>{season.season}</span>
          </div>

          <div className="season-champions">
            <div className="season-champion">
              <img
                className="season-champion-portrait"
                src={season.championImage}
                alt={season.champion}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div>
                <small>WORLD CHAMPION</small>
                <strong>{season.champion}</strong>
              </div>
            </div>

            <div className="season-champion">
              <img
                className="season-constructor-image"
                src={season.constructorImage}
                alt={season.constructorChampion}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div>
                <small>CONSTRUCTOR CHAMPION</small>
                <strong>{season.constructorChampion}</strong>
              </div>
            </div>
          </div>

          <ChevronRight className="season-expand-icon" size={20} />
        </summary>

        <div className="season-card-details">
          <section className="season-standings">
            <h3>Drivers' Championship — Top 5</h3>

            {season.drivers.length > 0 ? (
              season.drivers.slice(0, 5).map((driver, i) => (
                <div className="season-standing-row" key={driver.name}>
                  <span className="season-position">{i + 1}</span>
                  <strong>{driver.name}</strong>
                  <b>
                    {driver.points} <small>PTS</small>
                  </b>
                </div>
              ))
            ) : (
              <p className="season-empty-note">
                Add the top five driver standings to the season data.
              </p>
            )}
          </section>

          <section className="season-standings">
            <h3>Constructors' Championship — Top 5</h3>

            {season.constructors.length > 0 ? (
              season.constructors.slice(0, 5).map((team, i) => (
                <div className="season-standing-row" key={team.name}>
                  <span className="season-position">{i + 1}</span>
                  <strong>{team.name}</strong>
                  <b>
                    {team.points} <small>PTS</small>
                  </b>
                </div>
              ))
            ) : (
              <p className="season-empty-note">
                Add the top five constructor standings to the season data.
              </p>
            )}
          </section>
        </div>
      </details>
    ))}
  </div>
)}


      
{page === 'Hall of Fame' && (
  <div className="hof-grid">
    {seasonArchive.map((season) => (
      <article
        className={`hof-card ${season.driverTheme}`}
        key={season.season}
      >
        <div className="hof-card-top">
          <span className="hof-season">{season.season}</span>
          <span className="hof-title">DRIVER WORLD CHAMPION</span>
        </div>

        <div className="hof-main">
          <div className="hof-driver-info">
            <h2>{season.champion}</h2>

            <span className="hof-team">
               {season.driverTeam}
</span>

            <div className="hof-stats">
              <div>
                <strong>{season.grandPrixWins ?? 0}</strong>
                <small>GRAND PRIX WINS</small>
              </div>

              <div>
                <strong>{season.podiums ?? 0}</strong>
                <small>PODIUMS</small>
              </div>

              <div>
                <strong>{season.totalPoints ?? 0}</strong>
                <small>TOTAL POINTS</small>
              </div>
            </div>
          </div>

          <div className="hof-portrait-wrap">
            <img
              className="hof-portrait"
              src={season.championImage}
              alt={season.champion}
              onError={(e) => {
                e.currentTarget.style.visibility = 'hidden';
              }}
            />

            <img
              className="hof-team-logo"
              src={season.driverTeamImage}
              alt={season.driverTeam}
              onError={(e) => {
                e.currentTarget.style.visibility = 'hidden';
              }}
            />
          </div>
        </div>

        <div className="hof-card-footer">
          <Trophy size={16} />
          <span>WORLD CHAMPION</span>
          <span className="hof-footer-season">
            {season.season}
          </span>
        </div>
      </article>
    ))}
  </div>
)}



{page === 'Records' && (
  <div className="records-page">
    

    {allTimeRecords.length > 0 && (
      <section className="records-featured-wrap">
        <div className="records-section-title">
          <div>
            <span className="section-kicker">THE BENCHMARKS</span>
            <h3>Records of a lifetime</h3>
          </div>
          <span className="records-section-index">01 / FEATURED</span>
        </div>

        <div className="records-featured-grid">
          {allTimeRecords.slice(0, 4).map((record, index) => (
            <article
              className={`records-feature-card ${
                index % 2 === 0
  ? 'records-feature-primary'
  : 'records-feature-secondary'
              } ${record.image ? 'has-record-image' : ''}`}
              key={`${record.category}-${record.title}`}
            >
              <div className="records-feature-watermark">
                {String(index + 1).padStart(2, '0')}
              </div>

              <div className="records-feature-top">
                <span>{record.category}</span>
                <span>ALL-TIME RECORD</span>
              </div>

              <div className="records-feature-content">
                <div className="records-feature-copy">
                  <h4>{record.title}</h4>
                  <p className="records-feature-holder">{record.holder}</p>

                  <div className="records-feature-stat">
                    {record.value}
                  </div>

                  <div className="records-feature-unit">
                    {record.unit}
                  </div>

                  <p className="records-feature-detail">
                    {record.detail}
                  </p>
                </div>

                {record.image && (
                  <div className="records-feature-portrait-wrap">
                    <img
                      src={record.image}
                      alt={record.holder}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    <span>
                      {record.category === 'CONSTRUCTOR RECORDS'
                        ? 'CONSTRUCTOR'
                        : 'LEGEND'}
                    </span>
                  </div>
                )}
              </div>

              <div className="records-feature-line" />
            </article>
          ))}
        </div>
      </section>
    )}

    {[
      'DRIVER RECORDS',
      'CONSTRUCTOR RECORDS',
      'SINGLE-SEASON RECORDS',
      'STREAK RECORDS',
    ].map((category, categoryIndex) => {
      const records = allTimeRecords.filter(
        (record, index) =>
          record.category === category && index >= 2
      );

      if (!records.length) return null;

      return (
        <section className="records-category-section" key={category}>
          <div className="records-section-title">
            <div>
              <span className="section-kicker">
                RECORD CLASS {String(categoryIndex + 2).padStart(2, '0')}
              </span>
              <h3>
                {category.replace(' RECORDS', '')} <em>records</em>
              </h3>
            </div>

            <span className="records-section-index">
              {String(records.length).padStart(2, '0')} ENTRIES
            </span>
          </div>

          <div className="records-list">
            {records.map((record, index) => (
              <article
                className="records-list-row"
                key={`${record.category}-${record.title}`}
              >
                <div className="records-list-rank">
                  {String(index + 1).padStart(2, '0')}
                </div>

                <div className="records-list-main">
                  <span>{record.category}</span>
                  <h4>{record.title}</h4>
                  <p>{record.detail}</p>
                </div>

                <div className="records-list-holder">
                  {record.holder}
                </div>

                <div className="records-list-stat">
                  <strong>{record.value}</strong>
                  <span>{record.unit}</span>
                </div>

                <div className="records-list-arrow">
                  <ChevronRight size={17} />
                </div>
              </article>
            ))}
          </div>
        </section>
      );
    })}

   
  </div>
)}




      </div>
    </main>

    
{selected && (
  <div className="modal-backdrop" onClick={() => setSelected(null)}>
    <section
  className={`detail-modal detail-modal-${selected.kind.toLowerCase()} ${selected.kind === 'Circuits' ? 'circuit-profile' : ''}`}
  data-country={
  selected.kind === 'Circuits'
    ? getCircuitCountry(selected.item.gp_name || selected.item.name || selected.label || '')
    : undefined
}
  onClick={e => e.stopPropagation()}
>
      <button className="modal-close" onClick={() => setSelected(null)}>
        <X size={18} />
      </button>

      {(() => {
        const profileImage = imageFor(selected.item, selected.kind);
        const teamColor = selected.kind === 'Teams'
          ? teamLogoSlug(selected.item.name)
          : 'racing';
          const currentTeamDrivers = selected.kind === 'Teams'
  ? data.drivers.filter(d =>
      driverTeam(d).toLowerCase() === selected.item.name.toLowerCase()
    ).slice(0, 2)
  : [];

        return (
          <>
            <div
  className={`profile-banner profile-banner-${
    selected.kind === 'Drivers'
      ? (driverTeams[selected.label] || 'default').toLowerCase().replace(/\s+/g, '-')
      : teamColor
  }`}
>
              {profileImage && (
                <img
                  className={`profile-image ${selected.kind === 'Teams' ? 'profile-team-logo' : 'profile-driver-photo'}`}
                  src={profileImage}
                  alt={selected.label}
                  onError={e => { e.currentTarget.style.visibility = 'hidden'; }}
                />
              )}
              <div className="profile-heading">
                <span className="section-kicker">ARCHIVE PROFILE</span>
                <h2>{selected.label || 'Record details'}</h2>
                <p className="modal-subtitle">
                  {selected.kind === 'Drivers'
                    ? 'Driver career record'
                    : selected.kind === 'Teams'
                    ? 'Constructor record'
                    : 'Circuit archive record'}
                </p>
              </div>
              {selected.kind === 'Teams' && currentTeamDrivers.length > 0 && (
  <div className="profile-current-drivers">
    {currentTeamDrivers.map(driver => {
      const driverName = driver.display_name || driver.name;

      return (
        <div className="profile-current-driver" key={driver.id}>
          <img
            src={imageFor(driver, 'Drivers')}
            alt={driverName}
            title={driverName}
            onError={e => {
              e.currentTarget.style.visibility = 'hidden';
            }}
          />
        </div>
      );
    })}
  </div>
)}
            </div>

            {detailLoading ? (
              <div className="loading-state">
                <RefreshCw className="spin" /> Loading details…
              </div>
            ) : detail ? (
              detail._error ? (
                <div className="empty-state">
                  <strong>Could not load details</strong>
                  <p>{detail._error}</p>
                </div>
              ) : (
                <DetailContent data={detail} kind={selected.kind} />
              )
            ) : null}
          </>
        );
      })()}
    </section>
  </div>
)}

  </div>;
}
function EmptyPage({title,description,icon:Icon,count,loading}) { return <section className="panel empty-page"><div className="empty-icon large"><Icon size={28}/></div><span className="section-kicker">COMING FROM YOUR DATA</span><h2>{title}</h2><p>{description}</p><div className="empty-state-chip">{loading?'CHECKING ARCHIVE':`${count} RECORDS FOUND`}</div></section>; }
function RecordPanel({title,icon:Icon,rows,loading,empty}) { return <section className="panel record-panel"><div className="panel-heading"><div className="record-title-icon"><Icon size={18}/></div><div><span className="section-kicker">ARCHIVE RECORDS</span><h3>{title}</h3></div><span className="heading-count">{rows.length}</span></div>{loading?<div className="loading-state"><RefreshCw className="spin"/> Loadingâ€¦</div>:rows.length===0?<div className="empty-state compact"><p>{empty}</p></div>:<div className="record-list">{rows.slice(0,12).map((r,i)=><div className="record-row" key={r.id??i}><span className="record-index">{String(i+1).padStart(2,'0')}</span><div className="record-main"><strong>{r.driver_name && r.gp_name ? `${r.driver_name} â€” ${r.gp_name}` : r.gp_name||r.driver_name||r.record_type||r.lap_time||`Record ${i+1}`}</strong><small>{r.year||r.circuit_name||r.driver_name||r.lap_time||'Historical record'}</small></div><ChevronRight size={15}/></div>)}</div>}</section>; }


function DetailContent({ data, kind }) {
  const totals = data.legacy_totals || {};
  const history = data.season_history || data.winners || data.records || [];

  const driverTitles = totals.drivers_titles ?? 0;
  const constructorTitles = totals.constructors_titles ?? 0;

  return (
    <>
      <div className="detail-metrics">
        {Object.entries(totals)
          .filter(([k, v]) =>
            k !== 'driver_id' &&
            k !== 'team_id' &&
            !/championship/i.test(k) &&
            v != null
          )
          .slice(0, 6)
          .map(([k, v]) => (
            <div key={k}>
              <small>{k.replaceAll('_', ' ')}</small>
              <strong>{typeof v === 'number' ? fmt(v) : v}</strong>
            </div>
          ))}
      </div>

      {/* Driver championship cards */}
      {kind === 'Drivers' && (
        <div className="detail-title-metrics">
          <div className="title-metric">
            <small>Driver World Championships</small>
            <strong>{fmt(driverTitles)}</strong>
          </div>

          <div className="title-metric">
            <small>Constructor Championships</small>
            <strong>{fmt(constructorTitles)}</strong>
          </div>
        </div>
      )}

      {/* Constructor championship card */}
      {kind === 'Teams' && (
        <div className="detail-title-metrics constructor-title-single">
          <div className="title-metric">
            <small>Constructor World Championships</small>
            <strong>{fmt(constructorTitles)}</strong>
          </div>
        </div>
      )}

      {/* Keep history only for circuits */}
      {kind === 'Circuits' && (
        <div className="detail-section">
          <h3>Circuit records & winners</h3>

          {history.length === 0 ? (
            <p className="detail-empty">
              No additional history is stored for this record yet.
            </p>
          ) : (
            history.slice(0, 20).map((r, i) => (
              <div className="detail-history-row" key={r.id ?? i}>
                <span>
                  {r.year || r.driver_name || r.record_type || `Record ${i + 1}`}
                </span>
                <b>
                  <span className="record-number">{i + 1}</span>
                </b>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}



createRoot(document.getElementById('root')).render(<App/>);

